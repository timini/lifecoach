# GCS bucket that holds per-user folders with user.yaml + goal_updates.json.
#
# Each user's data lives at gs://<bucket>/users/<uid>/. The bucket has
# uniform bucket-level access and public-access-prevention; grants are
# object-level via IAM on the bucket.

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
  type = string
}

variable "environment" {
  type        = string
  description = "Environment name — dev or prod. Used in the bucket name."
}

variable "writer_members" {
  type        = list(string)
  default     = []
  description = "IAM members (e.g., serviceAccount:...) that can read+write user data."
}

resource "google_storage_bucket" "users" {
  project                     = var.project_id
  name                        = "lifecoach-users-${var.environment}-${var.project_id}"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  # Soft-delete safety: keep deleted objects for 30 days so we can recover
  # from a bad tool call.
  soft_delete_policy {
    retention_duration_seconds = 30 * 24 * 60 * 60
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      num_newer_versions = 20
      days_since_noncurrent_time = 30
    }
  }
}

resource "google_storage_bucket_iam_member" "writers" {
  for_each = toset(var.writer_members)
  bucket   = google_storage_bucket.users.name
  role     = "roles/storage.objectUser"
  member   = each.value
}

output "bucket_name" {
  value = google_storage_bucket.users.name
}

output "bucket_url" {
  value = "gs://${google_storage_bucket.users.name}"
}
