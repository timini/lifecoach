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
    "firestore.googleapis.com",

    # Firebase
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firebaseappcheck.googleapis.com",

    # Vertex AI + memory bank
    "aiplatform.googleapis.com",

    # Google Workspace integrations the agent can call.
    # Tasks API is required for service=tasks (tasklists.list,
    # tasks.list, tasks.insert, ...) — without it the underlying CLI
    # gets a SERVICE_DISABLED 403 from Google and the agent surfaces
    # a `forbidden`-coded error.
    "gmail.googleapis.com",
    "calendar-json.googleapis.com",
    "drive.googleapis.com",
    "tasks.googleapis.com",

    # Places (for "nearby interesting places" context)
    "places.googleapis.com",

    # Custom domain + DNS (see infra/modules/domain/). Cloud Domains
    # registers + manages the lifecoach.dev registration; Cloud DNS hosts
    # the managed zone the registration delegates to + holds the per-PR
    # preview CNAME records the preview env writes.
    "domains.googleapis.com",
    "dns.googleapis.com",

    # Per-PR preview HTTPS LB + Serverless NEG. Cloud Run's first-gen
    # domain-mapping API (google_cloud_run_domain_mapping) requires the
    # deployer to be a verified Search Console owner of the parent
    # domain — but Search Console's UI rejects service-account emails
    # as users. The HTTPS LB + Serverless NEG path bypasses that check
    # entirely. See infra/envs/preview/main.tf for the per-PR stack.
    "compute.googleapis.com",

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
