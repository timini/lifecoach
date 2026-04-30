#!/usr/bin/env bash
# preview-deploy.sh — build + push images for a single PR's preview, then
# `terraform apply` against the per-PR state slot.
#
# Idempotent — open or sync a PR multiple times and the same Cloud Run
# pair gets rolled to the new image with no new resources created. The
# image tag includes the short SHA so each push is a distinct revision.
#
# Usage:
#   PR_NUMBER=42 GIT_SHA=abcdef1 ./infra/preview-deploy.sh
#
# Reads dev's terraform outputs to get:
#   - project_id / region / repo URL (Artifact Registry)
#   - Firebase NEXT_PUBLIC_* build args (web image needs them at build time)
#
# (The runtime SA emails preview reuses are constructed from project_id
# inside infra/envs/preview/main.tf — same trick gws_oauth_secret uses to
# avoid a state-ordering cycle.)
#
# Prints final URLs as JSON on stdout for the caller to capture, e.g.:
#   {"agent_url":"https://...","web_url":"https://..."}

set -euo pipefail

: "${PR_NUMBER:?PR_NUMBER must be set}"
: "${GIT_SHA:?GIT_SHA must be set (short or long, will be normalised to 12)}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="${REPO_ROOT}/infra/envs/dev"
PREVIEW_DIR="${REPO_ROOT}/infra/envs/preview"

# Normalise to a short SHA so the image tag stays compact.
SHORT_SHA="${GIT_SHA:0:12}"
TAG="pr-${PR_NUMBER}-${SHORT_SHA}"

log() { printf '\033[1;34m[preview-deploy]\033[0m %s\n' "$*" >&2; }

# --- Read dev outputs (project, region, registry, SAs, Firebase args) ----

ensure_dev_init() {
  log "terraform init dev"
  (
    cd "${DEV_DIR}"
    terraform init -input=false -backend-config=backend.hcl >&2
  )
}

dev_output() {
  local key="$1"
  (cd "${DEV_DIR}" && terraform output -raw "${key}")
}

ensure_dev_init

PROJECT_ID="$(dev_output project_id)"
REGION="$(grep -E '^region[[:space:]]*=' "${DEV_DIR}/terraform.tfvars" | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/')"
REPO_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/lifecoach"

FIREBASE_API_KEY="$(dev_output firebase_api_key)"
FIREBASE_AUTH_DOMAIN="$(dev_output firebase_auth_domain)"
FIREBASE_APP_ID="$(dev_output firebase_app_id)"
GOOGLE_OAUTH_CLIENT_ID="$(dev_output google_client_id)"

# --- Docker auth + builds + pushes -----------------------------------------

log "Configuring Docker auth for ${REGION}-docker.pkg.dev"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet >/dev/null

build_and_push() {
  local name="$1"
  local image="${REPO_URL}/lifecoach-${name}:${TAG}"
  log "Building ${image}"
  local -a build_args=()
  if [[ "${name}" == "web" ]]; then
    build_args+=(
      --build-arg "NEXT_PUBLIC_FIREBASE_API_KEY=${FIREBASE_API_KEY}"
      --build-arg "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN}"
      --build-arg "NEXT_PUBLIC_FIREBASE_PROJECT_ID=${PROJECT_ID}"
      --build-arg "NEXT_PUBLIC_FIREBASE_APP_ID=${FIREBASE_APP_ID}"
      --build-arg "NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}"
    )
  fi
  docker build \
    --platform=linux/amd64 \
    "${build_args[@]}" \
    -f "${REPO_ROOT}/apps/${name}/Dockerfile" \
    -t "${image}" \
    "${REPO_ROOT}" >&2
  log "Pushing ${image}"
  docker push "${image}" >&2
}

build_and_push agent
build_and_push web

# --- Terraform apply against the per-PR state slot ------------------------

apply_preview() {
  log "terraform init preview (prefix=previews/${PR_NUMBER})"
  (
    cd "${PREVIEW_DIR}"
    terraform init -input=false -reconfigure \
      -backend-config="bucket=${PROJECT_ID}-tfstate" \
      -backend-config="prefix=previews/${PR_NUMBER}" >&2
  )

  log "terraform apply image_tag=${TAG}"
  (
    cd "${PREVIEW_DIR}"
    terraform apply -auto-approve -input=false \
      -var="project_id=${PROJECT_ID}" \
      -var="region=${REGION}" \
      -var="pr_number=${PR_NUMBER}" \
      -var="image_tag=${TAG}" \
      -var="firebase_api_key=${FIREBASE_API_KEY}" \
      -var="firebase_auth_domain=${FIREBASE_AUTH_DOMAIN}" \
      -var="firebase_app_id=${FIREBASE_APP_ID}" \
      -var="google_oauth_client_id=${GOOGLE_OAUTH_CLIENT_ID}" >&2
  )
}

apply_preview

# --- Emit URLs as JSON on stdout (CI captures via $(./preview-deploy.sh)) -

AGENT_URL="$(cd "${PREVIEW_DIR}" && terraform output -raw agent_url)"
WEB_URL="$(cd "${PREVIEW_DIR}" && terraform output -raw web_url)"

log "agent_url=${AGENT_URL}"
log "web_url=${WEB_URL}"
printf '{"agent_url":"%s","web_url":"%s","image_tag":"%s"}\n' \
  "${AGENT_URL}" "${WEB_URL}" "${TAG}"
