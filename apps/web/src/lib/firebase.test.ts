import type { User } from 'firebase/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ currentUser: null as User | null }));
const linkWithPopupMock = vi.hoisted(() => vi.fn());
const signInWithCredentialMock = vi.hoisted(() => vi.fn());
const sendSignInLinkToEmailMock = vi.hoisted(() => vi.fn());
const credentialFromErrorMock = vi.hoisted(() => vi.fn());

vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ name: 'test-app' })),
}));

vi.mock('firebase/auth', () => {
  const GoogleAuthProviderMock = Object.assign(vi.fn(), {
    credentialFromError: credentialFromErrorMock,
  });

  return {
    EmailAuthProvider: { credentialWithLink: vi.fn() },
    GoogleAuthProvider: GoogleAuthProviderMock,
    getAuth: vi.fn(() => authState),
    isSignInWithEmailLink: vi.fn(() => false),
    linkWithCredential: vi.fn(),
    linkWithPopup: linkWithPopupMock,
    onAuthStateChanged: vi.fn(),
    sendSignInLinkToEmail: sendSignInLinkToEmailMock,
    signInAnonymously: vi.fn(),
    signInWithCredential: signInWithCredentialMock,
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

describe('Firebase auth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'api-key';
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'example.firebaseapp.com';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'project-id';
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'app-id';
    authState.currentUser = fakeUser({ isAnonymous: true });
    vi.stubGlobal('window', {
      localStorage: { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() },
    });
  });

  it('marks successful Google popup links as anonymous conversions', async () => {
    const linkedUser = fakeUser({ isAnonymous: false, uid: 'anon-upgraded' });
    linkWithPopupMock.mockResolvedValueOnce({ user: linkedUser });

    const { linkWithGoogleResult } = await import('./firebase');
    const result = await linkWithGoogleResult();

    expect(result).toEqual({ user: linkedUser, convertedAnonymousUser: true });
  });

  it('does not mark existing Google-account sign-ins as anonymous conversions', async () => {
    const existingUser = fakeUser({ isAnonymous: false, uid: 'existing' });
    const err = { code: 'auth/credential-already-in-use' };
    linkWithPopupMock.mockRejectedValueOnce(err);
    credentialFromErrorMock.mockReturnValueOnce({ providerId: 'google.com' });
    signInWithCredentialMock.mockResolvedValueOnce({ user: existingUser });

    const { linkWithGoogleResult } = await import('./firebase');
    const result = await linkWithGoogleResult();

    expect(result).toEqual({ user: existingUser, convertedAnonymousUser: false });
  });

  it('sends a welcome verification link and stores the pending email', async () => {
    const { sendWelcomeVerificationEmail } = await import('./firebase');

    await sendWelcomeVerificationEmail('new@example.com', 'https://app.test/chat');

    expect(sendSignInLinkToEmailMock).toHaveBeenCalledWith(authState, 'new@example.com', {
      url: 'https://app.test/chat',
      handleCodeInApp: true,
    });
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      'lifecoach.pendingEmail',
      'new@example.com',
    );
  });
});
