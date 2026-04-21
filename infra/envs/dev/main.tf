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

# --- Cloud Run: agent ------------------------------------------------------
# Public for Phase 1. IAM-scoped web->agent invocation is a Phase 11 hardening.

module "agent" {
  source       = "../../modules/cloud-run-service"
  project_id   = var.project_id
  region       = var.region
  service_name = "lifecoach-agent"
  image        = "${module.artifact_registry.repository_url}/lifecoach-agent:${var.image_tag}"

  env = {
    GOOGLE_GENAI_USE_VERTEXAI = "true"
    GOOGLE_CLOUD_PROJECT      = var.project_id
    GOOGLE_CLOUD_LOCATION     = var.region
    NODE_ENV                  = "production"
    FIREBASE_PROJECT_ID       = var.project_id
    # Name follows the gcs-user-bucket module's convention so we don't have
    # to pass the output (avoids a cycle between agent and user_bucket).
    USER_BUCKET = "lifecoach-users-${var.environment}-${var.project_id}"
  }

  project_roles = [
    "roles/aiplatform.user",
    "roles/firebaseauth.admin",
    "roles/logging.logWriter",
  ]

  secret_env = var.mem0_enabled ? {
    MEM0_API_KEY = { secret_id = "MEM0_API_KEY", version = "latest" }
  } : {}

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
