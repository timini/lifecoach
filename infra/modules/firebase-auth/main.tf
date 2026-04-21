# Enables Firebase on an existing GCP project, creates a web app, configures
# Identity Platform (Firebase Auth), and enables the anonymous sign-in
# provider.
#
# NOTE: google_firebase_project and google_firebase_web_app are beta-only.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.12"
    }
  }
}

variable "project_id" {
  type = string
}

variable "display_name" {
  type    = string
  default = "Lifecoach"
}

# --- Firebase project ------------------------------------------------------

resource "google_firebase_project" "fb" {
  provider = google-beta
  project  = var.project_id
}

# --- Firebase web app -----------------------------------------------------

resource "google_firebase_web_app" "web" {
  provider        = google-beta
  project         = var.project_id
  display_name    = var.display_name
  deletion_policy = "DELETE"

  depends_on = [google_firebase_project.fb]
}

data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.web.app_id
}

# --- Identity Platform / Firebase Auth ------------------------------------

resource "google_identity_platform_config" "auth" {
  project = var.project_id

  # Allow anonymous users. Other providers (password, google.com) are added
  # in later phases.
  sign_in {
    anonymous {
      enabled = true
    }
    allow_duplicate_emails = false
  }

  autodelete_anonymous_users = false

  depends_on = [google_firebase_project.fb]
}

# --- Outputs (used by the web Cloud Run service as NEXT_PUBLIC_*) ---------

output "firebase_api_key" {
  value     = data.google_firebase_web_app_config.web.api_key
  sensitive = true
}

output "firebase_auth_domain" {
  value = data.google_firebase_web_app_config.web.auth_domain
}

output "firebase_project_id" {
  value = var.project_id
}

output "firebase_app_id" {
  value = google_firebase_web_app.web.app_id
}
