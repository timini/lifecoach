# Reusable Cloud Run service module.
#
# Owns: one google_cloud_run_v2_service, one service account for it, optional
# "allow public invocation" binding, and the IAM roles it needs on the project.

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

variable "service_name" {
  type        = string
  description = "Cloud Run service name. Also used as service account ID prefix."
}

variable "image" {
  type        = string
  description = "Fully qualified image, e.g. us-central1-docker.pkg.dev/<proj>/<repo>/<name>:<tag>"
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "env" {
  type        = map(string)
  default     = {}
  description = "Plain environment variables for the container."
}

variable "secret_env" {
  type = map(object({
    secret_id = string
    version   = optional(string, "latest")
  }))
  default     = {}
  description = "Environment variables sourced from Secret Manager secrets."
}

variable "allow_unauthenticated" {
  type        = bool
  default     = false
  description = "If true, adds roles/run.invoker to allUsers. Public HTTP."
}

variable "invoker_members" {
  type        = list(string)
  default     = []
  description = "Additional IAM members to grant roles/run.invoker (e.g., ['serviceAccount:...'])."
}

variable "project_roles" {
  type        = list(string)
  default     = []
  description = "Roles to grant the service account on the project (e.g., roles/aiplatform.user)."
}

variable "max_instances" {
  type    = number
  default = 3
}

variable "min_instances" {
  type    = number
  default = 0
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

# --- Service account -------------------------------------------------------

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = substr(var.service_name, 0, 30)
  display_name = "Runtime SA for ${var.service_name}"
}

resource "google_project_iam_member" "project_roles" {
  for_each = toset(var.project_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.runtime.email}"
}

# --- The service -----------------------------------------------------------

resource "google_cloud_run_v2_service" "svc" {
  project             = var.project_id
  location            = var.region
  name                = var.service_name
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      ports {
        container_port = var.container_port
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      dynamic "env" {
        for_each = var.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = env.value.version
            }
          }
        }
      }
    }
  }

  # Note: all deploys go through `just deploy` which passes image_tag to
  # Terraform, so we let Terraform own the image too. No ignore_changes.
}

# --- Optional public access ------------------------------------------------

resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.allow_unauthenticated ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.svc.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "invokers" {
  for_each = toset(var.invoker_members)
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.svc.name
  role     = "roles/run.invoker"
  member   = each.value
}

# --- Outputs --------------------------------------------------------------

output "url" {
  value = google_cloud_run_v2_service.svc.uri
}

output "service_account_email" {
  value = google_service_account.runtime.email
}

output "service_name" {
  value = google_cloud_run_v2_service.svc.name
}
