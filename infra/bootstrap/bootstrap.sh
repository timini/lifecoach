#!/usr/bin/env bash
# bootstrap.sh — one-time per-environment GCP setup for Lifecoach.
#
# Creates:
#   - A GCP project (under an org)
#   - Billing account link
#   - Baseline API enablement
#   - A GCS bucket for Terraform state (versioned, uniform bucket-level access)
#   - infra/envs/<env>/backend.hcl and terraform.tfvars for Terraform
#
# Idempotent where possible — re-running on an already-bootstrapped env is a no-op.
#
# Usage:
#   LIFECOACH_ENV=dev \
#   LIFECOACH_PROJECT_ID=lifecoach-dev \
#   LIFECOACH_ORG_ID=59273835578 \
#   LIFECOACH_BILLING_ACCOUNT=00F211-1C6C40-2306DA \
#   LIFECOACH_REGION=us-central1 \
#     ./bootstrap.sh
#
# If LIFECOACH_PROJECT_ID is already taken globally, the script auto-appends a
# short random suffix and reports the final ID.

set -euo pipefail

# --- Inputs / defaults -----------------------------------------------------

: "${LIFECOACH_ENV:=dev}"
: "${LIFECOACH_PROJECT_ID:=lifecoach-${LIFECOACH_ENV}}"
: "${LIFECOACH_REGION:=us-central1}"
: "${LIFECOACH_ORG_ID:?LIFECOACH_ORG_ID is required (rewire.it = 59273835578)}"
: "${LIFECOACH_BILLING_ACCOUNT:?LIFECOACH_BILLING_ACCOUNT is required}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_DIR="${REPO_ROOT}/infra/envs/${LIFECOACH_ENV}"

# Baseline APIs every Lifecoach environment needs. Additions to this list
# should go into infra/modules/project-apis, not here — this script only
# enables what Terraform itself needs to run on day one.
BOOTSTRAP_APIS=(
  cloudresourcemanager.googleapis.com
  cloudbilling.googleapis.com
  serviceusage.googleapis.com
  iam.googleapis.com
  iamcredentials.googleapis.com
  storage.googleapis.com
)

# --- Helpers ---------------------------------------------------------------

log() { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[bootstrap] WARN\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[bootstrap] ERROR\033[0m %s\n' "$*" >&2; exit 1; }

check_prereqs() {
  command -v gcloud >/dev/null || die "gcloud is not installed"
  command -v terraform >/dev/null || die "terraform is not installed"
  local active
  active="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1)"
  [[ -n "${active}" ]] || die "No active gcloud account. Run: gcloud auth login"
  log "Active gcloud account: ${active}"

  if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
    warn "Application Default Credentials not set. Run: gcloud auth application-default login"
    warn "Terraform will fail without ADC. Continuing bootstrap anyway."
  fi
}

project_exists() {
  gcloud projects describe "$1" >/dev/null 2>&1
}

ensure_project_id_available() {
  # If we've already settled on a project ID in a prior run, reuse it.
  # This makes the script safely re-runnable after partial failures.
  if [[ -f "${ENV_DIR}/terraform.tfvars" ]]; then
    local prior
    prior="$(grep -E '^project_id[[:space:]]*=' "${ENV_DIR}/terraform.tfvars" | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/')"
    if [[ -n "${prior}" ]]; then
      LIFECOACH_PROJECT_ID="${prior}"
      log "Reusing project ID from prior run: ${LIFECOACH_PROJECT_ID}"
      return 0
    fi
  fi

  local base="${LIFECOACH_PROJECT_ID}"
  if project_exists "${base}"; then
    # Check it's in our org (we own it) — if so, reuse; else bail.
    local parent
    parent="$(gcloud projects describe "${base}" --format='value(parent.id)' 2>/dev/null || true)"
    if [[ "${parent}" == "${LIFECOACH_ORG_ID}" ]]; then
      log "Project ${base} already exists in our org — reusing."
      return 0
    fi
    warn "Project ID ${base} exists but is not in org ${LIFECOACH_ORG_ID}."
    warn "Will append a random suffix."
  elif gcloud projects list --filter="projectId:${base}" --format='value(projectId)' 2>/dev/null | grep -qx "${base}"; then
    warn "Project ID ${base} exists globally. Will append a random suffix."
  else
    # Heuristic: try to describe; if "permission denied" the ID is taken by someone else.
    local describe_err
    describe_err="$(gcloud projects describe "${base}" 2>&1 >/dev/null || true)"
    if echo "${describe_err}" | grep -q "PERMISSION_DENIED\|does not have permission"; then
      warn "Project ID ${base} is taken by another org. Will append a random suffix."
    else
      log "Project ID ${base} is available."
      return 0
    fi
  fi

  # Generate a 5-char lowercase-alphanumeric suffix. Piping tr|head trips
  # pipefail via SIGPIPE, so read a fixed chunk and filter instead.
  local suffix
  suffix="$(LC_ALL=C head -c 64 /dev/urandom | LC_ALL=C tr -dc 'a-z0-9' | cut -c1-5)"
  LIFECOACH_PROJECT_ID="${base}-${suffix}"
  log "New project ID: ${LIFECOACH_PROJECT_ID}"
}

create_project() {
  if project_exists "${LIFECOACH_PROJECT_ID}"; then
    log "Project ${LIFECOACH_PROJECT_ID} already exists — skipping create."
    return
  fi
  log "Creating project ${LIFECOACH_PROJECT_ID} in org ${LIFECOACH_ORG_ID}"
  gcloud projects create "${LIFECOACH_PROJECT_ID}" \
    --organization="${LIFECOACH_ORG_ID}" \
    --name="Lifecoach ${LIFECOACH_ENV}"
}

link_billing() {
  local current
  current="$(gcloud billing projects describe "${LIFECOACH_PROJECT_ID}" \
    --format='value(billingAccountName)' 2>/dev/null || true)"
  local want="billingAccounts/${LIFECOACH_BILLING_ACCOUNT}"
  if [[ "${current}" == "${want}" ]]; then
    log "Billing already linked (${LIFECOACH_BILLING_ACCOUNT})."
    return
  fi
  log "Linking billing account ${LIFECOACH_BILLING_ACCOUNT}"
  gcloud billing projects link "${LIFECOACH_PROJECT_ID}" \
    --billing-account="${LIFECOACH_BILLING_ACCOUNT}"
}

enable_apis() {
  log "Enabling bootstrap APIs (${#BOOTSTRAP_APIS[@]} total)"
  # One call enables many — cheaper and idempotent.
  gcloud services enable "${BOOTSTRAP_APIS[@]}" --project="${LIFECOACH_PROJECT_ID}"
}

with_retry() {
  # Retry a command up to 6 times with exponential backoff (2,4,8,16,32,64s).
  # Used for calls that may hit IAM propagation lag right after resource creation.
  local attempt=0 delay=2
  local label="$1"; shift
  until "$@"; do
    attempt=$((attempt + 1))
    if [[ ${attempt} -ge 6 ]]; then
      die "${label} failed after ${attempt} attempts"
    fi
    warn "${label} failed — likely IAM propagation. Retrying in ${delay}s..."
    sleep "${delay}"
    delay=$((delay * 2))
  done
}

create_state_bucket() {
  local bucket="${LIFECOACH_PROJECT_ID}-tfstate"
  if gcloud storage buckets describe "gs://${bucket}" --project="${LIFECOACH_PROJECT_ID}" >/dev/null 2>&1; then
    log "State bucket gs://${bucket} already exists."
  else
    log "Creating state bucket gs://${bucket}"
    gcloud storage buckets create "gs://${bucket}" \
      --project="${LIFECOACH_PROJECT_ID}" \
      --location="${LIFECOACH_REGION}" \
      --uniform-bucket-level-access \
      --public-access-prevention
  fi

  # Versioning is critical for Terraform state — protects against corruption.
  log "Enabling versioning on gs://${bucket}"
  with_retry "versioning update" \
    gcloud storage buckets update "gs://${bucket}" \
      --versioning --project="${LIFECOACH_PROJECT_ID}"

  # Lifecycle: keep the most recent N noncurrent versions, delete older.
  local lifecycle_json
  lifecycle_json="$(mktemp)"
  cat >"${lifecycle_json}" <<'JSON'
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": { "numNewerVersions": 10, "daysSinceNoncurrentTime": 30 }
      }
    ]
  }
}
JSON
  log "Applying lifecycle policy to gs://${bucket}"
  with_retry "lifecycle update" \
    gcloud storage buckets update "gs://${bucket}" \
      --lifecycle-file="${lifecycle_json}" \
      --project="${LIFECOACH_PROJECT_ID}"
  rm -f "${lifecycle_json}"
}

write_tf_config() {
  mkdir -p "${ENV_DIR}"
  local bucket="${LIFECOACH_PROJECT_ID}-tfstate"

  cat >"${ENV_DIR}/backend.hcl" <<HCL
# Generated by infra/bootstrap/bootstrap.sh. Do not commit.
bucket = "${bucket}"
prefix = "terraform/state"
HCL

  cat >"${ENV_DIR}/terraform.tfvars" <<HCL
# Generated by infra/bootstrap/bootstrap.sh. Do not commit.
project_id      = "${LIFECOACH_PROJECT_ID}"
region          = "${LIFECOACH_REGION}"
org_id          = "${LIFECOACH_ORG_ID}"
billing_account = "${LIFECOACH_BILLING_ACCOUNT}"
environment     = "${LIFECOACH_ENV}"
HCL

  log "Wrote ${ENV_DIR}/backend.hcl and terraform.tfvars"
}

summary() {
  cat <<EOF

============================================================
  Bootstrap complete for environment: ${LIFECOACH_ENV}
------------------------------------------------------------
  Project ID:      ${LIFECOACH_PROJECT_ID}
  Region:          ${LIFECOACH_REGION}
  Org ID:          ${LIFECOACH_ORG_ID}
  Billing:         ${LIFECOACH_BILLING_ACCOUNT}
  State bucket:    gs://${LIFECOACH_PROJECT_ID}-tfstate
============================================================

Next steps:
  cd ${ENV_DIR}
  terraform init -backend-config=backend.hcl
  terraform plan
  terraform apply

Or from the repo root:
  just tf-init ${LIFECOACH_ENV}
  just tf-plan ${LIFECOACH_ENV}
  just tf-apply ${LIFECOACH_ENV}
EOF
}

# --- Main ------------------------------------------------------------------

main() {
  log "Bootstrapping ${LIFECOACH_ENV} environment"
  check_prereqs
  ensure_project_id_available
  # Persist the chosen ID immediately so partial failures don't thrash suffixes.
  write_tf_config
  create_project
  link_billing
  enable_apis
  create_state_bucket
  summary
}

main "$@"
