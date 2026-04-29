import type { StatePolicy, ToolName, UIAffordance, UserState } from './types.js';

/**
 * Tools every state always has (writes + UI directives). State-specific
 * additions come from `STATE_ADDITIONAL_TOOLS`.
 */
export const CORE_TOOLS: readonly ToolName[] = [
  'update_user_profile',
  'log_goal_update',
  'ask_single_choice_question',
  'ask_multiple_choice_question',
  'auth_user',
  'google_search',
  'memory_search',
  'memory_save',
];

const STATE_ADDITIONAL_TOOLS: Record<UserState, readonly ToolName[]> = {
  anonymous: [],
  email_pending: [],
  email_verified: [],
  // google_linked users can invite themselves to upgrade — the LLM emits
  // `connect_workspace` (UI directive, no auth handling) to trigger the
  // browser's GIS popup.
  google_linked: ['connect_workspace'],
  // workspace_connected users can use `call_workspace` for Gmail/Calendar/
  // Tasks. `connect_workspace` stays available so reconnects work if the
  // user narrows scopes or the token gets revoked.
  workspace_connected: ['call_workspace', 'connect_workspace'],
};

const STATE_DIRECTIVE: Record<UserState, string> = {
  anonymous:
    'Nothing about this person is remembered yet. After a few real turns together, when the moment is honest, mention that signing in lets you carry the conversation across days. One soft offer at a time — never twice in a row, never as a sales pitch.',
  email_pending:
    'Verification email is in the wild, unread. If the topic naturally lands on it, a single gentle check-in is fine. Otherwise leave it — they know.',
  email_verified:
    "They're saved now. Google sign-in only gets mentioned when something specific would open up — calendar, drive, the work-side of life — not as a generic upsell.",
  google_linked:
    'Google identity is linked but Workspace is not. Suggest connecting only when the moment genuinely calls for it — they mentioned an email they want to find, a meeting to schedule, a recurring drag they want help with.',
  workspace_connected:
    'Workspace is open. When they ask something that lives in mail, calendar, or tasks, call the tool — never guess. Speak about what you actually see.',
};

const STATE_UI: Record<UserState, readonly UIAffordance[]> = {
  anonymous: [{ kind: 'share_location_button' }, { kind: 'save_progress_suggestion' }],
  email_pending: [{ kind: 'resend_verification_button' }],
  email_verified: [{ kind: 'sign_in_with_google_button' }],
  google_linked: [{ kind: 'connect_workspace_button' }],
  workspace_connected: [{ kind: 'workspace_connected_indicator' }],
};

export function policyFor(state: UserState): StatePolicy {
  return {
    state,
    tools: [...CORE_TOOLS, ...STATE_ADDITIONAL_TOOLS[state]],
    directive: STATE_DIRECTIVE[state],
    uiAffordances: STATE_UI[state],
  };
}
