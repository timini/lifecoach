import { describe, expect, it } from 'vitest';
import { UserStateMachine } from './UserStateMachine.js';
import type { UserEvent, UserState } from './types.js';

describe('UserStateMachine — legal transitions', () => {
  const legal: Array<{ from: UserState; event: UserEvent; to: UserState }> = [
    { from: 'anonymous', event: 'EMAIL_SUBMITTED', to: 'email_pending' },
    { from: 'email_pending', event: 'EMAIL_VERIFIED', to: 'email_verified' },
    { from: 'anonymous', event: 'GOOGLE_LINKED', to: 'google_linked' },
    { from: 'email_pending', event: 'GOOGLE_LINKED', to: 'google_linked' },
    { from: 'email_verified', event: 'GOOGLE_LINKED', to: 'google_linked' },
    { from: 'google_linked', event: 'WORKSPACE_GRANTED', to: 'workspace_connected' },
    { from: 'workspace_connected', event: 'WORKSPACE_REVOKED', to: 'google_linked' },
    { from: 'anonymous', event: 'SIGNED_OUT', to: 'anonymous' },
    { from: 'email_pending', event: 'SIGNED_OUT', to: 'anonymous' },
    { from: 'email_verified', event: 'SIGNED_OUT', to: 'anonymous' },
    { from: 'google_linked', event: 'SIGNED_OUT', to: 'anonymous' },
    { from: 'workspace_connected', event: 'SIGNED_OUT', to: 'anonymous' },
  ];

  for (const { from, event, to } of legal) {
    it(`${from} --${event}--> ${to}`, () => {
      const m = new UserStateMachine(from);
      expect(m.can(event)).toBe(true);
      expect(m.send(event)).toBe(to);
      expect(m.current()).toBe(to);
    });
  }
});

describe('UserStateMachine — illegal transitions throw', () => {
  const allStates: UserState[] = [
    'anonymous',
    'email_pending',
    'email_verified',
    'google_linked',
    'workspace_connected',
  ];
  const allEvents: UserEvent[] = [
    'EMAIL_SUBMITTED',
    'EMAIL_VERIFIED',
    'GOOGLE_LINKED',
    'WORKSPACE_GRANTED',
    'WORKSPACE_REVOKED',
    'SIGNED_OUT',
  ];

  // Legal pairs, re-expressed as a Set for quick lookup.
  const legal = new Set<string>([
    'anonymous:EMAIL_SUBMITTED',
    'email_pending:EMAIL_VERIFIED',
    'anonymous:GOOGLE_LINKED',
    'email_pending:GOOGLE_LINKED',
    'email_verified:GOOGLE_LINKED',
    'google_linked:WORKSPACE_GRANTED',
    'workspace_connected:WORKSPACE_REVOKED',
    'anonymous:SIGNED_OUT',
    'email_pending:SIGNED_OUT',
    'email_verified:SIGNED_OUT',
    'google_linked:SIGNED_OUT',
    'workspace_connected:SIGNED_OUT',
  ]);

  for (const from of allStates) {
    for (const event of allEvents) {
      if (legal.has(`${from}:${event}`)) continue;
      it(`${from} --${event}--> throws`, () => {
        const m = new UserStateMachine(from);
        expect(m.can(event)).toBe(false);
        expect(() => m.send(event)).toThrow(/illegal transition/i);
        expect(m.current()).toBe(from);
      });
    }
  }
});

describe('UserStateMachine — policy per state', () => {
  it('anonymous has only core tools and share-location affordance', () => {
    const p = new UserStateMachine('anonymous').policy();
    expect(p.tools).not.toContain('call_workspace');
    expect(p.tools).not.toContain('connect_workspace');
    expect(p.uiAffordances).toContainEqual({ kind: 'share_location_button' });
    expect(p.uiAffordances).toContainEqual({ kind: 'save_progress_suggestion' });
    expect(p.directive).toMatch(/anonymous/i);
  });

  it('workspace_connected is the only state with call_workspace', () => {
    const all = (
      [
        'anonymous',
        'email_pending',
        'email_verified',
        'google_linked',
        'workspace_connected',
      ] as const
    ).map((s) => new UserStateMachine(s).policy());

    const withCall = all.filter((p) => p.tools.includes('call_workspace')).map((p) => p.state);
    expect(withCall).toEqual(['workspace_connected']);
  });

  it('google_linked and workspace_connected both expose connect_workspace (reconnect path)', () => {
    const states = ['google_linked', 'workspace_connected'] as const;
    for (const s of states) {
      const p = new UserStateMachine(s).policy();
      expect(p.tools).toContain('connect_workspace');
    }
    const withoutConnect = (['anonymous', 'email_pending', 'email_verified'] as const).map((s) =>
      new UserStateMachine(s).policy(),
    );
    for (const p of withoutConnect) {
      expect(p.tools).not.toContain('connect_workspace');
    }
  });

  it('each state has a non-empty directive', () => {
    const states: UserState[] = [
      'anonymous',
      'email_pending',
      'email_verified',
      'google_linked',
      'workspace_connected',
    ];
    for (const s of states) {
      const p = new UserStateMachine(s).policy();
      expect(p.directive.length).toBeGreaterThan(20);
    }
  });

  it('policy snapshot — changes require deliberate update', () => {
    const snapshot = (
      [
        'anonymous',
        'email_pending',
        'email_verified',
        'google_linked',
        'workspace_connected',
      ] as const
    ).map((s) => ({
      state: s,
      tools: new UserStateMachine(s).policy().tools.slice().sort(),
      affordances: new UserStateMachine(s)
        .policy()
        .uiAffordances.map((a) => a.kind)
        .slice()
        .sort(),
    }));
    expect(snapshot).toMatchInlineSnapshot(`
      [
        {
          "affordances": [
            "save_progress_suggestion",
            "share_location_button",
          ],
          "state": "anonymous",
          "tools": [
            "ask_multiple_choice_question",
            "ask_single_choice_question",
            "auth_user",
            "google_search",
            "log_goal_update",
            "memory_save",
            "memory_search",
            "update_user_profile",
          ],
        },
        {
          "affordances": [
            "resend_verification_button",
          ],
          "state": "email_pending",
          "tools": [
            "ask_multiple_choice_question",
            "ask_single_choice_question",
            "auth_user",
            "google_search",
            "log_goal_update",
            "memory_save",
            "memory_search",
            "update_user_profile",
          ],
        },
        {
          "affordances": [
            "sign_in_with_google_button",
          ],
          "state": "email_verified",
          "tools": [
            "ask_multiple_choice_question",
            "ask_single_choice_question",
            "auth_user",
            "google_search",
            "log_goal_update",
            "memory_save",
            "memory_search",
            "update_user_profile",
          ],
        },
        {
          "affordances": [
            "connect_workspace_button",
          ],
          "state": "google_linked",
          "tools": [
            "ask_multiple_choice_question",
            "ask_single_choice_question",
            "auth_user",
            "connect_workspace",
            "google_search",
            "log_goal_update",
            "memory_save",
            "memory_search",
            "update_user_profile",
          ],
        },
        {
          "affordances": [
            "workspace_connected_indicator",
          ],
          "state": "workspace_connected",
          "tools": [
            "ask_multiple_choice_question",
            "ask_single_choice_question",
            "auth_user",
            "call_workspace",
            "connect_workspace",
            "google_search",
            "log_goal_update",
            "memory_save",
            "memory_search",
            "update_user_profile",
          ],
        },
      ]
    `);
  });
});

describe('UserStateMachine.fromFirebaseUser', () => {
  it('returns anonymous for an anonymous Firebase user', () => {
    const m = UserStateMachine.fromFirebaseUser({
      isAnonymous: true,
      emailVerified: false,
      providerData: [],
    });
    expect(m.current()).toBe('anonymous');
  });

  it('returns email_pending for a password user with unverified email', () => {
    const m = UserStateMachine.fromFirebaseUser({
      isAnonymous: false,
      emailVerified: false,
      providerData: [{ providerId: 'password' }],
    });
    expect(m.current()).toBe('email_pending');
  });

  it('returns email_verified for a password user with verified email', () => {
    const m = UserStateMachine.fromFirebaseUser({
      isAnonymous: false,
      emailVerified: true,
      providerData: [{ providerId: 'password' }],
    });
    expect(m.current()).toBe('email_verified');
  });

  it('returns google_linked for a google provider without workspace scopes', () => {
    const m = UserStateMachine.fromFirebaseUser({
      isAnonymous: false,
      emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
    });
    expect(m.current()).toBe('google_linked');
  });

  it('returns workspace_connected when workspaceScopesGranted is true', () => {
    const m = UserStateMachine.fromFirebaseUser({
      isAnonymous: false,
      emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
      workspaceScopesGranted: true,
    });
    expect(m.current()).toBe('workspace_connected');
  });
});
