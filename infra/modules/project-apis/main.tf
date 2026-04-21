# Enables the full set of GCP APIs Lifecoach needs.
#
# Add a new API here when a new Terraform resource or app-runtime integration
# requires it. Keep this list explicit and reviewable — do NOT enable APIs
# manually via gcloud or the console.

variable "project_id" {
  type        = string
  description = "The GCP project to enable APIs on."
}

# APIs the bootstrap already enabled — re-declaring them here is idempotent
# and keeps the full set visible in one place.
locals {
  apis = [
    # Foundational (bootstrap also enables these)
    "cloudresourcemanager.googleapis.com",
    "cloudbilling.googleapis.com",
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "storage.googleapis.com",

    # Runtime
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "secretmanager.googleapis.com",

    # Firebase
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firebaseappcheck.googleapis.com",

    # Vertex AI + memory bank
    "aiplatform.googleapis.com",

    # Google Workspace integrations the agent can call
    "gmail.googleapis.com",
    "calendar-json.googleapis.com",
    "drive.googleapis.com",

    # Places (for "nearby interesting places" context)
    "places.googleapis.com",

    # Observability
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "cloudtrace.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.apis)

  project = var.project_id
  service = each.value

  # We manage enablement only; disabling on destroy would break sibling envs
  # if they share a project (they don't today, but future-proof).
  disable_on_destroy         = false
  disable_dependent_services = false
}

output "enabled_apis" {
  value       = sort([for s in google_project_service.enabled : s.service])
  description = "The full list of APIs enabled on the project."
}
