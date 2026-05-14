# Cloud Logging ERROR entries -> Pub/Sub -> Cloud Function -> Sentry Store API.
#
# This catches Cloud Run failures that the in-process Sentry SDK cannot see:
# stderr-only traceback writes, OOM/container crashes, and Google infra errors.

terraform {
  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
  }
}

variable "project_id" {
  type        = string
  description = "GCP project ID that owns the Cloud Run services and logs."
}

variable "region" {
  type        = string
  description = "Region for the Cloud Function and source bucket."
}

variable "environment" {
  type        = string
  description = "Environment tag sent to Sentry, for example dev or prod."
}

variable "sentry_dsn" {
  type        = string
  default     = ""
  description = "Sentry DSN used to forward Cloud Logging errors. Empty disables all resources."
}

variable "service_names" {
  type        = list(string)
  default     = ["lifecoach-web", "lifecoach-agent"]
  description = "Cloud Run service names whose ERROR+ logs should be forwarded."
}

variable "function_name" {
  type        = string
  default     = "cloud-logs-to-sentry"
  description = "Name for the Cloud Function and related resources."
}

data "google_project" "current" {
  count      = local.enabled ? 1 : 0
  project_id = var.project_id
}

locals {
  enabled = var.sentry_dsn != ""

  service_filter = join(" OR ", [
    for service_name in var.service_names : "resource.labels.service_name=\"${service_name}\""
  ])

  log_filter = <<-EOT
    resource.type="cloud_run_revision"
    AND (${local.service_filter})
    AND severity>=ERROR
    AND NOT logName=~"audited"
  EOT
}

resource "google_pubsub_topic" "logs" {
  count   = local.enabled ? 1 : 0
  project = var.project_id
  name    = var.function_name
}

resource "google_logging_project_sink" "logs" {
  count                  = local.enabled ? 1 : 0
  project                = var.project_id
  name                   = var.function_name
  destination            = "pubsub.googleapis.com/${google_pubsub_topic.logs[0].id}"
  filter                 = local.log_filter
  unique_writer_identity = true
}

resource "google_pubsub_topic_iam_member" "sink_publisher" {
  count   = local.enabled ? 1 : 0
  project = var.project_id
  topic   = google_pubsub_topic.logs[0].name
  role    = "roles/pubsub.publisher"
  member  = google_logging_project_sink.logs[0].writer_identity
}

resource "google_service_account" "function" {
  count        = local.enabled ? 1 : 0
  project      = var.project_id
  account_id   = substr(var.function_name, 0, 30)
  display_name = "Cloud Logs to Sentry forwarder"
}

resource "google_service_account_iam_member" "pubsub_token_creator" {
  count              = local.enabled ? 1 : 0
  service_account_id = google_service_account.function[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member = (
    "serviceAccount:service-${data.google_project.current[0].number}"
    + "@gcp-sa-pubsub.iam.gserviceaccount.com"
  )
}

resource "google_storage_bucket" "source" {
  count                       = local.enabled ? 1 : 0
  project                     = var.project_id
  name                        = "${var.project_id}-${var.function_name}-src"
  location                    = var.region
  uniform_bucket_level_access = true

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 30
    }
  }
}

data "archive_file" "function" {
  count       = local.enabled ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/function"
  output_path = "${path.root}/.terraform/${var.function_name}.zip"
}

resource "google_storage_bucket_object" "source" {
  count  = local.enabled ? 1 : 0
  name   = "${var.function_name}-${data.archive_file.function[0].output_sha256}.zip"
  bucket = google_storage_bucket.source[0].name
  source = data.archive_file.function[0].output_path
}

resource "google_cloudfunctions2_function" "forwarder" {
  count       = local.enabled ? 1 : 0
  project     = var.project_id
  location    = var.region
  name        = var.function_name
  description = "Forward Cloud Run ERROR logs from Cloud Logging to Sentry."

  build_config {
    runtime     = "python312"
    entry_point = "forward_cloud_log"

    source {
      storage_source {
        bucket = google_storage_bucket.source[0].name
        object = google_storage_bucket_object.source[0].name
      }
    }
  }

  service_config {
    available_memory      = "256M"
    timeout_seconds       = 30
    max_instance_count    = 3
    service_account_email = google_service_account.function[0].email

    environment_variables = {
      SENTRY_DSN         = var.sentry_dsn
      SENTRY_ENVIRONMENT = var.environment
    }
  }
}

resource "google_cloudfunctions2_function_iam_member" "subscription_invoker" {
  count          = local.enabled ? 1 : 0
  project        = var.project_id
  location       = var.region
  cloud_function = google_cloudfunctions2_function.forwarder[0].name
  role           = "roles/cloudfunctions.invoker"
  member         = "serviceAccount:${google_service_account.function[0].email}"
}

resource "google_cloud_run_v2_service_iam_member" "subscription_run_invoker" {
  count    = local.enabled ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.forwarder[0].service_config[0].service
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.function[0].email}"
}

resource "google_pubsub_subscription" "push" {
  count   = local.enabled ? 1 : 0
  project = var.project_id
  name    = var.function_name
  topic   = google_pubsub_topic.logs[0].name

  ack_deadline_seconds       = 30
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = google_cloudfunctions2_function.forwarder[0].service_config[0].uri

    oidc_token {
      service_account_email = google_service_account.function[0].email
    }
  }

  depends_on = [
    google_cloudfunctions2_function_iam_member.subscription_invoker,
    google_cloud_run_v2_service_iam_member.subscription_run_invoker,
    google_service_account_iam_member.pubsub_token_creator,
  ]
}

output "topic_name" {
  value       = local.enabled ? google_pubsub_topic.logs[0].name : null
  description = "Pub/Sub topic receiving matching Cloud Logging entries."
}

output "function_name" {
  value       = local.enabled ? google_cloudfunctions2_function.forwarder[0].name : null
  description = "Cloud Function forwarding logs to Sentry."
}
