# TS → Python port checklist

Tracks per-module status of the rebuild. Update as we go.

| TS source                                              | Python target                                       | Phase | Status |
|--------------------------------------------------------|-----------------------------------------------------|-------|--------|
| `apps/agent/src/agent.ts`                              | `lifecoach_agent/agent.py`                          | 0/9   | bootstrapped (hello-world) |
| `packages/shared-types/src/*`                          | `lifecoach_agent/contracts/models.py`               | 1     | done |
| `apps/agent/src/server.ts`                             | `lifecoach_agent/server.py`                         | 9     | — |
| `apps/agent/src/auth.ts`                               | `lifecoach_agent/auth.py`                           | 5     | — |
| `apps/agent/src/sentry.ts`                             | `lifecoach_agent/sentry_setup.py`                   | 0     | — |
| `apps/agent/src/chat/emptyTurnGuard.ts`                | `lifecoach_agent/chat/empty_turn_guard.py`          | 8     | done |
| `apps/agent/src/prompt/buildInstruction.ts`            | `lifecoach_agent/prompt/build_instruction.py`       | 3     | done |
| `apps/agent/src/practices/dayPlanning.ts`              | `lifecoach_agent/practices/day_planning.py`         | 3     | done |
| `apps/agent/src/practices/eveningGratitude.ts`         | `lifecoach_agent/practices/evening_gratitude.py`    | 3     | done (directive); tools wired Phase 6 |
| `apps/agent/src/practices/journaling.ts`               | `lifecoach_agent/practices/journaling.py`           | 3     | done (directive); tools wired Phase 6 |
| `apps/agent/src/practices/dayClock.ts`                 | `lifecoach_agent/practices/day_clock.py`            | 3     | done |
| `apps/agent/src/practices/index.ts`                    | `lifecoach_agent/practices/__init__.py`             | 3     | done |
| `apps/agent/src/practices/types.ts`                    | `lifecoach_agent/practices/types.py`                | 3     | done |
| `packages/user-state/src/UserStateMachine.ts`          | `lifecoach_agent/state/user_state.py`               | 2     | done |
| `packages/user-state/src/UsageStateMachine.ts`         | `lifecoach_agent/state/usage_state.py`              | 2     | done |
| `packages/user-state/src/DailyFlowMachine.ts`          | `lifecoach_agent/state/daily_flow.py`               | 2     | done |
| `packages/user-state/src/policies.ts`                  | `lifecoach_agent/state/policies.py`                 | 2     | done |
| `packages/user-state/src/types.ts`                     | `lifecoach_agent/state/types.py`                    | 2     | done |
| `apps/agent/src/context/weather.ts`                    | `lifecoach_agent/context/weather.py`                | 4     | done |
| `apps/agent/src/context/places.ts`                     | `lifecoach_agent/context/places.py`                 | 4     | done (token-arg; ADC integration deferred to Phase 5) |
| `apps/agent/src/context/airQuality.ts`                 | `lifecoach_agent/context/air_quality.py`            | 4     | done |
| `apps/agent/src/context/holidays.ts`                   | `lifecoach_agent/context/holidays.py`               | 4     | done |
| `apps/agent/src/context/calendarDensity.ts`            | `lifecoach_agent/context/calendar_density.py`       | 4     | done (events fetcher Protocol; google-api-python-client impl in Phase 7) |
| `apps/agent/src/context/sessionSummary.ts`             | `lifecoach_agent/context/session_summary.py`        | 4     | done |
| `apps/agent/src/context/sessionSummarizer.ts`          | `lifecoach_agent/context/session_summarizer.py`     | 4     | done (google-genai instead of @google/genai) |
| `apps/agent/src/context/memory.ts` (mem0)              | `lifecoach_agent/context/memory.py` (Memory Bank)   | 4     | done (clean break from mem0; VertexAiMemoryBankService wrapper + noop fallback) |
| `apps/agent/src/storage/firestoreSession.ts`           | `lifecoach_agent/storage/firestore_session.py`      | 5     | done (data plane; ADK Runner wiring at Phase 9) |
| `apps/agent/src/storage/userProfile.ts`                | `lifecoach_agent/storage/user_profile.py`           | 5     | done |
| `apps/agent/src/storage/profileHistory.ts`             | `lifecoach_agent/storage/profile_history.py`        | 5     | done |
| `apps/agent/src/storage/goalUpdates.ts`                | `lifecoach_agent/storage/goal_updates.py`           | 5     | done |
| `apps/agent/src/storage/userMeta.ts`                   | `lifecoach_agent/storage/user_meta.py`              | 5     | done |
| `apps/agent/src/storage/workspaceTokens.ts`            | `lifecoach_agent/storage/workspace_tokens.py`       | 5     | done |
| `apps/agent/src/oauth/workspaceClient.ts`              | `lifecoach_agent/oauth/workspace_client.py`         | 5     | done |
| `apps/agent/src/auth.ts`                               | `lifecoach_agent/auth.py`                           | 5     | done |
| `apps/agent/src/tools/authUser.ts`                     | `lifecoach_agent/tools/auth_user.py`                | 6     | done |
| `apps/agent/src/tools/connectWorkspace.ts`             | `lifecoach_agent/tools/connect_workspace.py`        | 6     | done |
| `apps/agent/src/tools/updateUserProfile.ts`            | `lifecoach_agent/tools/update_user_profile.py`      | 6     | done |
| `apps/agent/src/tools/logGoalUpdate.ts`                | `lifecoach_agent/tools/log_goal_update.py`          | 6     | done |
| `apps/agent/src/tools/askChoice.ts`                    | `lifecoach_agent/tools/ask_choice.py`               | 6     | done |
| `apps/agent/src/tools/memorySave.ts`                   | `lifecoach_agent/tools/memory_save.py`              | 6     | done |
| `apps/agent/src/tools/upgradeToPro.ts`                 | `lifecoach_agent/tools/upgrade_to_pro.py`           | 6     | done |
| `apps/agent/src/tools/callWorkspace.ts` (gws CLI)      | `lifecoach_agent/workspace_agent/gws_client.py`     | 7     | done (google-api-python-client; gws CLI dropped entirely) |
| —                                                      | `lifecoach_agent/workspace_agent/call_workspace.py` | 7     | done (ADK FunctionTool wrapper) |
| The full sub-agent redesign (separate ADK Agent + 9 internal tools + 2 AgentTool wrappers) lands as a follow-up issue — see plan §"Phase 7 — Workspace sub-agent". | | 7+ | follow-up |

Status legend: `—` (todo), `wip` (in progress on a branch), `done` (merged
to main / migration branch).
