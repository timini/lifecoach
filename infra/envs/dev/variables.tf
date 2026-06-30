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

variable "google_analytics_measurement_id" {
  type        = string
  default     = ""
  description = "Google Analytics 4 measurement ID (NEXT_PUBLIC_GA_MEASUREMENT_ID) inlined into the web bundle at build time. Empty disables GA."
}

variable "sentry_dsn" {
  type        = string
  default     = ""
  description = "Sentry DSN used by both apps/agent (runtime SENTRY_DSN env) and apps/web (NEXT_PUBLIC_SENTRY_DSN inlined at build time). Empty disables Sentry — both SDKs no-op. DSNs are public by Sentry's design (they're shipped in the browser bundle), so this is treated as a non-secret config value rather than a Secret Manager entry."
}

# --- Custom-domain registration (rootandrise.app) -------------------------
# See infra/modules/domain/main.tf for why this exists. Set in
# terraform.tfvars (the registrant_contact is sensitive — Cloud Domains
# needs valid Whois data for verification but it's hidden in public Whois
# via REDACTED_CONTACT_DATA).

variable "custom_domain_name" {
  type        = string
  default     = "tranquil.coach"
  description = "Apex domain DNS-hosted in this project. Registered externally at Porkbun (Cloud Domains does not sell .coach). Preview hostnames live at pr-N.preview.<domain>; Firebase Auth allowlist picks up preview.<domain> as a single subdomain-wildcard entry covering every PR. .coach is non-public-suffix so Firebase's subdomain wildcarding works."
}

variable "custom_domain_registrant_contact" {
  type = object({
    email        = string
    phone_number = string
    postal_address = object({
      region_code         = string
      postal_code         = string
      administrative_area = string
      locality            = string
      address_lines       = list(string)
      recipients          = list(string)
    })
  })
  default     = null
  nullable    = true
  sensitive   = true
  description = "Whois registrant contact, only used when an apex is registered via Cloud Domains. tranquil.coach is at Porkbun so this is unused today; kept for future TF-managed apexes on Cloud Domains-supported TLDs. Set in terraform.tfvars (gitignored)."
}

variable "firebase_auth_domain_override" {
  type        = string
  default     = ""
  description = "Hostname to surface as NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN to the web bundle. Empty (default) keeps the firebaseapp.com auto-domain — sign-in still works but users see the firebaseapp.com URL briefly during the OAuth popup. Set to \"auth.tranquil.coach\" (the Firebase Hosting custom domain provisioned by infra/envs/dev/firebase-hosting-auth.tf) to surface the branded subdomain instead. See the deployment sequence comment at the top of firebase-hosting-auth.tf — flip only AFTER the cert is ACTIVE and the OAuth client has the matching /__/auth/handler URI."
}

variable "background_scheduler_cron" {
  type        = string
  default     = "*/15 * * * *"
  description = "Cadence of the background dispatcher tick (ADR 0001). Dev = every 15 min; prod pins 5 min."
}

variable "background_queue_max_dispatch_per_second" {
  type        = number
  default     = 5
  description = "Cloud Tasks dispatch-rate ceiling for background runs (ADR 0001)."
}

variable "background_queue_max_concurrent_dispatches" {
  type        = number
  default     = 5
  description = "Max in-flight background run deliveries (ADR 0001)."
}
