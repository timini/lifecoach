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

deploy-agent env="dev":
    pnpm --filter @lifecoach/agent build
    gcloud run deploy lifecoach-agent-{{env}} \
        --source apps/agent \
        --region us-central1 \
        --project lifecoach-{{env}}

deploy-web env="dev":
    pnpm --filter @lifecoach/web build
    firebase apphosting:backends:rollout lifecoach-web-{{env}} \
        --project lifecoach-{{env}}

# --- Ops -------------------------------------------------------------------

seed-user uid:
    pnpm --filter @lifecoach/agent exec tsx scripts/seed-user.ts {{uid}}

logs-agent env="dev":
    gcloud run services logs tail lifecoach-agent-{{env}} \
        --region us-central1 \
        --project lifecoach-{{env}}
