# infra/

All Lifecoach infrastructure is declared here. The rule is simple:

> **Every infra change is a Terraform change.** No gcloud-poking, no console-clicking. The only exception is `bootstrap.sh`, which exists solely because Terraform state itself needs a bucket, and that bucket needs a project. After bootstrap, there is no manual step — ever.

---

## Layout

```
infra/
├── README.md                  # this file
├── bootstrap/                 # ONE-TIME per environment
│   ├── README.md              # when/how to run
│   ├── bootstrap.sh           # creates project, billing link, state bucket
│   └── teardown.sh            # destroys env (dev/testing only)
├── envs/
│   └── dev/                   # dev environment composition
│       ├── README.md
│       ├── backend.tf         # GCS backend declaration
│       ├── providers.tf       # google / google-beta
│       ├── variables.tf
│       ├── main.tf            # wires modules together
│       ├── terraform.tfvars.example
│       └── backend.hcl.example
└── modules/
    └── project-apis/          # enables the APIs the project needs
        └── main.tf
```

Future modules (added as phases land): `gcs-user-bucket`, `firebase-auth`, `firebase-hosting`, `cloud-run-agent`, `vertex-memory-bank`, `iam`, `workload-identity-federation`.

---

## First-time setup (per environment)

```bash
# Set once, or export in your shell profile
export LIFECOACH_ORG_ID=59273835578               # rewire.it
export LIFECOACH_BILLING_ACCOUNT=00F211-1C6C40-2306DA

# Make sure ADC is set (Terraform reads it)
gcloud auth application-default login

# Bootstrap dev
just bootstrap env=dev

# Apply Terraform
just tf-init dev
just tf-apply dev
```

If the project ID is globally taken, the bootstrap script adds a random suffix and tells you what it used.

---

## Day-to-day infra changes

1. Edit a `.tf` file (in `envs/<env>/` or `modules/<name>/`).
2. `just tf-plan dev` — read the plan carefully. Unexpected destroys or replacements mean stop and investigate.
3. `just tf-apply dev`.
4. Commit the `.tf` changes.

Adding a new service or API? → add it to `modules/project-apis/main.tf`.

---

## What's in the state bucket

One GCS bucket per environment: `<project-id>-tfstate`. It has:

- Uniform bucket-level access (no legacy ACLs)
- Versioning on (so we can recover from a bad apply)
- Public access prevention on
- Lifecycle: keep the last 10 noncurrent versions for up to 30 days

The bucket itself is created by `bootstrap.sh`. It is **not** managed by Terraform — managing the state bucket from within its own state is a race condition.

---

## Authentication

- **Local development:** Application Default Credentials (`gcloud auth application-default login`). Your human identity on the project does everything.
- **CI:** Workload Identity Federation from GitHub Actions. Configured by a future `modules/workload-identity-federation/` module. No long-lived service-account keys — ever.

---

## Debugging a bad apply

- Read the plan. If it's destroying something unexpectedly, the answer is never `terraform apply -auto-approve`.
- If state is corrupted, fetch an older version from the GCS bucket (it's versioned) and restore it.
- If you need to import an externally-created resource: `terraform import <addr> <id>`. Try not to do this — it means something bypassed Terraform, which is exactly what we're avoiding.

---

## Prod

Prod is a separate project and a separate `infra/envs/prod/` directory. It does not exist yet — it gets created in Phase 11. Until then, we only run dev.
