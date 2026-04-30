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

  env = {
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
  }

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

# --- Outputs --------------------------------------------------------------

output "agent_url" {
  value       = module.agent.url
  description = "Per-PR agent Cloud Run URL."
}

output "web_url" {
  value       = module.web.url
  description = "Per-PR web Cloud Run URL — the one to open in a browser / point Playwright at."
}

output "pr_number" {
  value = var.pr_number
}
