# Dev environment composition.
#
# The project itself is created by bootstrap.sh (chicken-and-egg: Terraform
# state lives in a bucket inside the project). Everything else is declared
# here and in modules under ../../modules/.

module "apis" {
  source     = "../../modules/project-apis"
  project_id = var.project_id
}

# --- Artifact Registry -----------------------------------------------------

module "artifact_registry" {
  source     = "../../modules/artifact-registry"
  project_id = var.project_id
  region     = var.region

  depends_on = [module.apis]
}

# --- Firebase + Identity Platform (anonymous auth) ------------------------

module "firebase_auth" {
  source     = "../../modules/firebase-auth"
  project_id = var.project_id

  google_client_id     = var.google_client_id
  google_client_secret = var.google_client_secret

  # The Cloud Run-served web URL needs to be on Firebase Auth's allowlist
  # or the Google sign-in popup fails with "The requested action is
  # invalid". Passed via var to break a cycle (web -> firebase_auth -> web).
  # Hardcoded in terraform.tfvars because the Cloud Run URL is stable.
  #
  # Firebase Auth's subdomain wildcarding works from registrable-domain
  # entries (the apex), not from arbitrary mid-level subdomain entries.
  # Adding `preview.<domain>` alone was insufficient to cover
  # `pr-N.preview.<domain>` — Firebase rejected continueUrls with
  # `auth/unauthorized-continue-uri`. Adding the apex as well lets the
  # wildcard match every host under it (including `pr-N.preview.<domain>`
  # and the apex itself, useful if we ever serve the marketing site there).
  extra_authorized_domains = concat(
    var.firebase_extra_authorized_domains,
    [
      var.custom_domain_name,
      "preview.${var.custom_domain_name}",
    ],
  )

  # NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN override. Empty string (default) keeps
  # the firebaseapp.com auto-domain. Flip to "auth.${var.custom_domain_name}"
  # AFTER the Firebase Hosting custom-domain cert is ACTIVE (created by
  # firebase-hosting-auth.tf) and AFTER the OAuth client has been updated to
  # include the matching `/__/auth/handler` redirect URI. See the deployment
  # sequence at the top of firebase-hosting-auth.tf.
  auth_domain_override = var.firebase_auth_domain_override

  depends_on = [module.apis]
}

# --- Custom domain (tranquil.coach) --------------------------------------
# tranquil.coach is registered at Porkbun ($65/yr renewal — Cloud Domains
# does not sell .coach). Only the Cloud DNS managed zone is created here;
# Porkbun's NS records point at the zone's name_servers output.

module "domain" {
  source     = "../../modules/domain"
  project_id = var.project_id

  domain_name = var.custom_domain_name

  # Domain is at Porkbun — don't try to register via Cloud Domains. The
  # registrant_contact tfvar is retained for the case where we ever add a
  # second TF-managed apex on a Cloud Domains-supported TLD.
  register_via_cloud_domains = false

  depends_on = [module.apis]
}

# --- Search Console domain verification ---------------------------------
# Cloud Run's `google_cloud_run_domain_mapping` resource requires the
# *caller* (the deploy SA) to be a verified Search Console owner of the
# domain (or any parent). For a brand-new apex this is a one-time human
# step: a property owner first verifies via a DNS TXT token, then adds
# other owners (e.g. the deployer SA) via the Search Console UI.
#
# Token list is multi-valued so additional verifications can be appended
# without churning the resource — Cloud DNS supports an arbitrary number
# of TXT values on a single record set.

resource "google_dns_record_set" "search_console_verification" {
  project      = var.project_id
  managed_zone = module.domain.dns_zone_name
  name         = "${var.custom_domain_name}."
  type         = "TXT"
  ttl          = 300

  rrdatas = [
    "\"google-site-verification=XwlEfyK-89rP_EOcn85f3Dw7orLsIrpGrn7wZjasWZo\"",
  ]
}

# --- mem0 API key secret --------------------------------------------------
# The secret resource is created empty. Add the value once with:
#   echo -n "$MEM0_KEY" | gcloud secrets versions add MEM0_API_KEY \
#     --data-file=- --project=<project-id>
# Before that first version exists, the agent's Cloud Run revision will fail
# to start — that's why the module depends on the key being added before the
# agent is (re)deployed with secret_env. Set skip_secret_env=true in var to
# let the agent start without it.

module "mem0_secret" {
  source     = "../../modules/mem0-secret"
  project_id = var.project_id

  accessor_members = [
    "serviceAccount:${module.agent.service_account_email}",
  ]

  depends_on = [module.apis, module.agent]
}

# --- GWS OAuth client secret (Workspace code exchange) -------------------
# Reuses the same OAuth client already provisioned for Firebase Google
# sign-in (same client_id/client_secret tfvars). The agent service reads
# the secret to exchange the browser's auth code for refresh tokens.

module "gws_oauth_secret" {
  source        = "../../modules/gws-oauth-secret"
  project_id    = var.project_id
  client_secret = var.google_client_secret

  # Hardcode the agent SA email (deterministic from the agent module's
  # `service_name` arg) to break a terraform ordering cycle: if this
  # module depends on `module.agent.service_account_email`, the agent's
  # Cloud Run revision update (which references the GWS secret) gets
  # planned before the secret's IAM grant, and the revision fails to
  # start with "Permission denied on secret".
  accessor_members = [
    "serviceAccount:lifecoach-agent@${var.project_id}.iam.gserviceaccount.com",
  ]

  depends_on = [module.apis]
}

# --- GCS bucket for per-user data (user.yaml, goal_updates.json) ---------

module "user_bucket" {
  source      = "../../modules/gcs-user-bucket"
  project_id  = var.project_id
  region      = var.region
  environment = var.environment

  writer_members = [
    "serviceAccount:${module.agent.service_account_email}",
  ]

  depends_on = [module.agent]
}

# --- Firestore (ADK session storage) --------------------------------------

module "firestore" {
  source     = "../../modules/firestore"
  project_id = var.project_id

  accessor_members = [
    "serviceAccount:${module.agent.service_account_email}",
  ]

  depends_on = [module.apis, module.agent]
}

# --- Service-to-service shared secret (web ↔ agent) ----------------------
# Stops an attacker hitting the agent's *.run.app URL directly and burning
# LLM spend. Generated by Terraform (URL-safe, 48 chars), stored in Secret
# Manager, and mounted as `AGENT_INTERNAL_BEARER` on BOTH the agent (which
# verifies it on incoming requests via middleware) and the web service
# (which forwards it as `x-agent-internal-bearer` on every proxied call).
# Hardcoded SA emails to break the cycle — same pattern as gws_oauth_secret.

resource "random_password" "agent_internal_bearer" {
  length  = 48
  special = false # URL-safe; keeps header value parseable
}

resource "google_secret_manager_secret" "agent_internal_bearer" {
  project   = var.project_id
  secret_id = "AGENT_INTERNAL_BEARER"

  replication {
    auto {}
  }

  depends_on = [module.apis]
}

resource "google_secret_manager_secret_version" "agent_internal_bearer" {
  secret      = google_secret_manager_secret.agent_internal_bearer.id
  secret_data = random_password.agent_internal_bearer.result
}

resource "google_secret_manager_secret_iam_member" "agent_internal_bearer_accessors" {
  for_each = toset([
    "serviceAccount:lifecoach-agent@${var.project_id}.iam.gserviceaccount.com",
    "serviceAccount:lifecoach-web@${var.project_id}.iam.gserviceaccount.com",
  ])
  project   = var.project_id
  secret_id = google_secret_manager_secret.agent_internal_bearer.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value
}

# --- Stable Next.js Server Action encryption key --------------------------
# Next.js 15 derives Server Action IDs during `next build`. Without a stable
# key, a redeploy invalidates IDs embedded in clients that still have the
# previous bundle cached, causing "Failed to find Server Action" 500s.
# Keep a single base64-encoded 32-byte AES key in Secret Manager, feed it
# to the web Docker build as a BuildKit secret (so it never lands in image
# metadata — see apps/web/Dockerfile), and mount it at runtime so all Cloud
# Run revisions agree. Same key in dev and previews (previews share dev's
# Secret Manager — see infra/envs/preview/main.tf).
#
# Rotation: rewrite `random_id.next_server_actions_encryption_key` (e.g.
# `terraform taint`) and redeploy. All currently-cached client bundles
# become unusable until reloaded; that's the cost of rotating, and is why
# we keep it decoupled from AGENT_INTERNAL_BEARER (which rotates for its
# own reasons that shouldn't invalidate client bundles).

resource "random_id" "next_server_actions_encryption_key" {
  byte_length = 32
}

resource "google_secret_manager_secret" "next_server_actions_encryption_key" {
  project   = var.project_id
  secret_id = "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"

  replication {
    auto {}
  }

  depends_on = [module.apis]
}

resource "google_secret_manager_secret_version" "next_server_actions_encryption_key" {
  secret      = google_secret_manager_secret.next_server_actions_encryption_key.id
  secret_data = random_id.next_server_actions_encryption_key.b64_std
}

resource "google_secret_manager_secret_iam_member" "next_server_actions_encryption_key_accessors" {
  for_each = toset([
    "serviceAccount:lifecoach-web@${var.project_id}.iam.gserviceaccount.com",
  ])
  project   = var.project_id
  secret_id = google_secret_manager_secret.next_server_actions_encryption_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value
}

# --- Cloud Run: agent ------------------------------------------------------
# Public for Phase 1. IAM-scoped web->agent invocation is a Phase 11 hardening.

module "agent" {
  source       = "../../modules/cloud-run-service"
  project_id   = var.project_id
  region       = var.region
  service_name = "lifecoach-agent"
  image        = "${module.artifact_registry.repository_url}/lifecoach-agent:${var.image_tag}"

  # Keep one instance warm so dev users don't eat the ~6s ADK + ~30s
  # Vertex/auth-handshake cold-start tax on the first chat after idle.
  # The ADK + Firebase Admin + Vertex SDK boot is heavy (~1s); the first
  # LLM call against a cold instance is what blows the perceived latency.
  min_instances = 1

  env = merge(
    {
      GOOGLE_GENAI_USE_VERTEXAI = "true"
      GOOGLE_CLOUD_PROJECT      = var.project_id
      # Gemini 3.* models are only reachable via the Vertex `global`
      # publisher endpoint today — every regional endpoint returns 404.
      # See apps/agent/src/agent.ts for the pinned model id.
      GOOGLE_CLOUD_LOCATION = "global"
      NODE_ENV              = "production"
      FIREBASE_PROJECT_ID   = var.project_id
      # Name follows the gcs-user-bucket module's convention so we don't have
      # to pass the output (avoids a cycle between agent and user_bucket).
      USER_BUCKET = "lifecoach-users-${var.environment}-${var.project_id}"
      # Google Workspace OAuth — client ID is public; secret is mounted via
      # Secret Manager in `secret_env` below.
      GWS_OAUTH_CLIENT_ID = module.firebase_auth.google_client_id
      SENTRY_ENVIRONMENT  = var.environment
    },
    var.sentry_dsn != "" ? { SENTRY_DSN = var.sentry_dsn } : {},
  )

  project_roles = [
    "roles/aiplatform.user",
    "roles/firebaseauth.admin",
    "roles/logging.logWriter",
  ]

  # Secret IDs used here are created by the *_secret modules that depend on
  # this agent module. Referencing the literal name breaks the cycle (see
  # mem0-secret for the same pattern).
  secret_env = merge(
    var.mem0_enabled ? {
      MEM0_API_KEY = { secret_id = "MEM0_API_KEY", version = "latest" }
    } : {},
    {
      GWS_OAUTH_CLIENT_SECRET = {
        secret_id = "GWS_OAUTH_CLIENT_SECRET"
        version   = "latest"
      }
      # Verified by the agent's HTTP middleware. See infra/modules/cloud-run-service
      # for how secret_env mounts; the secret is created above.
      AGENT_INTERNAL_BEARER = {
        secret_id = "AGENT_INTERNAL_BEARER"
        version   = "latest"
      }
    },
  )

  allow_unauthenticated = true

  depends_on = [module.artifact_registry, module.firebase_auth]
}

# --- Cloud Run: web --------------------------------------------------------

module "web" {
  source       = "../../modules/cloud-run-service"
  project_id   = var.project_id
  region       = var.region
  service_name = "lifecoach-web"
  image        = "${module.artifact_registry.repository_url}/lifecoach-web:${var.image_tag}"

  # Pair with the agent's min_instances=1 so the first reload after idle
  # doesn't hit a cold Next.js server. Next start-up is lighter (~2s) but
  # still adds to the perceived "warming up" delay.
  min_instances = 1

  container_port = 3000

  env = {
    AGENT_URL = module.agent.url
    NODE_ENV  = "production"
  }

  # Forwarded to the agent on every proxied request via
  # `x-agent-internal-bearer`. Same secret the agent verifies.
  #
  # The stable Server Actions encryption key is mounted here at runtime as
  # well as injected at build time — Next reads it at request time to verify
  # action IDs, and the value must match what `next build` baked into the
  # client bundle (same Secret Manager secret in both paths).
  secret_env = {
    AGENT_INTERNAL_BEARER = {
      secret_id = "AGENT_INTERNAL_BEARER"
      version   = "latest"
    }
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = {
      secret_id = "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"
      version   = "latest"
    }
  }

  project_roles = [
    "roles/logging.logWriter",
  ]

  allow_unauthenticated = true

  depends_on = [
    module.agent,
    google_secret_manager_secret_iam_member.agent_internal_bearer_accessors,
    google_secret_manager_secret_iam_member.next_server_actions_encryption_key_accessors,
  ]
}

# --- Apex (tranquil.coach) HTTPS LB → main web Cloud Run service ---------
#
# Production routing for https://tranquil.coach. Same architecture as the
# per-PR previews (HTTPS LB + Serverless NEG, see infra/envs/preview/main.tf
# for the per-PR equivalent) — we avoid google_cloud_run_domain_mapping
# because that API checks Search Console verified-owner status and Search
# Console's UI rejects service-account emails as users ("email not found"),
# so the deployer SA can never become a verified owner. The LB route uses
# google_compute_managed_ssl_certificate with HTTP-01 challenge directly,
# no Search Console involvement.
#
# Two forwarding rules share the same global anycast IP:
#   - port 443 → HTTPS proxy → URL map → backend (the web service)
#   - port 80  → HTTP proxy  → redirect URL map (301 to https://<host>)
# The HTTP rule exists so users who type `tranquil.coach` (browsers send
# http first) get redirected to HTTPS instead of a connection-refused.
#
# Cost: ~$36/mo (two forwarding rules at $0.025/hr each). Managed cert
# provisioning lag on first apply is ~15-30 min wall-clock; the .run.app
# URL on module.web stays available throughout for direct access.

# All Compute resources below take `depends_on = [module.apis]` so a
# fresh project (where `compute.googleapis.com` isn't already enabled)
# can't race the API enablement during the first `terraform apply`.
# Only the resources that don't already transit `module.web` (which
# itself depends on module.apis) need the explicit edge — i.e. the
# managed cert and the global address. We add it to the whole apex
# stack for defense in depth so a future refactor doesn't reintroduce
# the bug.

resource "google_compute_region_network_endpoint_group" "web_apex_neg" {
  project               = var.project_id
  name                  = "lifecoach-web-apex-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = module.web.service_name
  }

  depends_on = [module.apis]
}

resource "google_compute_backend_service" "web_apex" {
  project               = var.project_id
  name                  = "lifecoach-web-apex-backend"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  # timeout_sec is unsupported on Serverless-NEG backends (the upstream
  # Cloud Run revision's request timeout applies, default 300s).

  backend {
    group = google_compute_region_network_endpoint_group.web_apex_neg.id
  }

  depends_on = [module.apis]
}

resource "google_compute_url_map" "web_apex" {
  project         = var.project_id
  name            = "lifecoach-web-apex-urlmap"
  default_service = google_compute_backend_service.web_apex.id

  depends_on = [module.apis]
}

resource "google_compute_managed_ssl_certificate" "web_apex" {
  project = var.project_id
  name    = "lifecoach-web-apex-cert"

  managed {
    domains = [var.custom_domain_name]
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [module.apis]
}

resource "google_compute_target_https_proxy" "web_apex" {
  project          = var.project_id
  name             = "lifecoach-web-apex-https-proxy"
  url_map          = google_compute_url_map.web_apex.id
  ssl_certificates = [google_compute_managed_ssl_certificate.web_apex.id]

  depends_on = [module.apis]
}

resource "google_compute_global_address" "web_apex_ip" {
  project = var.project_id
  name    = "lifecoach-web-apex-ip"

  depends_on = [module.apis]
}

resource "google_compute_global_forwarding_rule" "web_apex_https" {
  project               = var.project_id
  name                  = "lifecoach-web-apex-fr-https"
  ip_address            = google_compute_global_address.web_apex_ip.address
  port_range            = "443"
  target                = google_compute_target_https_proxy.web_apex.id
  load_balancing_scheme = "EXTERNAL_MANAGED"

  depends_on = [module.apis]
}

# HTTP → HTTPS redirect, sharing the apex IP.

resource "google_compute_url_map" "web_apex_http_redirect" {
  project = var.project_id
  name    = "lifecoach-web-apex-urlmap-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }

  depends_on = [module.apis]
}

resource "google_compute_target_http_proxy" "web_apex_http" {
  project = var.project_id
  name    = "lifecoach-web-apex-http-proxy"
  url_map = google_compute_url_map.web_apex_http_redirect.id

  depends_on = [module.apis]
}

resource "google_compute_global_forwarding_rule" "web_apex_http" {
  project               = var.project_id
  name                  = "lifecoach-web-apex-fr-http"
  ip_address            = google_compute_global_address.web_apex_ip.address
  port_range            = "80"
  target                = google_compute_target_http_proxy.web_apex_http.id
  load_balancing_scheme = "EXTERNAL_MANAGED"

  depends_on = [module.apis]
}

# A record at the apex points at the LB's anycast IP.

resource "google_dns_record_set" "apex_a" {
  project      = var.project_id
  managed_zone = module.domain.dns_zone_name
  name         = "${var.custom_domain_name}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.web_apex_ip.address]
}

# --- GitHub Actions WIF (deploys via OIDC, no long-lived keys) -----------

module "github_wif" {
  source       = "../../modules/github-wif"
  project_id   = var.project_id
  github_repo  = var.github_repo
  state_bucket = "${var.project_id}-tfstate"

  cloud_run_service_accounts = [
    module.agent.service_account_email,
    module.web.service_account_email,
  ]

  depends_on = [module.apis, module.agent, module.web]
}

# --- Outputs ---------------------------------------------------------------

output "project_id" {
  value = var.project_id
}

output "enabled_apis" {
  value = module.apis.enabled_apis
}

output "artifact_registry_url" {
  value = module.artifact_registry.repository_url
}

output "agent_url" {
  value = module.agent.url
}

output "web_url" {
  value = module.web.url
}

output "user_bucket" {
  value = module.user_bucket.bucket_name
}

output "firebase_api_key" {
  value     = module.firebase_auth.firebase_api_key
  sensitive = true
}

output "firebase_auth_domain" {
  value = module.firebase_auth.firebase_auth_domain
}

output "firebase_app_id" {
  value = module.firebase_auth.firebase_app_id
}

output "google_client_id" {
  value = module.firebase_auth.google_client_id
}

output "github_wif_provider" {
  value       = module.github_wif.workload_identity_provider
  description = "Pass to google-github-actions/auth as workload_identity_provider."
}

output "github_deployer_sa" {
  value       = module.github_wif.deployer_email
  description = "Pass to google-github-actions/auth as service_account."
}

output "sentry_dsn" {
  value       = var.sentry_dsn
  description = "Sentry DSN. Empty when telemetry is disabled. Read by deploy.sh / preview-deploy.sh and passed as a build-arg to the web Docker image so NEXT_PUBLIC_SENTRY_DSN is inlined at build time."
  sensitive   = true
}

output "environment" {
  value       = var.environment
  description = "Used by deploy.sh to set NEXT_PUBLIC_SENTRY_ENVIRONMENT on web build-arg."
}

output "custom_domain_name" {
  value       = module.domain.domain_name
  description = "Apex domain (e.g. \"lifecoach.dev\"). Preview env reads this to build pr-N.preview.<domain>."
}

output "custom_domain_dns_zone" {
  value       = module.domain.dns_zone_name
  description = "Cloud DNS managed-zone name. Preview env writes per-PR CNAME records into this zone."
}

output "apex_lb_ip" {
  value       = google_compute_global_address.web_apex_ip.address
  description = "Anycast IPv4 the apex (tranquil.coach) resolves to. Useful for sanity-checking `dig tranquil.coach` outside Terraform."
}
