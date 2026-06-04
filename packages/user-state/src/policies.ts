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
  'google_search',
  'memory_search',
  'memory_save',
];

// `auth_user({mode:"google"})` triggers the Google sign-in flow. Only
// meaningful for the three pre-Google-sign-in states; firing it for a
// user who's already on `google_linked` / `workspace_connected` would
// just show the account picker again. The WORKSPACE-ASK TRIGGER (issue
// #62) routes these states to `auth_user` as the FIRST turn on
// workspace asks — listing it here is what makes the directive runnable.
const PRE_GOOGLE_AUTH_TOOLS: readonly ToolName[] = ['auth_user'];

const STATE_ADDITIONAL_TOOLS: Record<UserState, readonly ToolName[]> = {
  anonymous: [...PRE_GOOGLE_AUTH_TOOLS],
  email_pending: [...PRE_GOOGLE_AUTH_TOOLS],
  email_verified: [...PRE_GOOGLE_AUTH_TOOLS],
  // google_linked users can invite themselves to upgrade — the LLM emits
  // `connect_workspace` (UI directive, no auth handling) to trigger the
  // browser's GIS popup.
  google_linked: ['connect_workspace'],
  // workspace_connected users get the full Google Workspace surface:
  // 2 AgentTools wrapping the workspace sub-agent (read flows) + 7
  // narrow write FunctionTools. `connect_workspace` stays available so
  // reconnects work if the user narrows scopes or the token gets revoked.
  workspace_connected: [
    'triage_inbox',
    'find_workspace',
    'archive_messages',
    'add_calendar_event',
    'edit_calendar_event',
    'delete_calendar_event',
    'add_task',
    'complete_task',
    'draft_email',
    'connect_workspace',
  ],
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
