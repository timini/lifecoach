variable "project_id" {
  type        = string
  description = "GCP project ID for this environment. Created by infra/bootstrap/bootstrap.sh."
}

variable "region" {
  type        = string
  description = "Default region for regional resources."
  default     = "us-central1"
}

variable "org_id" {
  type        = string
  description = "GCP organization ID (rewire.it = 59273835578)."
}

variable "billing_account" {
  type        = string
  description = "Billing account ID linked to the project."
}

variable "environment" {
  type        = string
  description = "Environment name — dev or prod."

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be \"dev\" or \"prod\"."
  }
}

variable "image_tag" {
  type        = string
  description = "Container image tag to deploy for both agent and web (e.g., 'abc1234' or 'latest'). Set via -var or in terraform.tfvars; the deploy script writes it."
  default     = "bootstrap"
}

variable "mem0_enabled" {
  type        = bool
  default     = false
  description = "When true, mount the MEM0_API_KEY secret into the agent's Cloud Run env. Requires the secret to already have a version — otherwise the revision fails to start. See infra/modules/mem0-secret/main.tf for the one-liner to add one."
}

variable "google_client_id" {
  type        = string
  default     = ""
  description = "OAuth client ID for Google sign-in (from the GCP OAuth consent screen). Leave empty to skip the Google provider config."
}

variable "google_client_secret" {
  type        = string
  default     = ""
  sensitive   = true
  description = "OAuth client secret for Google sign-in. Leave empty to skip."
}

variable "firebase_extra_authorized_domains" {
  type        = list(string)
  default     = []
  description = "Extra hostnames (no scheme) allowed for Firebase Auth sign-in popups. Must include the Cloud Run web URL so Google popups work. Stable value; set in terraform.tfvars."
}
