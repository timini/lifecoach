"""Persistence — Firestore + GCS bucket-backed stores.

Each module exposes a small Protocol for its underlying client so tests
can swap in a fake. The server (Phase 9) wires the real
`google.cloud.firestore.AsyncClient` and `google.cloud.storage.Client`
through a shared dependency-injection container.
"""

from lifecoach_agent.storage.firestore_session import (
    FirestoreCollectionLike,
    FirestoreDocLike,
    FirestoreLike,
    FirestoreSessionService,
    create_firestore_session_service,
    save_session_summary,
)
from lifecoach_agent.storage.goal_updates import (
    GoalUpdatesStore,
    create_goal_updates_store,
    goal_updates_path,
)
from lifecoach_agent.storage.profile_history import (
    ProfileHistoryEntry,
    ProfileHistoryStore,
    create_profile_history_store,
    profile_history_path,
)
from lifecoach_agent.storage.user_meta import (
    UserMetaDoc,
    UserMetaStore,
    create_user_meta_store,
)
from lifecoach_agent.storage.user_profile import (
    BucketLike,
    UserProfileStore,
    create_user_profile_store,
    get_dotted_path,
    set_dotted_path,
    user_yaml_path,
)
from lifecoach_agent.storage.workspace_tokens import (
    ScopeRequiredError,
    StoredWorkspaceToken,
    WorkspaceTokensStore,
    create_workspace_tokens_store,
)

__all__ = [
    "BucketLike",
    "FirestoreCollectionLike",
    "FirestoreDocLike",
    "FirestoreLike",
    "FirestoreSessionService",
    "GoalUpdatesStore",
    "ProfileHistoryEntry",
    "ProfileHistoryStore",
    "ScopeRequiredError",
    "StoredWorkspaceToken",
    "UserMetaDoc",
    "UserMetaStore",
    "UserProfileStore",
    "WorkspaceTokensStore",
    "create_firestore_session_service",
    "create_goal_updates_store",
    "create_profile_history_store",
    "create_user_meta_store",
    "create_user_profile_store",
    "create_workspace_tokens_store",
    "get_dotted_path",
    "goal_updates_path",
    "profile_history_path",
    "save_session_summary",
    "set_dotted_path",
    "user_yaml_path",
]
