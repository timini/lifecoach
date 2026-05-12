import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  currentUser: { uid: 'anon', isAnonymous: true },
}));

const firebaseAuthMocks = vi.hoisted(() => ({
  getAuth: vi.fn(() => authState),
  sendSignInLinkToEmail: vi.fn(),
  linkWithPopup: vi.fn(),
  signInWithCredential: vi.fn(),
  credentialFromError: vi.fn(),
}));

vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => [{}]),
  initializeApp: vi.fn(),
}));

vi.mock('firebase/auth', () => {
  const GoogleAuthProvider = Object.assign(vi.fn(), {
    credentialFromError: firebaseAuthMocks.credentialFromError,
  });

  return {
    EmailAuthProvider: { credentialWithLink: vi.fn() },
    GoogleAuthProvider,
    getAuth: firebaseAuthMocks.getAuth,
    isSignInWithEmailLink: vi.fn(() => false),
    linkWithCredential: vi.fn(),
    linkWithPopup: firebaseAuthMocks.linkWithPopup,
    onAuthStateChanged: vi.fn(),
    sendSignInLinkToEmail: firebaseAuthMocks.sendSignInLinkToEmail,
    signInAnonymously: vi.fn(),
    signInWithCredential: firebaseAuthMocks.signInWithCredential,
    signInWithEmailAndPassword: vi.fn(),
    signInWithEmailLink: vi.fn(),
    signOut: vi.fn(),
  };
});

describe('firebase welcome verification email', () => {
  const localStorage = new Map<string, string>();

  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: {
        clear: () => localStorage.clear(),
        getItem: (key: string) => localStorage.get(key) ?? null,
        removeItem: (key: string) => localStorage.delete(key),
        setItem: (key: string, value: string) => localStorage.set(key, value),
      },
    });
    firebaseAuthMocks.sendSignInLinkToEmail.mockResolvedValue(undefined);
    firebaseAuthMocks.linkWithPopup.mockReset();
    firebaseAuthMocks.signInWithCredential.mockReset();
    firebaseAuthMocks.credentialFromError.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sends email conversions as a welcome verification link and remembers the pending email', async () => {
    const { sendEmailSignInLink } = await import('./firebase');

    await sendEmailSignInLink('tim@example.com', 'https://app.example/chat?session=abc#today');

    expect(firebaseAuthMocks.sendSignInLinkToEmail).toHaveBeenCalledWith(
      authState,
      'tim@example.com',
      {
        url: 'https://app.example/chat?session=abc&welcome=1#today',
        handleCodeInApp: true,
      },
    );
    expect(window.localStorage.getItem('lifecoach.pendingEmail')).toBe('tim@example.com');
  });

  it('sends Google conversions a welcome verification link after linking the anonymous user', async () => {
    const linkedUser = { uid: 'anon', email: 'tim@example.com' };
    firebaseAuthMocks.linkWithPopup.mockResolvedValue({ user: linkedUser });
    const { linkWithGoogle } = await import('./firebase');

    await expect(linkWithGoogle('https://app.example/chat')).resolves.toBe(linkedUser);

    expect(firebaseAuthMocks.sendSignInLinkToEmail).toHaveBeenCalledWith(
      authState,
      'tim@example.com',
      {
        url: 'https://app.example/chat?welcome=1',
        handleCodeInApp: true,
      },
    );
    expect(window.localStorage.getItem('lifecoach.pendingEmail')).toBe('tim@example.com');
  });

  it('does not send a welcome email when Google sign-in recovers an existing account', async () => {
    const existingUser = { uid: 'existing', email: 'tim@example.com' };
    const credential = { providerId: 'google.com' };
    firebaseAuthMocks.linkWithPopup.mockRejectedValue({ code: 'auth/credential-already-in-use' });
    firebaseAuthMocks.credentialFromError.mockReturnValue(credential);
    firebaseAuthMocks.signInWithCredential.mockResolvedValue({ user: existingUser });
    const { linkWithGoogle } = await import('./firebase');

    await expect(linkWithGoogle('https://app.example/chat')).resolves.toBe(existingUser);

    expect(firebaseAuthMocks.signInWithCredential).toHaveBeenCalledWith(authState, credential);
    expect(firebaseAuthMocks.sendSignInLinkToEmail).not.toHaveBeenCalled();
  });
});
