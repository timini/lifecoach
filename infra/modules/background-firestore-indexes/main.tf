# Firestore composite indexes for the background subsystem (ADR 0001, step 4e).
#
# Firestore needs an explicit composite index whenever a query combines an
# equality/range filter on one field with an order_by (or filters) on another.
# Two of these back queries that already ship in merged code; two are
# provisioned ahead of the digest/run-history UI (step 7) so those reads don't
# 400 the first time they run in prod.
#
# Indexes are defined against the (default) database; this module depends on
# the firestore module having created it.

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

variable "database" {
  type    = string
  default = "(default)"
}

# query_due: enabled == true AND nextRunAt <= now, ORDER BY nextRunAt.
# background_schedules.py::query_due (shipped).
resource "google_firestore_index" "schedules_due" {
  project    = var.project_id
  database   = var.database
  collection = "backgroundSchedules"

  fields {
    field_path = "enabled"
    order      = "ASCENDING"
  }
  fields {
    field_path = "nextRunAt"
    order      = "ASCENDING"
  }
}

# find_by_idempotency_key: idempotencyKey == X, ORDER BY createdAt.
# background_runs.py::find_by_idempotency_key (shipped).
resource "google_firestore_index" "runs_by_idempotency_key" {
  project    = var.project_id
  database   = var.database
  collection = "backgroundRuns"

  fields {
    field_path = "idempotencyKey"
    order      = "ASCENDING"
  }
  fields {
    field_path = "createdAt"
    order      = "ASCENDING"
  }
}

# Run history for a user: uid == X, ORDER BY createdAt DESC (step 7 UI).
resource "google_firestore_index" "runs_by_uid_recent" {
  project    = var.project_id
  database   = var.database
  collection = "backgroundRuns"

  fields {
    field_path = "uid"
    order      = "ASCENDING"
  }
  fields {
    field_path = "createdAt"
    order      = "DESCENDING"
  }
}

# Digest review queue: uid == X, status == Y, ORDER BY createdAt DESC (step 7).
resource "google_firestore_index" "notifications_by_uid_status_recent" {
  project    = var.project_id
  database   = var.database
  collection = "backgroundNotifications"

  fields {
    field_path = "uid"
    order      = "ASCENDING"
  }
  fields {
    field_path = "status"
    order      = "ASCENDING"
  }
  fields {
    field_path = "createdAt"
    order      = "DESCENDING"
  }
}
