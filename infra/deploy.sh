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

TAG="$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD 2>/dev/null || echo "local")"
if ! git -C "${REPO_ROOT}" diff-index --quiet HEAD 2>/dev/null; then
  # Dirty builds get a timestamp so Cloud Run pulls fresh bytes on each
  # deploy. Clean builds get the plain SHA so re-deploys of the same commit
  # are cache-friendly.
  TAG="${TAG}-dirty-$(date +%Y%m%d%H%M%S)"
fi

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }

ensure_terraform_init() {
  # Idempotent — `terraform init` is a no-op if `.terraform/` already
  # matches the backend config. CI starts from a fresh checkout so this
  # is the first thing that has to run; locally, it just confirms.
  log "Ensuring terraform init"
  (
    cd "${ENV_DIR}"
    terraform init -input=false -backend-config=backend.hcl
  )
}

ensure_prereq_infra() {
  # The web build needs Firebase config values as build args; Terraform must
  # have already created the Firebase project and web app before we build.
  # The agent's secret_env references GWS_OAUTH_CLIENT_SECRET — the secret
  # (with a version) and its IAM grant must exist before the Cloud Run
  # revision update or the revision fails to start.
  #
  # We also target the two cloud-run runtime SAs so any pending `moved`
  # blocks on them play through this targeted apply. Without this,
  # Terraform 1.9 errors with "Moved resource instances excluded by
  # targeting" because the module's moved-block instances aren't covered
  # by the other -target entries.
  log "Ensuring prereq infra: APIs, Artifact Registry, Firebase Auth, Workspace OAuth secret"
  (
    cd "${ENV_DIR}"
    terraform apply -auto-approve -var-file=terraform.tfvars \
      -target=module.apis \
      -target=module.artifact_registry \
      -target=module.firebase_auth \
      -target=module.gws_oauth_secret \
      -target=module.agent.google_service_account.runtime \
      -target=module.web.google_service_account.runtime
  )
}

firebase_build_args() {
  cd "${ENV_DIR}"
  local api_key auth_domain fb_project_id app_id gws_client_id sentry_dsn environment
  api_key="$(terraform output -raw firebase_api_key 2>/dev/null || true)"
  auth_domain="$(terraform output -raw firebase_auth_domain 2>/dev/null || true)"
  fb_project_id="$(terraform output -raw project_id 2>/dev/null || true)"
  app_id="$(terraform output -raw firebase_app_id 2>/dev/null || true)"
  # Reused for the GIS popup on the web side; the server-side code exchange
  # (agent) mounts the matching secret via Secret Manager.
  gws_client_id="$(terraform output -raw google_client_id 2>/dev/null || true)"
  # Sentry DSN is empty when telemetry is disabled — the SDK no-ops if so.
  # Public by Sentry's design (it's in the browser bundle).
  sentry_dsn="$(terraform output -raw sentry_dsn 2>/dev/null || true)"
  environment="$(terraform output -raw environment 2>/dev/null || true)"
  cd - >/dev/null
  printf -- "--build-arg NEXT_PUBLIC_FIREBASE_API_KEY=%s " "${api_key}"
  printf -- "--build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=%s " "${auth_domain}"
  printf -- "--build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID=%s " "${fb_project_id}"
  printf -- "--build-arg NEXT_PUBLIC_FIREBASE_APP_ID=%s " "${app_id}"
  printf -- "--build-arg NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=%s " "${gws_client_id}"
  printf -- "--build-arg NEXT_PUBLIC_SENTRY_DSN=%s " "${sentry_dsn}"
  printf -- "--build-arg NEXT_PUBLIC_SENTRY_ENVIRONMENT=%s " "${environment}"
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
  # Only the web image needs Firebase build-args (NEXT_PUBLIC_* are inlined
  # at build time). The agent reads Firebase config at runtime via ADC.
  local extra_args=""
  if [[ "${name}" == "web" ]]; then
    extra_args="$(firebase_build_args)"
  fi
  # shellcheck disable=SC2086
  docker build \
    --platform=linux/amd64 \
    ${extra_args} \
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
  ensure_terraform_init
  ensure_prereq_infra
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
