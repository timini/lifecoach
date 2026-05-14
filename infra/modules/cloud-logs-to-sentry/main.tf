# Forward selected Cloud Run ERROR logs from Cloud Logging to Sentry.
#
# Flow: Cloud Logging project sink -> Pub/Sub topic -> authenticated push
# subscription -> HTTP Cloud Functions (2nd gen) -> Sentry Store API.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

variable "project_id" {
  type        = string
  description = "GCP project ID containing the Cloud Run services and logs."
}

variable "region" {
  type        = string
  description = "Region for the Cloud Function and source bucket."
}

variable "environment" {
  type        = string
  description = "Sentry environment tag set on forwarded events."
}

variable "sentry_dsn" {
  type        = string
  sensitive   = true
  description = "Sentry DSN for the project that should receive Cloud Logging events."
}

variable "service_names" {
  type        = list(string)
  default     = ["lifecoach-web", "lifecoach-agent"]
  description = "Cloud Run service names whose ERROR-or-higher logs should be forwarded."
}

locals {
  name                 = "cloud-logs-to-sentry"
  service_filter       = join(" OR ", [for service in var.service_names : "resource.labels.service_name=\"${service}\""])
  log_filter           = "resource.type=\"cloud_run_revision\" AND (${local.service_filter}) AND severity>=ERROR AND NOT logName=~\"audited\""
  function_source_dir  = "${path.module}/function"
  function_source_zip  = "${path.root}/.terraform/${local.name}.zip"
  function_bucket_name = "${var.project_id}-${local.name}-${var.region}"
}

data "google_project" "current" {
  project_id = var.project_id
}

data "archive_file" "function_source" {
  type        = "zip"
  source_dir  = local.function_source_dir
  output_path = local.function_source_zip
}

resource "google_service_account" "function" {
  project      = var.project_id
  account_id   = "logs-to-sentry-fn"
  display_name = "Cloud Logs to Sentry function runtime"
}

resource "google_service_account" "push" {
  project      = var.project_id
  account_id   = "logs-to-sentry-push"
  display_name = "Cloud Logs to Sentry Pub/Sub push identity"
}

resource "google_storage_bucket" "function_source" {
  project                     = var.project_id
  name                        = local.function_bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}

resource "google_storage_bucket_object" "function_source" {
  bucket = google_storage_bucket.function_source.name
  name   = "function-${data.archive_file.function_source.output_md5}.zip"
  source = data.archive_file.function_source.output_path
}

resource "google_pubsub_topic" "logs" {
  project = var.project_id
  name    = local.name
}

resource "google_logging_project_sink" "cloud_run_errors" {
  project                = var.project_id
  name                   = local.name
  destination            = "pubsub.googleapis.com/${google_pubsub_topic.logs.id}"
  filter                 = local.log_filter
  unique_writer_identity = true
}

resource "google_pubsub_topic_iam_member" "sink_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.logs.name
  role    = "roles/pubsub.publisher"
  member  = google_logging_project_sink.cloud_run_errors.writer_identity
}

resource "google_cloudfunctions2_function" "forwarder" {
  project     = var.project_id
  location    = var.region
  name        = local.name
  description = "Forwards Cloud Run ERROR logs from Cloud Logging to Sentry."

  build_config {
    runtime     = "python312"
    entry_point = "forward_log_entry"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source.name
      }
    }
  }

  service_config {
    available_memory      = "256M"
    timeout_seconds       = 30
    service_account_email = google_service_account.function.email
    environment_variables = {
      SENTRY_DSN         = var.sentry_dsn
      SENTRY_ENVIRONMENT = var.environment
    }
  }

  depends_on = [google_storage_bucket_object.function_source]
}

resource "google_cloud_run_v2_service_iam_member" "push_invoker" {
  project  = var.project_id
  location = var.region
  name     = regex("[^/]+$", google_cloudfunctions2_function.forwarder.service_config[0].service)
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.push.email}"
}

resource "google_service_account_iam_member" "pubsub_push_token_creator" {
  service_account_id = google_service_account.push.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription" "push_to_function" {
  project = var.project_id
  name    = local.name
  topic   = google_pubsub_topic.logs.name

  ack_deadline_seconds       = 30
  message_retention_duration = "604800s"

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  push_config {
    push_endpoint = google_cloudfunctions2_function.forwarder.service_config[0].uri

    oidc_token {
      service_account_email = google_service_account.push.email
      audience              = google_cloudfunctions2_function.forwarder.service_config[0].uri
    }
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.push_invoker,
    google_service_account_iam_member.pubsub_push_token_creator,
    google_pubsub_topic_iam_member.sink_publisher,
  ]
}

output "topic_name" {
  value       = google_pubsub_topic.logs.name
  description = "Pub/Sub topic receiving Cloud Logging sink entries."
}

output "subscription_name" {
  value       = google_pubsub_subscription.push_to_function.name
  description = "Pub/Sub push subscription that invokes the forwarder."
}

output "function_uri" {
  value       = google_cloudfunctions2_function.forwarder.service_config[0].uri
  description = "HTTP URI of the Cloud Logs to Sentry forwarder."
}

output "log_filter" {
  value       = local.log_filter
  description = "Cloud Logging filter used by the project sink."
}
