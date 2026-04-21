# Docker repository for Lifecoach container images.

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "repository_id" {
  type        = string
  description = "Artifact Registry repository ID (short name)."
  default     = "lifecoach"
}

resource "google_artifact_registry_repository" "docker" {
  project       = var.project_id
  location      = var.region
  repository_id = var.repository_id
  format        = "DOCKER"
  description   = "Lifecoach container images"

  # Keep the 5 most recent versions per package to control storage costs in dev.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }
}

output "repository_url" {
  description = "Use as image registry prefix: <url>/<image>:<tag>"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "repository_id" {
  value = google_artifact_registry_repository.docker.repository_id
}
