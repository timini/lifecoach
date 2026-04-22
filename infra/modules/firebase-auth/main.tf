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

variable "extra_authorized_domains" {
  type        = list(string)
  default     = []
  description = "Domains (no scheme) to allow for sign-in popups/redirects. The Firebase defaults (<project>.firebaseapp.com and <project>.web.app) are always included; pass the Cloud Run host etc. here."
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

  authorized_domains = concat(
    [
      "localhost",
      "${var.project_id}.firebaseapp.com",
      "${var.project_id}.web.app",
    ],
    var.extra_authorized_domains,
  )

  sign_in {
    anonymous {
      enabled = true
    }
    # Email link (magic link) — not password. Firebase sends the
    # verification email; no Cloud Function needed.
    email {
      enabled           = true
      password_required = false
    }
    allow_duplicate_emails = false
  }

  autodelete_anonymous_users = false

  depends_on = [google_firebase_project.fb]
}

# Google provider for linkWithPopup. Client ID/secret come from the OAuth
# consent screen — set them after first apply with:
#   gcloud auth-config ... (or Console → Auth → Sign-in method → Google)
# The resource holds the enabled flag; values get filled in via console
# or a follow-up tf-apply with real -var values.
variable "google_client_id" {
  type        = string
  default     = ""
  description = "OAuth client ID for Google sign-in (from the GCP OAuth consent screen). Leave empty to skip Google provider config."
}

variable "google_client_secret" {
  type        = string
  default     = ""
  sensitive   = true
  description = "OAuth client secret for Google sign-in. Leave empty to skip."
}

resource "google_identity_platform_default_supported_idp_config" "google" {
  count = var.google_client_id != "" && var.google_client_secret != "" ? 1 : 0

  project       = var.project_id
  idp_id        = "google.com"
  client_id     = var.google_client_id
  client_secret = var.google_client_secret
  enabled       = true

  depends_on = [google_identity_platform_config.auth]
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

# Re-export the OAuth client id as a module output so downstream modules can
# consume it (agent Cloud Run env, web NEXT_PUBLIC build arg) without the
# parent having to keep another var-as-output shim.
output "google_client_id" {
  value = var.google_client_id
}
