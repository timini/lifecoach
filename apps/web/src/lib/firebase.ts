'use client';

import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  type AuthError,
  EmailAuthProvider,
  GoogleAuthProvider,
  type User,
  getAuth,
  isSignInWithEmailLink,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signOut,
} from 'firebase/auth';

/**
 * Firebase client config — read from NEXT_PUBLIC_* env at build time so it
 * ends up in the client bundle. Provisioned by Terraform (infra/modules/
 * firebase-auth) and set on the Cloud Run web service.
 */
function readConfig(): FirebaseOptions {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !appId) {
    throw new Error(
      'Missing Firebase client config. Required: NEXT_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID,APP_ID}.',
    );
  }
  return { apiKey, authDomain, projectId, appId };
}

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

export function firebaseApp(): FirebaseApp {
  if (_app) return _app;
  const existing = getApps()[0];
  _app = existing ?? initializeApp(readConfig());
  return _app;
}

export function firebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(firebaseApp());
  return _auth;
}

/**
 * Ensures the user is signed in (anonymously if nothing else). Resolves with
 * the current user once auth has settled.
 */
export async function ensureSignedIn(): Promise<User> {
  const auth = firebaseAuth();
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      async (user) => {
        try {
          if (user) {
            unsub();
            resolve(user);
            return;
          }
          const cred = await signInAnonymously(auth);
          unsub();
          resolve(cred.user);
        } catch (err) {
          unsub();
          reject(err);
        }
      },
      (err) => {
        unsub();
        reject(err);
      },
    );
  });
}

/**
 * Subscribe to auth-state changes for the lifetime of the page. Used by
 * ChatWindow to keep its `user` React state in sync with whatever auth
 * action just landed — necessary for sign-in flows that bypass the
 * component's own handlers (the e2e window hook, or any future external
 * trigger). `cb` receives `null` on sign-out, the new User on sign-in.
 * Returns the unsubscribe.
 */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(firebaseAuth(), cb);
}

const EMAIL_PENDING_KEY = 'lifecoach.pendingEmail';
const WELCOME_SENT_KEY_PREFIX = 'lifecoach.welcomeSent.';

/**
 * Result shape for `linkWithGoogleResult`. `convertedAnonymousUser=true` when
 * we successfully promoted the current anonymous user to a Google identity
 * (UID preserved); `false` when `linkWithPopup` failed and we recovered by
 * signing into a pre-existing Google account (UID swap, fresh anon abandoned).
 *
 * Call sites use this to decide whether to send the welcome verification
 * email — recovered existing accounts already received a welcome the first
 * time they signed up.
 */
export interface GoogleLinkResult {
  user: User;
  convertedAnonymousUser: boolean;
}

/**
 * Link the current (anonymous) user to a Google account via popup. Preserves
 * the UID so all GCS/Firestore data follows the user through the upgrade.
 *
 * Returning-user case: if the Google account is already in use by another
 * Firebase user (the user signed out and is signing back in — a fresh anon
 * UID was created for them in the meantime), `linkWithPopup` rejects with
 * `auth/credential-already-in-use`. We catch that, pull the credential out
 * of the error, and sign in to the existing account directly. The freshly-
 * minted anonymous user is abandoned — fine, it had no data.
 *
 * The `Result` variant returns an explicit `convertedAnonymousUser` flag so
 * callers don't have to infer conversion-vs-recovery from error codes (which
 * are swallowed inside this function). Use this for the welcome-email send
 * site; the thin `linkWithGoogle()` wrapper is kept for legacy call sites
 * that just need the User.
 */
export async function linkWithGoogleResult(): Promise<GoogleLinkResult> {
  const auth = firebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('no current user — sign-in must complete first');
  // Snapshot `isAnonymous` BEFORE `linkWithPopup` — it flips to false on
  // a successful link. Without the snapshot we'd report every Google-link
  // (including the legitimate `email_verified → google` upgrade in Settings)
  // as an anonymous conversion, and the call-site would trigger a duplicate
  // welcome email to an already-identified user.
  const wasAnonymous = user.isAnonymous;
  const provider = new GoogleAuthProvider();
  try {
    const cred = await linkWithPopup(user, provider);
    return { user: cred.user, convertedAnonymousUser: wasAnonymous };
  } catch (err) {
    const credential = credentialFromAuthError(err);
    if (credential) {
      const cred = await signInWithCredential(auth, credential);
      return { user: cred.user, convertedAnonymousUser: false };
    }
    throw err;
  }
}

export async function linkWithGoogle(): Promise<User> {
  const result = await linkWithGoogleResult();
  return result.user;
}

/**
 * Pull the GoogleAuthProvider credential out of an auth error so we can
 * recover from the `credential-already-in-use` / `email-already-in-use`
 * cases. Firebase exposes the credential on the error in those exact
 * scenarios; null when it isn't recoverable.
 */
function credentialFromAuthError(
  err: unknown,
): ReturnType<typeof GoogleAuthProvider.credential> | null {
  if (!err || typeof err !== 'object') return null;
  const code = (err as AuthError).code;
  if (code !== 'auth/credential-already-in-use' && code !== 'auth/email-already-in-use') {
    return null;
  }
  return GoogleAuthProvider.credentialFromError(err as AuthError);
}

/**
 * Send the welcome email — a Firebase email-link that doubles as the
 * email-verification credential. Clicking it returns the user to `returnUrl`;
 * `completeEmailSignInLink` finishes the link onto the existing anonymous
 * UID via `linkWithCredential`, so saved progress survives the conversion.
 *
 * The `?welcome=1` query flag rides on the URL so the return-side handler
 * (and Firebase analytics / templates) can distinguish first-run welcome
 * emails from ordinary re-auth magic links.
 *
 * Per-uid+email localStorage guard prevents accidental repeat sends from
 * re-renders, double-clicks, or page reloads after a successful send. The
 * key is keyed on the auth identity so a fresh anon → Google upgrade still
 * sends one welcome even if a prior anon UID had one sent on its behalf.
 *
 * The guard stores the send timestamp (ms) and is honored only within
 * WELCOME_GUARD_TTL_MS. After that, a resend is allowed — covers the case
 * where the first email got lost in spam or expired before the user
 * clicked through. The guard is also cleared in completeEmailSignInLink
 * once the user successfully returns via the link, so a later "send me
 * another" from the same browser session works immediately.
 *
 * Returns `true` when an email was sent, `false` when the guard skipped it.
 */
export const WELCOME_GUARD_TTL_MS = 5 * 60_000; // 5 minutes

export async function sendWelcomeVerificationEmail(
  email: string,
  returnUrl: string,
): Promise<boolean> {
  const auth = firebaseAuth();
  const guardKey = welcomeSentKey(auth.currentUser?.uid ?? 'anon', email);
  if (typeof window !== 'undefined') {
    const recordedAt = parseGuardTimestamp(window.localStorage.getItem(guardKey));
    if (recordedAt !== null && Date.now() - recordedAt < WELCOME_GUARD_TTL_MS) {
      return false;
    }
  }
  await sendSignInLinkToEmail(auth, email, {
    url: withWelcomeFlag(returnUrl),
    handleCodeInApp: true,
  });
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(EMAIL_PENDING_KEY, email);
    window.localStorage.setItem(guardKey, String(Date.now()));
  }
  return true;
}

function parseGuardTimestamp(raw: string | null): number | null {
  if (raw === null) return null;
  // Back-compat: older entries stored the literal "true". Treat them as
  // a stale guard that has effectively no timestamp — return Date.now()
  // so the TTL check below treats them as "just sent" once, then they'll
  // be overwritten on next call.
  if (raw === 'true') return Date.now();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Back-compat alias for the email-signin call site (ChatWindow's email
 * magic-link entry). Same machinery as the welcome path — the email-link
 * sign-in flow IS the welcome for email signups.
 */
export async function sendEmailSignInLink(email: string, returnUrl: string): Promise<void> {
  await sendWelcomeVerificationEmail(email, returnUrl);
}

function withWelcomeFlag(returnUrl: string): string {
  try {
    const url = new URL(returnUrl);
    url.searchParams.set('welcome', '1');
    return url.toString();
  } catch {
    // Defensive: returnUrl is always built from window.location.href in
    // production. If somehow malformed, fall back to the raw value rather
    // than blocking the whole sign-up flow on a URL-parsing edge case.
    return returnUrl;
  }
}

function welcomeSentKey(uid: string, email: string): string {
  return `${WELCOME_SENT_KEY_PREFIX}${uid}.${email}`;
}

/**
 * If the current URL is a Firebase email-link return, finish the link on the
 * existing (anonymous) user — uses linkWithCredential so the UID is
 * preserved. Returns the user if a link happened, null if the URL wasn't an
 * email link.
 */
export async function completeEmailSignInLink(currentUrl: string): Promise<User | null> {
  const auth = firebaseAuth();
  if (!isSignInWithEmailLink(auth, currentUrl)) return null;

  const email =
    typeof window !== 'undefined' ? window.localStorage.getItem(EMAIL_PENDING_KEY) : null;
  if (!email) {
    // Unusual: user opened the email on a different device. Ideally we'd
    // prompt for the email; for MVP, sign them in fresh without linking.
    const cred = await signInWithEmailLink(auth, '', currentUrl);
    return cred.user;
  }

  const user = auth.currentUser;
  if (!user) {
    const cred = await signInWithEmailLink(auth, email, currentUrl);
    clearWelcomeAndPendingGuards(cred.user.uid, email);
    return cred.user;
  }

  const credential = EmailAuthProvider.credentialWithLink(email, currentUrl);
  const linked = await linkWithCredential(user, credential);
  clearWelcomeAndPendingGuards(linked.user.uid, email);
  return linked.user;
}

function clearWelcomeAndPendingGuards(uid: string, email: string): void {
  // Called once the email-link returns successfully — the welcome email
  // clearly arrived. Clearing the resend guard lets the user request a
  // fresh email from this browser immediately (e.g. for a new account)
  // without waiting out the TTL.
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(EMAIL_PENDING_KEY);
  window.localStorage.removeItem(welcomeSentKey(uid, email));
}

/**
 * Signs the current user out. ChatWindow's `ensureSignedIn()` effect will
 * immediately sign them back in anonymously, producing a fresh UID and an
 * empty Firestore session — the equivalent of "new user" for MVP.
 */
export async function signOutCurrent(): Promise<void> {
  await signOut(firebaseAuth());
}

/**
 * Sign in with email + password. Used by the e2e test harness; production
 * users go through Google sign-in or magic link. Safe to ship in prod
 * because callers must already know a valid password — the function just
 * delegates to Firebase Auth's standard primitive.
 */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(firebaseAuth(), email, password);
  return cred.user;
}

/**
 * E2E test hook: exposes a small set of auth helpers on `window` so a
 * Playwright spec can drive sign-in/sign-out without simulating the OAuth
 * popup. Always-on (dev and prod) — the surface is just real Firebase auth
 * that requires creds the caller has to know. The harness env injects
 * those creds from Secret Manager; nothing leaks otherwise.
 */
declare global {
  interface Window {
    __lifecoachE2E?: {
      signInWithEmail: (email: string, password: string) => Promise<User>;
      signOut: () => Promise<void>;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__lifecoachE2E = {
    signInWithEmail,
    signOut: signOutCurrent,
  };
}
