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

const EMAIL_PENDING_KEY = 'lifecoach.pendingEmail';

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
 */
export async function linkWithGoogle(): Promise<User> {
  const auth = firebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('no current user — sign-in must complete first');
  const provider = new GoogleAuthProvider();
  try {
    const cred = await linkWithPopup(user, provider);
    return cred.user;
  } catch (err) {
    const credential = credentialFromAuthError(err);
    if (credential) {
      const cred = await signInWithCredential(auth, credential);
      return cred.user;
    }
    throw err;
  }
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
 * Send a magic-link sign-in email. Caller stores the email so we can finish
 * linking when the user returns from the email link.
 */
export async function sendEmailSignInLink(email: string, returnUrl: string): Promise<void> {
  const auth = firebaseAuth();
  await sendSignInLinkToEmail(auth, email, {
    url: returnUrl,
    handleCodeInApp: true,
  });
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(EMAIL_PENDING_KEY, email);
  }
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
    window.localStorage.removeItem(EMAIL_PENDING_KEY);
    return cred.user;
  }

  const credential = EmailAuthProvider.credentialWithLink(email, currentUrl);
  const linked = await linkWithCredential(user, credential);
  window.localStorage.removeItem(EMAIL_PENDING_KEY);
  return linked.user;
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
