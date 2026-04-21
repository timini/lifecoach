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
  google_linked: [],
  workspace_connected: ['run_gws'],
};

const STATE_DIRECTIVE: Record<UserState, string> = {
  anonymous:
    'User is anonymous (no email, no Google sign-in). After ~6 meaningful exchanges, naturally suggest saving progress by sharing email or signing in with Google — but do not push early and never nag. Their data is not persisted across sessions yet.',
  email_pending:
    'User submitted their email but has not clicked the verification link. Mention verification once, gently, if natural. Do not repeat the reminder.',
  email_verified:
    'User is identified by a verified email. Their progress is saved. Offer Google sign-in only when it unlocks something specific the user wants (e.g., calendar, drive).',
  google_linked:
    'User is signed in with Google but has not granted Workspace access. Offer Workspace connection only when the conversation would genuinely benefit (calendar context, checking email, finding a file).',
  workspace_connected:
    'User granted Google Workspace access. You may call run_gws when the user asks something that requires it. Never speculate about their workspace contents — call the tool.',
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
