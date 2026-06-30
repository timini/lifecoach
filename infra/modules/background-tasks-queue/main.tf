# Cloud Tasks queue for per-run background execution (ADR 0001, step 4c).
#
# The dispatcher enqueues one task per due run; Cloud Tasks delivers each as a
# POST to /background/runs/{runId}/execute with a per-task OIDC token (the
# invoker SA is set by the dispatcher at enqueue time, not on the queue).
#
# Rate limit + concurrency cap keep background load off the foreground chat
# path and within Gmail API + model budgets. Retry policy gives transient
# 5xx a bounded number of attempts — but the app owns terminal state
# (background_runs), never relying on Cloud Tasks as a dead-letter.

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
  description = "Location for the Cloud Tasks queue (matches the agent's region)."
}

variable "queue_name" {
  type    = string
  default = "background-agent-runs"
}

variable "max_dispatches_per_second" {
  type        = number
  description = "Queue dispatch-rate ceiling (env-tunable)."
}

variable "max_concurrent_dispatches" {
  type        = number
  description = "Max in-flight task deliveries (env-tunable)."
}

variable "max_attempts" {
  type        = number
  default     = 5
  description = "Per-task delivery attempts before Cloud Tasks gives up. App still owns terminal state."
}

variable "min_backoff" {
  type    = string
  default = "10s"
}

variable "max_backoff" {
  type    = string
  default = "300s"
}

resource "google_cloud_tasks_queue" "runs" {
  project  = var.project_id
  location = var.region
  name     = var.queue_name

  rate_limits {
    max_dispatches_per_second = var.max_dispatches_per_second
    max_concurrent_dispatches = var.max_concurrent_dispatches
  }

  retry_config {
    max_attempts = var.max_attempts
    min_backoff  = var.min_backoff
    max_backoff  = var.max_backoff
  }
}

output "queue_id" {
  value       = google_cloud_tasks_queue.runs.id
  description = "Full resource id; the dispatcher targets this queue when enqueuing run tasks."
}

output "queue_name" {
  value = google_cloud_tasks_queue.runs.name
}
