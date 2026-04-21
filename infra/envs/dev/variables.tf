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
