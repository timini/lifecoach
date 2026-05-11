"""Drift test: `state.policies` must register exactly the tools the
workspace module exports.

`state/policies.py` cannot import from `workspace_agent` at module load
(it would create `state → workspace_agent → storage → state` cycle).
Instead, the names are duplicated in `_STATE_ADDITIONAL_TOOLS` and
this test asserts the two lists stay in sync. If `WORKSPACE_TOOL_NAMES`
changes (rename, add, remove), policies.py must follow and this test
flags the drift.
"""

from __future__ import annotations

from lifecoach_agent.state.policies import _STATE_ADDITIONAL_TOOLS
from lifecoach_agent.workspace_agent import WORKSPACE_TOOL_NAMES


def test_workspace_connected_tools_match_workspace_module_export() -> None:
    """The `workspace_connected` policy tuple must equal
    `WORKSPACE_TOOL_NAMES + (connect_workspace,)` in the exact order
    the workspace factory returns them."""
    expected = tuple(WORKSPACE_TOOL_NAMES) + ("connect_workspace",)
    assert _STATE_ADDITIONAL_TOOLS["workspace_connected"] == expected, (
        "state.policies._STATE_ADDITIONAL_TOOLS['workspace_connected'] has "
        "drifted from workspace_agent.WORKSPACE_TOOL_NAMES. Update policies.py "
        "to match. (Names are duplicated rather than imported to avoid a "
        "state ↔ storage ↔ workspace_agent circular import.)"
    )
