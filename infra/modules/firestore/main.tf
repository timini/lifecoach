# Firestore database for agent session storage (ADK sessions + events).
#
# One-time, irreversible creation: location and type cannot be changed after
# create. Native mode, nam5 multi-region (US, matches our Cloud Run).

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

variable "location_id" {
  type        = string
  default     = "nam5"
  description = "Firestore location. nam5 = US multi-region (matches Cloud Run in us-central1)."
}

variable "accessor_members" {
  type        = list(string)
  default     = []
  description = "IAM members (serviceAccount:…) granted roles/datastore.user."
}

resource "google_firestore_database" "db" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.location_id
  type        = "FIRESTORE_NATIVE"

  # Safety belt: once created, don't let Terraform accidentally delete the
  # whole database (which would wipe all session history). Explicit
  # `terraform destroy` on the resource still works.
  deletion_policy = "ABANDON"
}

resource "google_project_iam_member" "accessors" {
  for_each = toset(var.accessor_members)
  project  = var.project_id
  role     = "roles/datastore.user"
  member   = each.value

  depends_on = [google_firestore_database.db]
}

output "database_name" {
  value = google_firestore_database.db.name
}
