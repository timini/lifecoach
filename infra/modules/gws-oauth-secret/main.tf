# Secret Manager secret holding the Google OAuth client secret used by the
# agent service for the server-side code exchange when users grant Workspace
# access. Populated by Terraform from the sensitive tfvar — the human has
# already set `google_client_secret` in terraform.tfvars for Firebase Auth,
# we reuse it here so the browser's GIS popup and the server-side code
# exchange use the same OAuth client.

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
  description = "OAuth client secret. Stored in a Secret Manager version; never logged."
}

variable "accessor_members" {
  type        = list(string)
  default     = []
  description = "IAM members (serviceAccount:...) that can read the latest version."
}

resource "google_secret_manager_secret" "gws_oauth" {
  project   = var.project_id
  secret_id = "GWS_OAUTH_CLIENT_SECRET"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "gws_oauth" {
  secret      = google_secret_manager_secret.gws_oauth.id
  secret_data = var.client_secret
}

resource "google_secret_manager_secret_iam_member" "accessors" {
  for_each  = toset(var.accessor_members)
  project   = var.project_id
  secret_id = google_secret_manager_secret.gws_oauth.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value
}

output "secret_id" {
  value = google_secret_manager_secret.gws_oauth.secret_id
}
