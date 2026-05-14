// Secret Manager secret holding the Notion OAuth client secret used by the
// agent service for the server-side code exchange when users grant Notion
// access. Mirrors infra/modules/gws-oauth-secret. The client ID is a
// public value carried as a non-secret env var; this module only manages
// the secret half.

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

variable "client_secret" {
  type        = string
  sensitive   = true
  description = "Notion OAuth client secret. Stored in a Secret Manager version; never logged."
}

variable "accessor_members" {
  type        = list(string)
  default     = []
  description = "IAM members (serviceAccount:...) that can read the latest version."
}

resource "google_secret_manager_secret" "notion_oauth" {
  project   = var.project_id
  secret_id = "NOTION_OAUTH_CLIENT_SECRET"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "notion_oauth" {
  secret      = google_secret_manager_secret.notion_oauth.id
  secret_data = var.client_secret
}

resource "google_secret_manager_secret_iam_member" "accessors" {
  for_each  = toset(var.accessor_members)
  project   = var.project_id
  secret_id = google_secret_manager_secret.notion_oauth.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value
}

output "secret_id" {
  value = google_secret_manager_secret.notion_oauth.secret_id
}
