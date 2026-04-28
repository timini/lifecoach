#!/usr/bin/env tsx
/**
 * One-shot script: provisions the dedicated e2e test user in a Firebase
 * Auth project, stores the password in Secret Manager, and tags the user
 * with a custom claim `e2e: true`.
 *
 * Idempotent — running it twice rotates the password (and the secret), but
 * keeps the same uid + email + claim. The Playwright spec's expectation that
 * sign-out → sign-in restores the previous transcript still holds across
 * password rotations because /history is keyed on (uid, sessionId), not
 * password.
 *
 * Usage:
 *   pnpm --filter @lifecoach/agent exec tsx \
 *     scripts/provision-e2e-user.ts --project=<gcp-project-id>
 *
 * Required: gcloud Application Default Credentials with permission to
 *   - Firebase Auth admin (firebaseauth.admin role on the project)
 *   - Secret Manager admin (roles/secretmanager.admin)
 *   - `gcloud` CLI on PATH (used for Secret Manager mutations).
 */

import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const E2E_EMAIL = 'e2e-test@lifecoach.invalid';
const SECRET_NAME = 'E2E_TEST_PASSWORD';

interface Args {
  project: string;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
    },
  });
  if (!values.project) {
    throw new Error('Missing --project=<gcp-project-id>');
  }
  return { project: values.project };
}

function generatePassword(): string {
  // 32 bytes hex → 64 chars; well above any password policy minimums.
  return randomBytes(32).toString('hex');
}

function gcloud(args: string[], project: string): string {
  return execSync(['gcloud', ...args, `--project=${project}`].join(' '), {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  }).trim();
}

function ensureSecretExists(project: string): void {
  try {
    gcloud(['secrets', 'describe', SECRET_NAME, '--format=value(name)'], project);
    return;
  } catch {
    // Doesn't exist yet — create it.
  }
  gcloud(['secrets', 'create', SECRET_NAME, '--replication-policy=automatic'], project);
  console.log(`Created secret ${SECRET_NAME}.`);
}

function addSecretVersion(project: string, password: string): void {
  // Pipe the password via stdin to avoid leaving it in argv / process list.
  execSync(`gcloud secrets versions add ${SECRET_NAME} --data-file=- --project=${project}`, {
    input: password,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

async function main() {
  const { project } = parseCliArgs();
  console.log(`Provisioning e2e user for project=${project}…`);

  initializeApp({ projectId: project });
  const auth = getAuth();
  const password = generatePassword();

  let uid: string;
  try {
    const existing = await auth.getUserByEmail(E2E_EMAIL);
    uid = existing.uid;
    await auth.updateUser(uid, {
      password,
      emailVerified: true,
      disabled: false,
    });
    console.log(`Updated existing user ${E2E_EMAIL} (uid=${uid}); rotated password.`);
  } catch (err: unknown) {
    if (!isUserNotFound(err)) throw err;
    const created = await auth.createUser({
      email: E2E_EMAIL,
      password,
      emailVerified: true,
      displayName: 'E2E Test User',
    });
    uid = created.uid;
    console.log(`Created user ${E2E_EMAIL} (uid=${uid}).`);
  }

  // Custom claim `e2e: true` lets server code optionally recognise this
  // user (e.g., suppress prod telemetry) without re-querying Auth.
  await auth.setCustomUserClaims(uid, { e2e: true });
  console.log(`Set custom claim { e2e: true } on uid=${uid}.`);

  ensureSecretExists(project);
  addSecretVersion(project, password);
  console.log(`Stored password in Secret Manager: ${SECRET_NAME}.`);

  console.log('\nDone. To use in the e2e test:');
  console.log(`  export E2E_TEST_EMAIL=${E2E_EMAIL}`);
  console.log(
    `  export E2E_TEST_PASSWORD=$(gcloud secrets versions access latest --secret=${SECRET_NAME} --project=${project})`,
  );
}

function isUserNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === 'auth/user-not-found';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
