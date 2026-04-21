# Secret Manager secret that holds the mem0.ai API key. The secret itself is
# created empty; the human operator adds the value with:
#   gcloud secrets versions add MEM0_API_KEY --data-file=<(echo -n "$KEY") \
#     --project=<project-id>
#
# If no version exists, Cloud Run fails fast on startup unless we make the
# env var optional. We mount via secret-keyref with "optional" semantics
# by guarding at the env layer — see cloud-run-service.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
  }
}

variable "project_id" {
  type = string
}

variable "accessor_members" {
  type        = list(string)
  default     = []
  description = "IAM members (e.g. serviceAccount:...) that can read the latest version."
}

resource "google_secret_manager_secret" "mem0" {
  project   = var.project_id
  secret_id = "MEM0_API_KEY"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "accessors" {
  for_each  = toset(var.accessor_members)
  project   = var.project_id
  secret_id = google_secret_manager_secret.mem0.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value
}

output "secret_id" {
  value = google_secret_manager_secret.mem0.secret_id
}
