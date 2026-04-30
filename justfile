set shell := ["bash", "-cu"]
set dotenv-load := true

default:
    @just --list

# --- Setup -----------------------------------------------------------------

install:
    pnpm install
    pnpm lefthook install

clean:
    pnpm clean
    rm -rf node_modules

# --- Dev -------------------------------------------------------------------

dev:
    pnpm turbo run dev --parallel

dev-web:
    pnpm --filter @lifecoach/web dev

dev-agent:
    pnpm --filter @lifecoach/agent dev

# --- Quality ---------------------------------------------------------------

lint:
    pnpm biome check --write .

lint-ci:
    pnpm biome check .

typecheck:
    pnpm turbo run typecheck

test:
    pnpm turbo run test

test-watch:
    pnpm --filter ...  run test -- --watch

coverage:
    pnpm turbo run test:coverage

# Fails if IP-based geolocation tokens appear in source or dependency files.
# Scans only code and package manifests — docs/configs may reference the rule by name.
guard-no-ip-geolocation:
    #!/usr/bin/env bash
    set -eu
    patterns='x-forwarded-for|cf-connecting-ip|geoip-lite|@maxmind|ipinfo|ip-api\.com|ipapi\.co|node-geoip'
    scan_globs='apps/**/src/**/*.ts apps/**/src/**/*.tsx packages/**/src/**/*.ts apps/*/package.json packages/*/package.json'
    # shellcheck disable=SC2086
    files=$(git ls-files $scan_globs 2>/dev/null || true)
    if [ -z "$files" ]; then exit 0; fi
    if echo "$files" | xargs grep -l -I -E "$patterns" 2>/dev/null; then
        echo "ERROR: IP-based geolocation is forbidden. See CLAUDE.md."
        exit 1
    fi

check: lint-ci typecheck test guard-no-ip-geolocation

# --- Build -----------------------------------------------------------------

build:
    pnpm turbo run build

# --- E2E -------------------------------------------------------------------

e2e:
    pnpm --filter @lifecoach/web exec playwright test

# --- Infra -----------------------------------------------------------------

# One-time-per-env: create the GCP project, billing link, state bucket, and
# write backend.hcl + terraform.tfvars. Reads LIFECOACH_* env vars (see
# infra/bootstrap/README.md).
bootstrap env="dev":
    LIFECOACH_ENV={{env}} infra/bootstrap/bootstrap.sh

tf-init env="dev":
    cd infra/envs/{{env}} && terraform init -backend-config=backend.hcl -reconfigure

tf-plan env="dev":
    cd infra/envs/{{env}} && terraform plan -var-file=terraform.tfvars

tf-apply env="dev":
    cd infra/envs/{{env}} && terraform apply -var-file=terraform.tfvars

tf-destroy env="dev":
    cd infra/envs/{{env}} && terraform destroy -var-file=terraform.tfvars

# DANGEROUS: tears down the whole environment including the GCP project.
# Dev/testing only. Requires ASSUME_YES=1 or interactive confirmation.
teardown env="dev":
    LIFECOACH_ENV={{env}} infra/bootstrap/teardown.sh

# --- Deploy ----------------------------------------------------------------

deploy env="dev":
    infra/deploy.sh {{env}} both

deploy-agent env="dev":
    infra/deploy.sh {{env}} agent

deploy-web env="dev":
    infra/deploy.sh {{env}} web

# --- Review apps (per-PR previews) -----------------------------------------

# Spin up (or update) the per-PR Cloud Run pair locally — same script CI runs.
deploy-preview pr:
    #!/usr/bin/env bash
    set -eu
    PR_NUMBER="{{pr}}" \
    GIT_SHA="$(git rev-parse HEAD)" \
    infra/preview-deploy.sh

# Tear down a PR's preview pair.
teardown-preview pr:
    #!/usr/bin/env bash
    set -eu
    PR_NUMBER="{{pr}}" infra/preview-teardown.sh

# Run the e2e suite against an existing PR's preview URL.
e2e-preview pr:
    #!/usr/bin/env bash
    set -eu
    project=$(cd infra/envs/dev && terraform output -raw project_id)
    base_url=$(cd infra/envs/preview && \
      terraform init -input=false -reconfigure \
        -backend-config="bucket=${project}-tfstate" \
        -backend-config="prefix=previews/{{pr}}" >/dev/null && \
      terraform output -raw web_url)
    password=$(gcloud secrets versions access latest --secret=E2E_TEST_PASSWORD --project="$project")
    E2E_BASE_URL="$base_url" \
    E2E_TEST_EMAIL="e2e-test@lifecoach.invalid" \
    E2E_TEST_PASSWORD="$password" \
    pnpm --filter @lifecoach/web exec playwright test

# --- Ops -------------------------------------------------------------------

seed-user uid:
    pnpm --filter @lifecoach/agent exec tsx scripts/seed-user.ts {{uid}}

# Idempotent: creates / updates the dedicated e2e test user and stores its
# password in Secret Manager (E2E_TEST_PASSWORD). See apps/agent/scripts/
# provision-e2e-user.ts for prerequisites (firebaseauth.admin + secretmanager
# .admin on the caller's gcloud ADC).
provision-e2e-user env="dev":
    #!/usr/bin/env bash
    set -eu
    project=$(cd infra/envs/{{env}} && terraform output -raw project_id)
    pnpm --filter @lifecoach/agent exec tsx scripts/provision-e2e-user.ts --project="$project"

# Runs the chat-persistence Playwright spec against an environment. Reads
# baseURL + creds from the deployed Cloud Run web URL and Secret Manager.
e2e-deployed env="dev":
    #!/usr/bin/env bash
    set -eu
    project=$(cd infra/envs/{{env}} && terraform output -raw project_id)
    base_url=$(cd infra/envs/{{env}} && terraform output -raw web_url)
    password=$(gcloud secrets versions access latest --secret=E2E_TEST_PASSWORD --project="$project")
    E2E_BASE_URL="$base_url" \
    E2E_TEST_EMAIL="e2e-test@lifecoach.invalid" \
    E2E_TEST_PASSWORD="$password" \
    pnpm --filter @lifecoach/web exec playwright test

logs-agent env="dev":
    #!/usr/bin/env bash
    set -eu
    cd infra/envs/{{env}}
    project=$(terraform output -raw project_id)
    region=$(grep -E '^region[[:space:]]*=' terraform.tfvars | sed -E 's/.*"([^"]+)".*/\1/')
    gcloud run services logs tail lifecoach-agent --region "$region" --project "$project"

logs-web env="dev":
    #!/usr/bin/env bash
    set -eu
    cd infra/envs/{{env}}
    project=$(terraform output -raw project_id)
    region=$(grep -E '^region[[:space:]]*=' terraform.tfvars | sed -E 's/.*"([^"]+)".*/\1/')
    gcloud run services logs tail lifecoach-web --region "$region" --project "$project"
