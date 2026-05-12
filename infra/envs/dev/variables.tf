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

variable "github_repo" {
  type        = string
  description = "GitHub repo (OWNER/REPO) allowed to mint deploy credentials via Workload Identity Federation."
}

variable "sentry_dsn" {
  type        = string
  default     = ""
  description = "Sentry DSN used by both apps/agent (runtime SENTRY_DSN env) and apps/web (NEXT_PUBLIC_SENTRY_DSN inlined at build time). Empty disables Sentry — both SDKs no-op. DSNs are public by Sentry's design (they're shipped in the browser bundle), so this is treated as a non-secret config value rather than a Secret Manager entry."
}

# --- Custom-domain registration (lifecoach.dev) ---------------------------
# See infra/modules/domain/main.tf for why this exists. Set in
# terraform.tfvars (the registrant_contact is sensitive — Cloud Domains
# needs valid Whois data for verification but it's hidden in public Whois
# via REDACTED_CONTACT_DATA).

variable "custom_domain_name" {
  type        = string
  default     = "lifecoach.dev"
  description = "Apex domain registered + DNS-hosted in this project. Preview hostnames live at pr-N.preview.<domain>; Firebase Auth allowlist picks up preview.<domain> as a single entry that covers every PR. .dev is non-public-suffix so Firebase's subdomain wildcarding works."
}

variable "custom_domain_registrant_contact" {
  type = object({
    email          = string
    phone_number   = string
    postal_address = object({
      region_code         = string
      postal_code         = string
      administrative_area = string
      locality            = string
      address_lines       = list(string)
      recipients          = list(string)
    })
  })
  sensitive   = true
  description = "Whois registrant contact for the Cloud Domains registration. Hidden from public Whois via REDACTED_CONTACT_DATA but Google still requires valid values for ICANN verification. Set in terraform.tfvars (which is gitignored)."
}
