"""Shared dependencies for the workspace tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lifecoach_agent.storage.workspace_tokens import WorkspaceTokensStore
from lifecoach_agent.workspace_agent.run_gws import LogEmitter


@dataclass(frozen=True)
class WorkspaceToolDeps:
    store: WorkspaceTokensStore
    uid: str
    build_client: Any | None = None
    log: LogEmitter | None = None
