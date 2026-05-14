terraform {
  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
  }
}

variable "project_id" {
  type        = string
  description = "GCP project that owns the Cloud Run services and logs."
}

variable "region" {
  type        = string
  description = "Region for the Cloud Function and source bucket."
}

variable "environment" {
  type        = string
  description = "Sentry environment tag added to forwarded events."
}

variable "sentry_dsn" {
  type        = string
  sensitive   = true
  description = "Sentry DSN used by the forwarder. Empty values should skip this module at the caller."
}

variable "service_names" {
  type        = list(string)
  default     = ["lifecoach-web", "lifecoach-agent"]
  description = "Cloud Run service names whose ERROR+ logs should be forwarded."
}

variable "name" {
  type        = string
  default     = "cloud-logs-to-sentry"
  description = "Base resource name for the topic, sink, subscription, and function."
}

locals {
  source_dir         = "${path.module}/function"
  archive_path       = "${path.root}/.terraform/${var.name}.zip"
  service_filter     = join(" OR ", [for service in var.service_names : "resource.labels.service_name=\"${service}\""])
  logging_sink_filter = <<-EOT
    resource.type="cloud_run_revision"
    AND (${local.service_filter})
    AND severity>=ERROR
    AND NOT logName=~"audited"
  EOT
}

data "archive_file" "function" {
  type        = "zip"
  source_dir  = local.source_dir
  output_path = local.archive_path
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_pubsub_topic" "logs" {
  project = var.project_id
  name    = var.name
}

resource "google_logging_project_sink" "logs" {
  project                = var.project_id
  name                   = var.name
  destination            = "pubsub.googleapis.com/${google_pubsub_topic.logs.id}"
  filter                 = trimspace(local.logging_sink_filter)
  unique_writer_identity = true
}

resource "google_pubsub_topic_iam_member" "sink_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.logs.name
  role    = "roles/pubsub.publisher"
  member  = google_logging_project_sink.logs.writer_identity
}

resource "google_storage_bucket" "source" {
  project                     = var.project_id
  name                        = "${var.project_id}-${var.name}-source"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 30
    }
  }
}

resource "google_storage_bucket_object" "source" {
  bucket = google_storage_bucket.source.name
  name   = "function-${data.archive_file.function.output_md5}.zip"
  source = data.archive_file.function.output_path
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = substr(var.name, 0, 30)
  display_name = "Runtime SA for ${var.name}"
}

resource "google_service_account" "pubsub_push" {
  project      = var.project_id
  account_id   = substr("${var.name}-push", 0, 30)
  display_name = "Pub/Sub push SA for ${var.name}"
}

resource "google_cloudfunctions2_function" "forwarder" {
  project     = var.project_id
  location    = var.region
  name        = var.name
  description = "Forwards Cloud Run ERROR logs from Cloud Logging to Sentry."

  build_config {
    runtime     = "python312"
    entry_point = "forward_cloud_log_to_sentry"

    source {
      storage_source {
        bucket = google_storage_bucket.source.name
        object = google_storage_bucket_object.source.name
      }
    }
  }

  service_config {
    available_memory      = "256M"
    timeout_seconds       = 30
    max_instance_count    = 3
    service_account_email = google_service_account.runtime.email
    ingress_settings      = "ALLOW_INTERNAL_AND_GCLB"

    environment_variables = {
      SENTRY_DSN         = var.sentry_dsn
      SENTRY_ENVIRONMENT = var.environment
    }
  }
}

resource "google_service_account_iam_member" "pubsub_token_creator" {
  service_account_id = google_service_account.pubsub_push.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_cloudfunctions2_function_iam_member" "pubsub_invoker" {
  project        = var.project_id
  location       = var.region
  cloud_function = google_cloudfunctions2_function.forwarder.name
  role           = "roles/cloudfunctions.invoker"
  member         = "serviceAccount:${google_service_account.pubsub_push.email}"
}

resource "google_cloud_run_v2_service_iam_member" "pubsub_run_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.forwarder.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pubsub_push.email}"
}

resource "google_pubsub_subscription" "push" {
  project = var.project_id
  name    = var.name
  topic   = google_pubsub_topic.logs.name

  ack_deadline_seconds       = 30
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = google_cloudfunctions2_function.forwarder.service_config[0].uri

    oidc_token {
      service_account_email = google_service_account.pubsub_push.email
    }
  }

  depends_on = [
    google_service_account_iam_member.pubsub_token_creator,
    google_cloudfunctions2_function_iam_member.pubsub_invoker,
    google_cloud_run_v2_service_iam_member.pubsub_run_invoker,
  ]
}

output "topic_name" {
  value       = google_pubsub_topic.logs.name
  description = "Pub/Sub topic receiving Cloud Logging sink entries."
}

output "function_uri" {
  value       = google_cloudfunctions2_function.forwarder.service_config[0].uri
  description = "HTTP URI used by the Pub/Sub push subscription."
}
