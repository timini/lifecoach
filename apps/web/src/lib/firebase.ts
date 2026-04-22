'use client';

import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
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
  signInWithEmailLink,
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
 */
export async function linkWithGoogle(): Promise<User> {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('no current user — sign-in must complete first');
  const provider = new GoogleAuthProvider();
  const cred = await linkWithPopup(user, provider);
  return cred.user;
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
