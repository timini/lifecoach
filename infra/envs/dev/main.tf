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
  extra_authorized_domains = var.firebase_extra_authorized_domains

  depends_on = [module.apis]
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

  project_roles = [
    "roles/logging.logWriter",
  ]

  allow_unauthenticated = true

  depends_on = [module.agent]
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
