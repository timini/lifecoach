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
  }

  project_roles = [
    "roles/aiplatform.user",
    "roles/logging.logWriter",
  ]

  allow_unauthenticated = true

  depends_on = [module.artifact_registry]
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
