# Cloud Scheduler tick job (ADR 0001, step 4b).
#
# A single per-env job is the coarse wake-up trigger: it POSTs the agent's
# /background/scheduler/tick endpoint on a fixed cadence (5 min prod /
# 15 min dev). The handler is a pure dispatcher — it sweeps due schedules and
# enqueues Cloud Tasks; it never calls Gmail/Calendar/the LLM.
#
# retry_count = 0 is deliberate (ADR §Infrastructure): the dispatcher's
# Firestore lease + Cloud Tasks dedupe make Scheduler retries unsafe (a slow
# tick that eventually succeeds still got the lease). A missed tick is simply
# picked up by the next one. attempt_deadline is short for the same reason —
# the dispatcher bounds its work with .limit(N) and drains backlog over ticks.

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
  description = "Region for the Cloud Scheduler job."
}

variable "job_name" {
  type    = string
  default = "lifecoach-background-tick"
}

variable "schedule" {
  type        = string
  description = "Cron cadence. 5 min in prod, 15 min in dev (pinned, not a range)."
}

variable "time_zone" {
  type    = string
  default = "Etc/UTC"
}

variable "agent_url" {
  type        = string
  description = "Base URL of the agent Cloud Run service. Also the OIDC audience the agent verifies."
}

variable "scheduler_sa_email" {
  type        = string
  description = "OIDC identity (background-scheduler SA) the job authenticates as."
}

variable "attempt_deadline" {
  type    = string
  default = "60s"
}

resource "google_cloud_scheduler_job" "tick" {
  project          = var.project_id
  region           = var.region
  name             = var.job_name
  description      = "ADR 0001 background dispatcher tick — sweeps due schedules, enqueues run tasks."
  schedule         = var.schedule
  time_zone        = var.time_zone
  attempt_deadline = var.attempt_deadline

  retry_config {
    retry_count        = 0
    max_retry_duration = "0s"
  }

  http_target {
    http_method = "POST"
    uri         = "${var.agent_url}/background/scheduler/tick"
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = var.scheduler_sa_email
      audience              = var.agent_url
    }
  }
}

output "job_name" {
  value = google_cloud_scheduler_job.tick.name
}
