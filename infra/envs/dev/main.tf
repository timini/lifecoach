# Dev environment composition.
#
# The project itself is created by bootstrap.sh (chicken-and-egg: Terraform
# state lives in a bucket inside the project). Everything else is declared
# here and in modules under ../../modules/.

module "apis" {
  source     = "../../modules/project-apis"
  project_id = var.project_id
}

# Phase 1+ modules land here:
# module "user_bucket"    { source = "../../modules/gcs-user-bucket"   ... }
# module "firebase"       { source = "../../modules/firebase-hosting"  ... }
# module "firebase_auth"  { source = "../../modules/firebase-auth"     ... }
# module "agent_run"      { source = "../../modules/cloud-run-agent"   ... }
# module "memory_bank"    { source = "../../modules/vertex-memory-bank"... }
# module "iam"            { source = "../../modules/iam"               ... }

output "project_id" {
  value = var.project_id
}

output "enabled_apis" {
  value = module.apis.enabled_apis
}
