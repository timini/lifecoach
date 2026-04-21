import { policyFor } from './policies.js';
import type { FirebaseUserLike, StatePolicy, UserEvent, UserState } from './types.js';

/**
 * State → (event → next state). Missing (state, event) pairs are illegal.
 */
const TRANSITIONS: Record<UserState, Partial<Record<UserEvent, UserState>>> = {
  anonymous: {
    EMAIL_SUBMITTED: 'email_pending',
    GOOGLE_LINKED: 'google_linked',
    SIGNED_OUT: 'anonymous',
  },
  email_pending: {
    EMAIL_VERIFIED: 'email_verified',
    GOOGLE_LINKED: 'google_linked',
    SIGNED_OUT: 'anonymous',
  },
  email_verified: {
    GOOGLE_LINKED: 'google_linked',
    SIGNED_OUT: 'anonymous',
  },
  google_linked: {
    WORKSPACE_GRANTED: 'workspace_connected',
    SIGNED_OUT: 'anonymous',
  },
  workspace_connected: {
    WORKSPACE_REVOKED: 'google_linked',
    SIGNED_OUT: 'anonymous',
  },
};

export class UserStateMachine {
  private state: UserState;

  constructor(initial: UserState = 'anonymous') {
    this.state = initial;
  }

  current(): UserState {
    return this.state;
  }

  can(event: UserEvent): boolean {
    return TRANSITIONS[this.state][event] !== undefined;
  }

  send(event: UserEvent): UserState {
    const next = TRANSITIONS[this.state][event];
    if (!next) {
      throw new Error(`illegal transition: ${this.state} --${event}-->`);
    }
    this.state = next;
    return next;
  }

  policy(): StatePolicy {
    return policyFor(this.state);
  }

  /**
   * Reconstruct a machine from a Firebase user's auth claims. The
   * `workspaceScopesGranted` flag is sourced server-side (from our token
   * store), not from the Firebase user itself — pass it through when
   * constructing the input object.
   */
  static fromFirebaseUser(user: FirebaseUserLike): UserStateMachine {
    if (user.isAnonymous) return new UserStateMachine('anonymous');

    const hasGoogle = user.providerData.some((p) => p.providerId === 'google.com');
    if (hasGoogle) {
      return new UserStateMachine(
        user.workspaceScopesGranted ? 'workspace_connected' : 'google_linked',
      );
    }

    // email/password provider (or link), verified or not
    return new UserStateMachine(user.emailVerified ? 'email_verified' : 'email_pending');
  }
}
