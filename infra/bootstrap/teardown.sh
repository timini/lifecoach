#!/usr/bin/env bash
# teardown.sh — DESTRUCTIVE. Fully tears down a Lifecoach environment.
#
# Deletes the GCP project (and therefore all its resources), then removes the
# generated infra/envs/<env>/backend.hcl and terraform.tfvars files locally.
#
# This is ONLY for dev/testing. Do not run against prod.
#
# Usage:
#   LIFECOACH_ENV=dev LIFECOACH_PROJECT_ID=lifecoach-dev ./teardown.sh

set -euo pipefail

: "${LIFECOACH_ENV:?LIFECOACH_ENV is required}"
: "${LIFECOACH_PROJECT_ID:?LIFECOACH_PROJECT_ID is required}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_DIR="${REPO_ROOT}/infra/envs/${LIFECOACH_ENV}"

log() { printf '\033[1;34m[teardown]\033[0m %s\n' "$*"; }

confirm() {
  if [[ "${ASSUME_YES:-0}" == "1" ]]; then return 0; fi
  read -r -p "About to DELETE project ${LIFECOACH_PROJECT_ID}. Type the project ID to confirm: " answer
  [[ "${answer}" == "${LIFECOACH_PROJECT_ID}" ]] || { echo "Aborted."; exit 1; }
}

main() {
  confirm
  log "Deleting project ${LIFECOACH_PROJECT_ID}"
  gcloud projects delete "${LIFECOACH_PROJECT_ID}" --quiet

  log "Removing generated Terraform config in ${ENV_DIR}"
  rm -f "${ENV_DIR}/backend.hcl" "${ENV_DIR}/terraform.tfvars"
  rm -rf "${ENV_DIR}/.terraform" "${ENV_DIR}/.terraform.lock.hcl"

  log "Done. Project is scheduled for deletion (30-day grace period)."
}

main "$@"
