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
# (registered + DNS-hosted in the dev env) means a single Firebase entry of
# `preview.lifecoach.dev` covers every PR's preview hostname.
#
# Cert provisioning lag: Cloud Run requests a Google-managed cert via the
# HTTP-01 challenge on first deploy. ~15-30 min wall-clock before HTTPS
# works on a new hostname. The *.run.app URL works immediately and is
# still posted alongside the custom URL in the PR comment, so reviewers
# aren't blocked while the cert warms up.
#
# `count = ... ? 1 : 0` lets us land the TF before the dev domain
# registration is actually applied. Once dev's apply completes and these
# outputs flow through preview-deploy.sh, count flips and the mapping
# materialises on the next preview deploy without a code change here.

locals {
  custom_domain_enabled = var.custom_domain_name != "" && var.custom_domain_dns_zone != ""
  preview_hostname      = local.custom_domain_enabled ? "pr-${var.pr_number}.preview.${var.custom_domain_name}" : ""
}

resource "google_cloud_run_domain_mapping" "web" {
  count    = local.custom_domain_enabled ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = local.preview_hostname

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = "lifecoach-web-pr-${var.pr_number}"
  }

  depends_on = [module.web]
}

# DNS record so the mapping resolves. Cloud Run domain mappings return a
# resource_records block listing the exact rrdata to publish; we point at
# `ghs.googlehosted.com` (the documented target for Cloud Run mappings in
# regions that haven't migrated to per-region IPs).
resource "google_dns_record_set" "preview_cname" {
  count        = local.custom_domain_enabled ? 1 : 0
  project      = var.project_id
  managed_zone = var.custom_domain_dns_zone
  name         = "${local.preview_hostname}."
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["ghs.googlehosted.com."]
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
