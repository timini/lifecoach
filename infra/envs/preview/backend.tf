# Per-PR preview state in the same dev tfstate bucket, separated by prefix.
#
# The CI workflow runs:
#   terraform init -backend-config=backend.hcl \
#                  -backend-config="prefix=previews/<pr_number>"
#
# That gives every PR its own state file under previews/<n>/default.tfstate.
# Closing the PR triggers `terraform destroy` which empties the state; the
# state object itself is harmless to leave behind (sweeper can prune later).
terraform {
  required_version = ">= 1.4.0"

  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.12"
    }
  }
}
