#!/usr/bin/env bash
# deploy.sh — build Docker images for agent and/or web, push to Artifact
# Registry, then `terraform apply` with the resulting image tag.
#
# Flow:
#   1. Reads project_id + region from infra/envs/<env>/terraform.tfvars
#   2. Ensures Artifact Registry exists (terraform apply -target=module.artifact_registry)
#   3. Authenticates Docker to the registry (gcloud)
#   4. Builds the selected image(s) from the monorepo root
#   5. Pushes with tag = short git SHA (or 'local-<timestamp>' if no git)
#   6. Runs full terraform apply with -var image_tag=<tag>
#
# Usage:
#   ./infra/deploy.sh dev agent       # agent only
#   ./infra/deploy.sh dev web         # web only
#   ./infra/deploy.sh dev both        # default

set -euo pipefail

ENV="${1:-dev}"
WHICH="${2:-both}"

if [[ "$WHICH" != "agent" && "$WHICH" != "web" && "$WHICH" != "both" ]]; then
  echo "Usage: $0 <env> <agent|web|both>" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="${REPO_ROOT}/infra/envs/${ENV}"
TFVARS="${ENV_DIR}/terraform.tfvars"

[[ -f "${TFVARS}" ]] || { echo "Missing ${TFVARS}. Run bootstrap first." >&2; exit 1; }

PROJECT_ID="$(grep -E '^project_id[[:space:]]*=' "${TFVARS}" | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/')"
REGION="$(grep -E '^region[[:space:]]*=' "${TFVARS}" | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/')"
REPO_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/lifecoach"

TAG="$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD 2>/dev/null || echo "local-$(date +%s)")"
if ! git -C "${REPO_ROOT}" diff-index --quiet HEAD 2>/dev/null; then
  TAG="${TAG}-dirty"
fi

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }

ensure_registry() {
  if gcloud artifacts repositories describe lifecoach \
      --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    return 0
  fi
  log "Artifact Registry not found. Applying just the registry module first."
  (
    cd "${ENV_DIR}"
    terraform apply -auto-approve -var-file=terraform.tfvars \
      -target=module.apis -target=module.artifact_registry
  )
}

docker_auth() {
  log "Configuring Docker auth for ${REGION}-docker.pkg.dev"
  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet >/dev/null
}

build_and_push() {
  local name="$1"
  local context_dockerfile="apps/${name}/Dockerfile"
  local image="${REPO_URL}/lifecoach-${name}:${TAG}"
  log "Building ${image}"
  docker build \
    --platform=linux/amd64 \
    -f "${context_dockerfile}" \
    -t "${image}" \
    "${REPO_ROOT}"
  log "Pushing ${image}"
  docker push "${image}"
}

apply_terraform() {
  log "terraform apply with image_tag=${TAG}"
  (
    cd "${ENV_DIR}"
    terraform apply -auto-approve -var-file=terraform.tfvars -var="image_tag=${TAG}"
    echo
    log "Outputs:"
    terraform output
  )
}

main() {
  ensure_registry
  docker_auth
  if [[ "${WHICH}" == "agent" || "${WHICH}" == "both" ]]; then
    build_and_push agent
  fi
  if [[ "${WHICH}" == "web" || "${WHICH}" == "both" ]]; then
    build_and_push web
  fi
  apply_terraform
}

main "$@"
