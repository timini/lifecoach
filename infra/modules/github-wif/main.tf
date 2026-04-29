# GitHub Actions → GCP via Workload Identity Federation.
#
# Lets a GitHub Actions workflow in this repo mint short-lived GCP
# credentials by impersonating a deploy service account. No long-lived
# keys, no JSON file in repo secrets.
#
# Trust model:
#   - The pool's attribute_condition restricts token minting to *this*
#     repo (assertion.repository == var.github_repo).
#   - The deployer SA's workloadIdentityUser binding scopes impersonation
#     to the same repo, defence in depth.
#   - The deployer SA holds only the roles needed to run `infra/deploy.sh
#     dev both` end-to-end: push images, apply Terraform, deploy Cloud Run.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
  }
}

variable "project_id" {
  type        = string
  description = "GCP project the WIF pool and deployer SA live in."
}

variable "github_repo" {
  type        = string
  description = "GitHub repo allowed to assume the deployer SA, in OWNER/REPO form."
}

variable "state_bucket" {
  type        = string
  description = "Name of the Terraform state bucket the deployer needs read/write on."
}

variable "cloud_run_service_accounts" {
  type        = list(string)
  default     = []
  description = "Cloud Run runtime SA emails the deployer must be allowed to actAs (roles/iam.serviceAccountUser) so it can deploy revisions running as those SAs."
}

# --- Pool + provider ------------------------------------------------------

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "Pool for GitHub Actions OIDC."
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# --- Deployer service account --------------------------------------------

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "github-actions-deployer"
  display_name = "GitHub Actions deployer"
  description  = "Impersonated by GitHub Actions via WIF to run `just deploy dev`."
}

resource "google_service_account_iam_member" "wif_binding" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# --- Project-level roles for deploy.sh end-to-end ------------------------

locals {
  deployer_project_roles = toset([
    # Push container images.
    "roles/artifactregistry.writer",
    # Deploy Cloud Run revisions, manage services.
    "roles/run.admin",
    # Terraform manages secret resources + their IAM.
    "roles/secretmanager.admin",
    # Terraform manages Firebase Auth + Identity Platform config.
    "roles/firebase.admin",
    # Terraform manages Firestore database + indexes.
    "roles/datastore.owner",
    # Terraform manages project IAM bindings on the Cloud Run runtime SAs
    # and the Storage bucket.
    "roles/resourcemanager.projectIamAdmin",
    # Terraform manages google_project_service for the API set.
    "roles/serviceusage.serviceUsageAdmin",
    # Terraform manages google_service_account resources for runtime SAs.
    "roles/iam.serviceAccountAdmin",
    # Terraform manages the user data bucket + its IAM.
    "roles/storage.admin",
  ])
}

resource "google_project_iam_member" "deployer_project_roles" {
  for_each = local.deployer_project_roles
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# --- actAs on Cloud Run runtime service accounts -------------------------
#
# `roles/run.admin` lets the deployer manage Cloud Run services, but
# Google requires explicit serviceAccountUser on the runtime SAs whose
# identity the new revisions will run as.

resource "google_service_account_iam_member" "deployer_act_as" {
  for_each           = toset(var.cloud_run_service_accounts)
  service_account_id = "projects/${var.project_id}/serviceAccounts/${each.value}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# --- Tfstate bucket access -----------------------------------------------
#
# Project-level storage.admin already covers this, but bind on the bucket
# explicitly too so the role can be tightened later (drop project-level
# storage.admin) without breaking deploys.

resource "google_storage_bucket_iam_member" "deployer_state" {
  bucket = var.state_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.deployer.email}"
}

# --- Outputs --------------------------------------------------------------

output "workload_identity_provider" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "Full resource name of the WIF provider — passed to google-github-actions/auth as `workload_identity_provider`."
}

output "deployer_email" {
  value       = google_service_account.deployer.email
  description = "The deployer SA email — passed to google-github-actions/auth as `service_account`."
}
