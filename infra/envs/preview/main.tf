# Per-PR review-app composition.
#
# A preview is just an extra Cloud Run revision pair (`lifecoach-agent-pr-<n>`,
# `lifecoach-web-pr-<n>`) inside the dev project. Everything heavyweight —
# Firebase Auth, Firestore, the user GCS bucket, Secret Manager secrets,
# Artifact Registry, Workload Identity Federation — is owned by the dev env
# and reused. That means:
#
#   - No per-PR project APIs to enable.
#   - No per-PR Firebase web app (sign-in popups still work because the
#     firebase-auth module allows `run.app` as a parent suffix).
#   - No per-PR runtime service accounts (we pass dev's existing SAs into
#     the cloud-run-service module via `existing_service_account`, so the
#     GWS_OAUTH_CLIENT_SECRET / Firestore / mem0 / user-bucket IAM grants
#     are inherited automatically).
#
# The blast radius of a closed PR is therefore bounded to two Cloud Run
# services and one terraform state file — `terraform destroy` cleans both.
#
# SA emails are constructed from project_id rather than read from dev's
# terraform outputs — same trick `gws_oauth_secret` uses in dev/main.tf
# to break a state ordering cycle. The pattern is deterministic from the
# cloud-run-service module's `account_id = substr(service_name, 0, 30)`
# rule: service_name "lifecoach-agent" → "lifecoach-agent@<proj>.iam.
# gserviceaccount.com". Avoids any chicken-and-egg between rolling out
# new dev outputs and the first preview workflow run.

locals {
  agent_sa_email = "lifecoach-agent@${var.project_id}.iam.gserviceaccount.com"
  web_sa_email   = "lifecoach-web@${var.project_id}.iam.gserviceaccount.com"
}

# --- Cloud Run: agent ------------------------------------------------------

module "agent" {
  source       = "../../modules/cloud-run-service"
  project_id   = var.project_id
  region       = var.region
  service_name = "lifecoach-agent-pr-${var.pr_number}"
  image        = "${var.region}-docker.pkg.dev/${var.project_id}/lifecoach/lifecoach-agent:${var.image_tag}"

  existing_service_account = local.agent_sa_email

  # Previews idle to zero — no warm pool. The first chat after deploy eats
  # the cold-start tax, which is fine for a preview env.
  min_instances = 0
  max_instances = 2

  env = merge(
    {
      GOOGLE_GENAI_USE_VERTEXAI = "true"
      GOOGLE_CLOUD_PROJECT      = var.project_id
      GOOGLE_CLOUD_LOCATION     = "global"
      NODE_ENV                  = "production"
      FIREBASE_PROJECT_ID       = var.project_id
      # Reuses dev's user bucket. The bucket name follows the gcs-user-bucket
      # module's `lifecoach-users-${environment}-${project_id}` convention; we
      # hardcode `dev` here because previews share dev's bucket.
      USER_BUCKET         = "lifecoach-users-dev-${var.project_id}"
      GWS_OAUTH_CLIENT_ID = var.google_oauth_client_id
      SENTRY_ENVIRONMENT  = "preview-pr-${var.pr_number}"
    },
    var.sentry_dsn != "" ? { SENTRY_DSN = var.sentry_dsn } : {},
  )

  secret_env = merge(
    var.mem0_enabled ? {
      MEM0_API_KEY = { secret_id = "MEM0_API_KEY", version = "latest" }
    } : {},
    {
      GWS_OAUTH_CLIENT_SECRET = {
        secret_id = "GWS_OAUTH_CLIENT_SECRET"
        version   = "latest"
      }
    },
  )

  allow_unauthenticated = true
}

# --- Cloud Run: web --------------------------------------------------------

module "web" {
  source       = "../../modules/cloud-run-service"
  project_id   = var.project_id
  region       = var.region
  service_name = "lifecoach-web-pr-${var.pr_number}"
  image        = "${var.region}-docker.pkg.dev/${var.project_id}/lifecoach/lifecoach-web:${var.image_tag}"

  existing_service_account = local.web_sa_email

  min_instances  = 0
  max_instances  = 2
  container_port = 3000

  env = {
    AGENT_URL = module.agent.url
    NODE_ENV  = "production"
  }

  allow_unauthenticated = true

  depends_on = [module.agent]
}

# --- Custom-domain mapping for the per-PR web service --------------------
#
# Why: the *.run.app preview URL works but `auth/unauthorized-continue-uri`
# rejects it for Firebase magic-link emails (run.app is on the Public
# Suffix List, so subdomain wildcarding in the authorized-domains allowlist
# doesn't apply). Mapping each PR to a hostname under the custom domain
# (DNS-hosted in the dev env) means a single Firebase entry of
# `preview.<custom_domain>` covers every PR's preview hostname.
#
# Architecture: HTTPS Load Balancer + Serverless NEG (NOT
# `google_cloud_run_domain_mapping`). The Cloud Run domain-mapping API
# requires the deployer principal to be a verified Search Console owner
# of the parent domain — but Search Console's UI rejects service-account
# emails as users ("email not found"). The LB approach uses Google's
# Certificate Manager (or the legacy compute managed-cert resource) to
# provision certs via HTTP-01 directly, with no Search Console check.
# Cleaner pattern overall: anycast IP, HTTP/3-ready, Cloud Armor-pluggable.
#
# Cost: ~$18/mo per active PR (global forwarding rule), $0 when destroyed.
# Concurrent open PRs in this repo cap that at single-digit dollars in
# practice — they get torn down on PR close by the teardown workflow.
#
# Cert provisioning lag: the managed cert needs the DNS A record visible
# (it polls public resolvers via HTTP-01 challenge) before it transitions
# from PROVISIONING → ACTIVE. ~15-30 min wall-clock on a fresh hostname.
# The .run.app URL works immediately and is still posted alongside the
# custom URL in the PR comment, so reviewers aren't blocked.
#
# `count = ... ? 1 : 0` lets us land the TF before the dev domain
# resources are actually applied. Once dev's apply completes and the
# outputs flow through preview-deploy.sh, count flips and the LB stack
# materialises on the next preview deploy without a code change here.

locals {
  custom_domain_enabled = var.custom_domain_name != "" && var.custom_domain_dns_zone != ""
  preview_hostname      = local.custom_domain_enabled ? "pr-${var.pr_number}.preview.${var.custom_domain_name}" : ""
  lb_resource_prefix    = "lifecoach-preview-pr-${var.pr_number}"
}

# Serverless NEG → wraps the per-PR Cloud Run web service so the LB can
# target it as a backend. Regional resource, lives in the same region as
# the Cloud Run service.
resource "google_compute_region_network_endpoint_group" "web_neg" {
  count                 = local.custom_domain_enabled ? 1 : 0
  project               = var.project_id
  name                  = "${local.lb_resource_prefix}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = "lifecoach-web-pr-${var.pr_number}"
  }

  depends_on = [module.web]
}

# Backend service wrapping the NEG. Single backend, no health-check
# (serverless NEGs don't support them — Cloud Run owns the readiness
# signal itself).
resource "google_compute_backend_service" "web" {
  count                 = local.custom_domain_enabled ? 1 : 0
  project               = var.project_id
  name                  = "${local.lb_resource_prefix}-backend"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  # Match Cloud Run's default request timeout. The /api/chat SSE stream
  # can run many seconds while Gemini reasons — 60s would clip long
  # responses. 300s matches the underlying Cloud Run revision's timeout,
  # so the LB never times out before the upstream does.
  timeout_sec = 300

  backend {
    group = google_compute_region_network_endpoint_group.web_neg[0].id
  }
}

# URL map: one path, one backend. No host-based routing since this LB
# only serves the per-PR hostname; the cert restricts what's reachable
# anyway.
resource "google_compute_url_map" "web" {
  count           = local.custom_domain_enabled ? 1 : 0
  project         = var.project_id
  name            = "${local.lb_resource_prefix}-urlmap"
  default_service = google_compute_backend_service.web[0].id
}

# Google-managed SSL cert. Provisions via HTTP-01 once the A record below
# is visible to Google's resolver. No Search Console involvement.
resource "google_compute_managed_ssl_certificate" "web" {
  count   = local.custom_domain_enabled ? 1 : 0
  project = var.project_id
  name    = "${local.lb_resource_prefix}-cert"

  managed {
    domains = [local.preview_hostname]
  }

  # The cert name can't be changed in place; if we ever needed a hostname
  # change we'd create a new cert and switch the proxy over. Not relevant
  # here since pr_number is fixed per PR.
  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_target_https_proxy" "web" {
  count            = local.custom_domain_enabled ? 1 : 0
  project          = var.project_id
  name             = "${local.lb_resource_prefix}-https-proxy"
  url_map          = google_compute_url_map.web[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.web[0].id]
}

# Global anycast IPv4. Stable for the life of the PR; gets a fresh one
# on each new PR via the resource name.
resource "google_compute_global_address" "web_ip" {
  count   = local.custom_domain_enabled ? 1 : 0
  project = var.project_id
  name    = "${local.lb_resource_prefix}-ip"
}

resource "google_compute_global_forwarding_rule" "web_https" {
  count                 = local.custom_domain_enabled ? 1 : 0
  project               = var.project_id
  name                  = "${local.lb_resource_prefix}-fr"
  ip_address            = google_compute_global_address.web_ip[0].address
  port_range            = "443"
  target                = google_compute_target_https_proxy.web[0].id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# A record pointing the per-PR hostname at the LB IP. TTL 300s so a
# stale record clears quickly after a PR is closed and the IP is reused
# on a future PR by a different number.
resource "google_dns_record_set" "preview_a" {
  count        = local.custom_domain_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = var.custom_domain_dns_zone
  name         = "${local.preview_hostname}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.web_ip[0].address]
}

# --- Outputs --------------------------------------------------------------

output "agent_url" {
  value       = module.agent.url
  description = "Per-PR agent Cloud Run URL."
}

output "web_url" {
  value       = module.web.url
  description = "Per-PR web Cloud Run URL — the *.run.app fallback. Used by Playwright + always available immediately on deploy."
}

output "custom_web_url" {
  value       = local.custom_domain_enabled ? "https://${local.preview_hostname}" : ""
  description = "Per-PR web URL under the custom domain (https://pr-N.preview.<domain>). Empty when the custom-domain mapping is disabled (dev env hasn't been applied with the domain module yet, or rolling back). NOTE: first deploy of a new PR has a ~15-30 min cert-provisioning lag before HTTPS works on this URL."
}

output "pr_number" {
  value = var.pr_number
}
