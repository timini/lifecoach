/**
 * Shapes shared by the state machine and its consumers (agent + web).
 * Intentionally minimal — no Firebase SDK types leak into this package.
 */

export type UserState =
  | 'anonymous'
  | 'email_pending'
  | 'email_verified'
  | 'google_linked'
  | 'workspace_connected';

export type UserEvent =
  | 'EMAIL_SUBMITTED'
  | 'EMAIL_VERIFIED'
  | 'GOOGLE_LINKED'
  | 'WORKSPACE_GRANTED'
  | 'WORKSPACE_REVOKED'
  | 'SIGNED_OUT';

/**
 * Canonical list of agent tools. The state machine decides which subset to
 * register with the ADK agent for each state.
 */
export type ToolName =
  | 'update_user_profile'
  | 'log_goal_update'
  | 'ask_single_choice_question'
  | 'ask_multiple_choice_question'
  | 'auth_user'
  | 'google_search'
  | 'memory_search'
  | 'memory_save'
  | 'connect_workspace'
  | 'call_workspace';

/**
 * Discriminated union of UI affordances the web app may render. New kinds
 * are cheap to add — just widen the union and the renderer's switch.
 */
export type UIAffordance =
  | { kind: 'share_location_button' }
  | { kind: 'save_progress_suggestion' }
  | { kind: 'resend_verification_button' }
  | { kind: 'sign_in_with_google_button' }
  | { kind: 'connect_workspace_button' }
  | { kind: 'workspace_connected_indicator' };

export interface StatePolicy {
  state: UserState;
  tools: readonly ToolName[];
  directive: string;
  uiAffordances: readonly UIAffordance[];
}

/**
 * Minimal shape we read from a Firebase user object — a structural subset
 * so we don't take a dependency on firebase/auth in this package.
 */
export interface FirebaseUserLike {
  isAnonymous: boolean;
  emailVerified: boolean;
  providerData: ReadonlyArray<{ providerId: string }>;
  workspaceScopesGranted?: boolean;
}
