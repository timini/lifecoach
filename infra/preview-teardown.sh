#!/usr/bin/env bash
# preview-teardown.sh — `terraform destroy` for one PR's preview pair.
#
# Idempotent — running on an already-destroyed slot is a no-op (terraform
# plan shows zero resources, destroy applies nothing). The state object
# is left in GCS; that's harmless and the daily sweeper can prune later.
#
# Usage:
#   PR_NUMBER=42 ./infra/preview-teardown.sh

set -euo pipefail

: "${PR_NUMBER:?PR_NUMBER must be set}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="${REPO_ROOT}/infra/envs/dev"
PREVIEW_DIR="${REPO_ROOT}/infra/envs/preview"

log() { printf '\033[1;34m[preview-teardown]\033[0m %s\n' "$*" >&2; }

# We need dev's outputs only for project_id / region / SA emails — the
# destroy still has to evaluate the variables even though it's removing
# everything, because Terraform refreshes resources first.

log "terraform init dev"
(cd "${DEV_DIR}" && terraform init -input=false -backend-config=backend.hcl >&2)

PROJECT_ID="$(cd "${DEV_DIR}" && terraform output -raw project_id)"
REGION="$(grep -E '^region[[:space:]]*=' "${DEV_DIR}/terraform.tfvars" | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/')"

log "terraform init preview (prefix=previews/${PR_NUMBER})"
(
  cd "${PREVIEW_DIR}"
  terraform init -input=false -reconfigure \
    -backend-config="bucket=${PROJECT_ID}-tfstate" \
    -backend-config="prefix=previews/${PR_NUMBER}" >&2
)

log "terraform destroy"
(
  cd "${PREVIEW_DIR}"
  terraform destroy -auto-approve -input=false \
    -var="project_id=${PROJECT_ID}" \
    -var="region=${REGION}" \
    -var="pr_number=${PR_NUMBER}" \
    -var="image_tag=destroy-placeholder" \
    -var="firebase_api_key=destroy-placeholder" \
    -var="firebase_auth_domain=destroy-placeholder" \
    -var="firebase_app_id=destroy-placeholder" \
    -var="google_oauth_client_id=destroy-placeholder" >&2
)

log "torn down PR #${PR_NUMBER}"
