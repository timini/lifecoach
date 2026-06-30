# Background-work service accounts + OIDC invoker IAM (ADR 0001, step 4d).
#
# Two dedicated identities call the OIDC-gated /background/* routes:
#   - background-scheduler: Cloud Scheduler uses it to POST the tick endpoint.
#   - background-invoker:    Cloud Tasks uses it to POST the run-execute endpoint.
#
# Both get roles/run.invoker on the agent Cloud Run service. The OIDC token's
# audience is bound to the exact agent URL in the scheduler job (4b) and in
# each enqueued task (the dispatcher), and the agent verifies aud server-side
# (background/auth.py). If the worker later splits to a dedicated service, the
# invoker binding + audience must move with it.

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

variable "region" {
  type        = string
  description = "Region of the agent Cloud Run service (for the run.invoker binding)."
}

variable "agent_service_name" {
  type        = string
  description = "Name of the agent Cloud Run (v2) service the background SAs may invoke."
}

variable "agent_runtime_sa_email" {
  type        = string
  description = "The agent runtime SA — the dispatcher that enqueues Cloud Tasks. Needs actAs on the invoker SA to mint per-task OIDC tokens."
}

variable "deployer_sa_email" {
  type        = string
  description = "The Terraform deployer SA. Needs actAs on the scheduler SA to create the Cloud Scheduler job (4b) with that OIDC identity."
}

resource "google_service_account" "scheduler" {
  project      = var.project_id
  account_id   = "background-scheduler"
  display_name = "Background Scheduler OIDC identity (ADR 0001)"
  description  = "Cloud Scheduler calls POST /background/scheduler/tick as this SA."
}

resource "google_service_account" "invoker" {
  project      = var.project_id
  account_id   = "background-invoker"
  display_name = "Background Invoker OIDC identity (ADR 0001)"
  description  = "Cloud Tasks calls POST /background/runs/{runId}/execute as this SA."
}

resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  project  = var.project_id
  location = var.region
  name     = var.agent_service_name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_run_v2_service_iam_member" "tasks_invoker" {
  project  = var.project_id
  location = var.region
  name     = var.agent_service_name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.invoker.email}"
}

# Cloud Tasks `oidc_token.service_account_email = background-invoker` requires
# the CreateTask caller (the agent runtime SA) to have actAs on that SA.
resource "google_service_account_iam_member" "dispatcher_actas_invoker" {
  service_account_id = google_service_account.invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.agent_runtime_sa_email}"
}

# The Cloud Scheduler job (4b) uses background-scheduler as its OIDC identity;
# the Terraform deployer that creates the job needs actAs on that SA.
resource "google_service_account_iam_member" "deployer_actas_scheduler" {
  service_account_id = google_service_account.scheduler.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deployer_sa_email}"
}

output "scheduler_sa_email" {
  value       = google_service_account.scheduler.email
  description = "OIDC identity for the Cloud Scheduler tick job (4b)."
}

output "invoker_sa_email" {
  value       = google_service_account.invoker.email
  description = "OIDC identity for Cloud Tasks run execution (set per-task by the dispatcher)."
}
