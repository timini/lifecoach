# Bootstrap

One-time-per-environment scripts that stand up the GCP primitives Terraform itself needs: the project, billing link, state bucket, and a handful of foundational APIs.

**Run this once per environment. After it succeeds, every subsequent change is `terraform apply` — nothing else.** If you ever find yourself clicking in the GCP console or running ad-hoc `gcloud` commands to change infra, stop: put it in a Terraform module instead.

---

## Why a bootstrap step exists

Terraform needs a place to store state. That place is a GCS bucket. That bucket lives in a project. That project needs billing attached. None of that can bootstrap itself.

So we have **exactly one script** that creates those things. Everything else — Firebase Auth config, Cloud Run, GCS user-data buckets, IAM, Vertex Memory Bank — is Terraform.

---

## Prerequisites

- `gcloud` authenticated as a human with Project Creator + Billing User on the target org
- `gcloud auth application-default login` has been run (Terraform uses ADC)
- `terraform` installed
- You know your **org ID** and **billing account ID**
  - List: `gcloud organizations list`
  - List billing: `gcloud billing accounts list`

---

## Running it

```bash
LIFECOACH_ENV=dev \
LIFECOACH_PROJECT_ID=lifecoach-dev \
LIFECOACH_ORG_ID=59273835578 \
LIFECOACH_BILLING_ACCOUNT=00F211-1C6C40-2306DA \
LIFECOACH_REGION=us-central1 \
  ./bootstrap.sh
```

Or via Just from the repo root:

```bash
just bootstrap env=dev
```

(Set the env vars the Just recipe expects — see root `justfile`.)

If the project ID you chose is already taken globally, the script appends a random 5-char suffix and tells you the new ID. The script is otherwise idempotent — re-running on a bootstrapped environment is a no-op.

### What it does, in order

1. Validates `gcloud` is authenticated and ADC is set
2. Checks the project ID availability; picks a suffix if needed
3. `gcloud projects create` under the org
4. Links the billing account
5. Enables the six APIs Terraform needs to run (resource manager, billing, service usage, IAM, IAM credentials, storage)
6. Creates the state bucket `<project-id>-tfstate`:
   - Uniform bucket-level access
   - Versioning on (protects against state corruption)
   - Lifecycle rule: keep last 10 noncurrent versions for up to 30 days
   - Public access prevention on
7. Writes `infra/envs/<env>/backend.hcl` and `terraform.tfvars` (both gitignored — generated locally)

### What it deliberately does NOT do

- No service account key creation — keys are a footgun. Terraform runs locally as your gcloud identity via ADC. CI uses Workload Identity Federation, configured later via Terraform.
- No application APIs (Vertex, Firebase, Cloud Run, Places, etc.) — those belong in the Terraform `project-apis` module so the enablement set is reviewable and diffable.
- No resources inside the project. Terraform owns all of that.

---

## After bootstrap

```bash
just tf-init dev
just tf-plan dev
just tf-apply dev
```

From then on, any infra change is: edit a `.tf` file in `infra/envs/<env>/` or `infra/modules/`, then `terraform plan && terraform apply`.

---

## Teardown (dev/testing only)

```bash
LIFECOACH_ENV=dev LIFECOACH_PROJECT_ID=<actual-id> ./teardown.sh
```

This deletes the project (30-day grace period during which it can be restored) and removes the generated local config. **Do not run against prod** — there is no "undo" after the grace period.

---

## Debugging

| Symptom | Likely cause |
|---|---|
| `PERMISSION_DENIED` creating project | You don't have `resourcemanager.projectCreator` on the org |
| `FAILED_PRECONDITION` linking billing | Missing `billing.user` role on the billing account |
| `terraform init` fails with "no credentials" | Run `gcloud auth application-default login` |
| `terraform init` fails with "bucket does not exist" | Bootstrap didn't finish — re-run it |
| "Project ID ... is already in use" | Someone else owns that ID globally; the script will auto-suffix on the next run |
