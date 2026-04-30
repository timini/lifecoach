# Preview env — per-PR review apps

Each open PR gets its own pair of Cloud Run services living inside the dev
project:

```
lifecoach-agent-pr-<n>
lifecoach-web-pr-<n>
```

Their URLs are commented onto the PR by `.github/workflows/pr-preview-deploy.yml`,
and Playwright runs against the deployed web URL before the comment lands.

## Lifecycle

| Event                    | Workflow                            | Action                                                                 |
| ------------------------ | ----------------------------------- | ---------------------------------------------------------------------- |
| PR opened / synced       | `pr-preview-deploy.yml`             | Build + push images tagged `pr-<n>-<sha>`; `terraform apply`; comment. |
| PR closed (merged/abandon) | `pr-preview-teardown.yml`         | `terraform destroy`; comment confirming.                               |
| Daily 5 am UTC           | `preview-sweeper.yml`               | Sweep up Cloud Run services for closed PRs the close hook missed.      |

## What's reused vs. what's per-PR

- **Reused (owned by `infra/envs/dev`):**
  Project, APIs, Artifact Registry, Firebase Auth (incl. `run.app` parent
  domain in `authorized_domains`), Firestore, mem0 secret + IAM, GWS OAuth
  secret + IAM, GCS user bucket, Cloud Run runtime SAs.

- **Per-PR (owned by this env):**
  Two Cloud Run services and one terraform state object under
  `gs://<dev-tfstate-bucket>/previews/<pr_number>/default.tfstate`.

The runtime SAs are passed into the `cloud-run-service` module via
`existing_service_account`, which makes the module skip SA creation and
project-IAM bindings. That's how preview agents inherit the GWS /
Firestore / mem0 / user-bucket grants without the preview env having to
re-state them.

## Manual operations

```sh
# Deploy (or update) PR #123's preview locally — same script CI runs.
just deploy-preview 123

# Tear it down.
just teardown-preview 123

# Run e2e against PR #123's preview URL.
just e2e-preview 123
```

## State layout

Backend prefix is `previews/<pr_number>` so each PR's state is isolated.
`terraform init` is invoked with `-backend-config="prefix=previews/<n>"`
on top of the regular `backend.hcl` (which holds the bucket name). The
state bucket is the same one dev uses — there's no per-PR bucket.

## Invariant note

Per CLAUDE.md invariant #5, this env is fully Terraform-managed. Don't
edit Cloud Run services for an open PR in the GCP console — push a new
commit instead and let the preview-deploy workflow re-apply.
