variable "project_id" {
  type        = string
  description = "GCP project the preview lives in. Reuses dev's project — there's no per-PR project."
}

variable "region" {
  type        = string
  default     = "us-central1"
  description = "Region for the preview Cloud Run pair. Match dev's region."
}

variable "pr_number" {
  type        = string
  description = "GitHub PR number — used as the per-PR suffix in service names and state prefix."

  validation {
    condition     = can(regex("^[0-9]+$", var.pr_number))
    error_message = "pr_number must be a string of digits, e.g. \"42\"."
  }
}

variable "image_tag" {
  type        = string
  description = "Container image tag (e.g., 'pr-42-abc1234'). Must already be pushed to the dev Artifact Registry by the deploy script before terraform apply."
}

# --- Firebase build-args (read from dev outputs by preview-deploy.sh) ----

variable "firebase_api_key" {
  type        = string
  sensitive   = true
  description = "NEXT_PUBLIC_FIREBASE_API_KEY for the web build. Read from dev's terraform output."
}

variable "firebase_auth_domain" {
  type        = string
  description = "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN — usually <project>.firebaseapp.com."
}

variable "firebase_app_id" {
  type        = string
  description = "NEXT_PUBLIC_FIREBASE_APP_ID."
}

variable "google_oauth_client_id" {
  type        = string
  description = "NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID — same OAuth client used by Firebase Google sign-in."
}

# --- Optional knobs ------------------------------------------------------

variable "mem0_enabled" {
  type        = bool
  default     = true
  description = "Mount the MEM0_API_KEY secret. Defaults to true so previews mirror dev."
}

variable "sentry_dsn" {
  type        = string
  default     = ""
  description = "Sentry DSN — read from dev's terraform output by preview-deploy.sh and forwarded as a -var. Empty disables telemetry on the preview agent."
}
