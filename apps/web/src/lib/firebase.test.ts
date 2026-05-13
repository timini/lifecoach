import type { User } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  currentUser: null as User | null,
}));

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(() => authState),
  linkWithPopup: vi.fn(),
  signInWithCredential: vi.fn(),
  sendSignInLinkToEmail: vi.fn(),
  credentialFromError: vi.fn(),
}));

vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => [{}]),
  initializeApp: vi.fn(() => ({ name: 'test-app' })),
}));

vi.mock('firebase/auth', () => {
  const GoogleAuthProvider = Object.assign(vi.fn(), {
    credentialFromError: mocks.credentialFromError,
  });
  return {
    EmailAuthProvider: { credentialWithLink: vi.fn() },
    GoogleAuthProvider,
    getAuth: mocks.getAuth,
    isSignInWithEmailLink: vi.fn(() => false),
    linkWithCredential: vi.fn(),
    linkWithPopup: mocks.linkWithPopup,
    onAuthStateChanged: vi.fn(),
    sendSignInLinkToEmail: mocks.sendSignInLinkToEmail,
    signInAnonymously: vi.fn(),
    signInWithCredential: mocks.signInWithCredential,
    signInWithEmailAndPassword: vi.fn(),
    signInWithEmailLink: vi.fn(),
    signOut: vi.fn(),
  };
});

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    isAnonymous: false,
    email: 'user@example.com',
    uid: 'uid-1',
    ...overrides,
  } as User;
}

describe('firebase welcome verification email', () => {
  const localStorage = new Map<string, string>();

  beforeEach(() => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'api-key';
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'example.firebaseapp.com';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'project-id';
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'app-id';
    vi.stubGlobal('window', {
      localStorage: {
        clear: () => localStorage.clear(),
        getItem: (key: string) => localStorage.get(key) ?? null,
        removeItem: (key: string) => localStorage.delete(key),
        setItem: (key: string, value: string) => localStorage.set(key, value),
      },
    });
    authState.currentUser = fakeUser({ isAnonymous: true, uid: 'anon-1' });
    mocks.sendSignInLinkToEmail.mockResolvedValue(undefined);
    mocks.linkWithPopup.mockReset();
    mocks.signInWithCredential.mockReset();
    mocks.credentialFromError.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // --- linkWithGoogleResult ------------------------------------------------

  it('marks a successful popup link as an anonymous conversion', async () => {
    const linked = fakeUser({ uid: 'anon-1', isAnonymous: false });
    mocks.linkWithPopup.mockResolvedValueOnce({ user: linked });
    const { linkWithGoogleResult } = await import('./firebase');

    const result = await linkWithGoogleResult();

    expect(result).toEqual({ user: linked, convertedAnonymousUser: true });
  });

  it('does NOT mark an already-identified user linking Google as a conversion', async () => {
    // The email_verified state still exposes the Google linking button
    // (packages/user-state/src/policies.ts). When that user links Google,
    // the snapshot of isAnonymous must be the pre-link value (false), so
    // the welcome-email call site doesn't fire a duplicate verification
    // email to an identity that's already been welcomed.
    authState.currentUser = fakeUser({ uid: 'identified-1', isAnonymous: false });
    const linked = fakeUser({ uid: 'identified-1', isAnonymous: false });
    mocks.linkWithPopup.mockResolvedValueOnce({ user: linked });
    const { linkWithGoogleResult } = await import('./firebase');

    const result = await linkWithGoogleResult();

    expect(result).toEqual({ user: linked, convertedAnonymousUser: false });
  });

  it('does NOT mark existing-account recovery as a conversion', async () => {
    // Path: linkWithPopup rejects with credential-already-in-use, code
    // falls back to signInWithCredential. UID changes, the anon UID is
    // abandoned. The welcome email must NOT fire on this path — that
    // user already received a welcome on their original signup.
    const existing = fakeUser({ uid: 'returning-user', isAnonymous: false });
    mocks.linkWithPopup.mockRejectedValueOnce({ code: 'auth/credential-already-in-use' });
    mocks.credentialFromError.mockReturnValueOnce({ providerId: 'google.com' });
    mocks.signInWithCredential.mockResolvedValueOnce({ user: existing });
    const { linkWithGoogleResult } = await import('./firebase');

    const result = await linkWithGoogleResult();

    expect(result).toEqual({ user: existing, convertedAnonymousUser: false });
    expect(mocks.sendSignInLinkToEmail).not.toHaveBeenCalled();
  });

  it('linkWithGoogle (back-compat wrapper) returns just the user', async () => {
    const linked = fakeUser({ uid: 'anon-1', isAnonymous: false });
    mocks.linkWithPopup.mockResolvedValueOnce({ user: linked });
    const { linkWithGoogle } = await import('./firebase');

    await expect(linkWithGoogle()).resolves.toBe(linked);
  });

  // --- sendWelcomeVerificationEmail ----------------------------------------

  it('sends a sign-in link with the ?welcome=1 analytics flag', async () => {
    const { sendWelcomeVerificationEmail } = await import('./firebase');

    const sent = await sendWelcomeVerificationEmail(
      'tim@example.com',
      'https://app.example/chat?session=abc#today',
    );

    expect(sent).toBe(true);
    expect(mocks.sendSignInLinkToEmail).toHaveBeenCalledWith(authState, 'tim@example.com', {
      url: 'https://app.example/chat?session=abc&welcome=1#today',
      handleCodeInApp: true,
    });
  });

  it('stores the pending email so the return-side handler can link credentials', async () => {
    const { sendWelcomeVerificationEmail } = await import('./firebase');

    await sendWelcomeVerificationEmail('tim@example.com', 'https://app.example/chat');

    expect(window.localStorage.getItem('lifecoach.pendingEmail')).toBe('tim@example.com');
  });

  it('skips a repeat send for the same uid + email (dup-send guard)', async () => {
    // Re-renders / double-clicks / Settings page revisits could otherwise
    // re-fire the welcome email. The localStorage guard keeps repeat sends
    // off the wire.
    const { sendWelcomeVerificationEmail } = await import('./firebase');

    const first = await sendWelcomeVerificationEmail('tim@example.com', 'https://app.example/chat');
    const second = await sendWelcomeVerificationEmail(
      'tim@example.com',
      'https://app.example/chat',
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(mocks.sendSignInLinkToEmail).toHaveBeenCalledTimes(1);
  });

  it('still sends when a different email is used (guard keys per-email)', async () => {
    const { sendWelcomeVerificationEmail } = await import('./firebase');

    await sendWelcomeVerificationEmail('tim@example.com', 'https://app.example/chat');
    const second = await sendWelcomeVerificationEmail(
      'second@example.com',
      'https://app.example/chat',
    );

    expect(second).toBe(true);
    expect(mocks.sendSignInLinkToEmail).toHaveBeenCalledTimes(2);
  });

  it('allows a resend after the TTL has elapsed (recovery from lost/expired email)', async () => {
    // The guard is timestamp-based and expires after WELCOME_GUARD_TTL_MS.
    // Without this, a user whose first email got lost / filtered would be
    // unable to request a replacement until they signed out + back in.
    const { sendWelcomeVerificationEmail, WELCOME_GUARD_TTL_MS } = await import('./firebase');

    const realDateNow = Date.now;
    const t0 = 1_700_000_000_000;
    Date.now = () => t0;
    const first = await sendWelcomeVerificationEmail('tim@example.com', 'https://app.example/chat');
    expect(first).toBe(true);

    // Just before the TTL window closes — still blocked.
    Date.now = () => t0 + WELCOME_GUARD_TTL_MS - 1;
    expect(await sendWelcomeVerificationEmail('tim@example.com', 'https://app.example/chat')).toBe(
      false,
    );

    // After the TTL — allowed again.
    Date.now = () => t0 + WELCOME_GUARD_TTL_MS + 1;
    expect(await sendWelcomeVerificationEmail('tim@example.com', 'https://app.example/chat')).toBe(
      true,
    );

    Date.now = realDateNow;
    expect(mocks.sendSignInLinkToEmail).toHaveBeenCalledTimes(2);
  });

  it('sendEmailSignInLink (back-compat alias) shares the welcome plumbing', async () => {
    const { sendEmailSignInLink } = await import('./firebase');

    await sendEmailSignInLink('tim@example.com', 'https://app.example/chat');

    expect(mocks.sendSignInLinkToEmail).toHaveBeenCalledWith(authState, 'tim@example.com', {
      url: 'https://app.example/chat?welcome=1',
      handleCodeInApp: true,
    });
    expect(window.localStorage.getItem('lifecoach.pendingEmail')).toBe('tim@example.com');
  });
});
