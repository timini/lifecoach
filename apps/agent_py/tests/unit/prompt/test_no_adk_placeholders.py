"""Guard: the built prompt must not contain literal {name} patterns.

ADK Python's LlmAgent treats any {name} in `instruction` as a template
placeholder that gets resolved from session state at runtime. If the
prompt contains a literal {name} that's NOT in state, the entire turn
fails with: "Context variable not found: 'name'." — and (until we log
it) appears as a silent turn to the user.

This test caught one such regression in 2026-05-11: daily_flow.py:54
had `daily.{today}.lunch_eaten` in the lunch-state directive. The user
hit it the moment the local clock crossed into the lunch window, and
every subsequent turn returned silence.

Forbidden pattern: {word} (single-braced ident). {{word}} is fine —
that's the ADK escape; it renders as literal {word} in the model view.
"""

from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from lifecoach_agent.prompt.build_instruction import InstructionContext, build_instruction
from lifecoach_agent.state.daily_flow import policy_for_daily_flow

# ADK's *exact* placeholder regex (from
# `google/adk/utils/instructions_utils.py`). It matches one-or-more
# opening braces, any non-brace content, and one-or-more closing braces.
# Then it strips ALL braces and looks up the inner text — so `{{x}}` is
# NOT an escape (still resolves to `x`). The only safe rendering is to
# (a) make the inner text fail `isidentifier()` (e.g. contain a hyphen,
# space, or `<>` chars) or (b) use no braces at all.
_ADK_PLACEHOLDER_RE = re.compile(r"\{+[^{}]*\}+")


def _adk_would_fail(match_text: str) -> str | None:
    """Return the identifier ADK would try to resolve from a brace match,
    or None if the match is left alone (invalid identifier)."""
    var = match_text.lstrip("{").rstrip("}").strip().removesuffix("?")
    if not var:
        return None
    if var.isidentifier():
        return var
    # ADK also accepts `prefix:identifier` for `app:`, `user:`, `temp:`.
    if ":" in var:
        prefix, _, rest = var.partition(":")
        if prefix in {"app", "user", "temp"} and rest.isidentifier():
            return var
    return None


def _base_ctx(now: datetime, *, user_state: str = "workspace_connected") -> InstructionContext:
    return InstructionContext(
        now=now,
        timezone="Europe/London",
        user_state=user_state,  # type: ignore[arg-type]
        user_profile={"practices": {"day_planning": {"enabled": True}}},
    )


@pytest.mark.parametrize(
    "hour_utc",
    # One sample per DailyFlowMachine state — guard every directive.
    # 23:00 morning_greeting (no interaction); 05/09/12/14/18/22 cover lunch/post_lunch/evening/concluding.
    [5, 9, 12, 14, 18, 22],
)
def test_built_instruction_has_no_adk_placeholders(hour_utc: int) -> None:
    """For every hour-of-day → daily-flow state, the rendered prompt
    must not contain a `{name}` literal that ADK would try to resolve."""
    now = datetime(2026, 5, 11, hour_utc, 0, tzinfo=ZoneInfo("UTC"))
    out = build_instruction(_base_ctx(now))
    leaks = []
    for m in _ADK_PLACEHOLDER_RE.finditer(out):
        var = _adk_would_fail(m.group())
        if var is not None:
            leaks.append((m.group(), var))
    assert not leaks, (
        "Built prompt contains literal {name} placeholders that ADK will try to "
        "resolve from session state and FAIL on, causing silent turns. Found:\n"
        + "\n".join(f"  {full!r} -> tries to resolve {var!r}" for full, var in leaks)
        + "\nFix: write the surrounding text without single-braced identifiers — "
        "e.g. `<YYYY-MM-DD>` or `(query)`. Double braces `{{x}}` do NOT escape; "
        "ADK strips them and still resolves `x`."
    )


def test_daily_flow_lunch_directive_does_not_leak_today() -> None:
    """Regression test for the 2026-05-11 incident specifically."""
    policy = policy_for_daily_flow("lunch")
    leaks = []
    for m in _ADK_PLACEHOLDER_RE.finditer(policy.directive):
        var = _adk_would_fail(m.group())
        if var is not None:
            leaks.append((m.group(), var))
    assert not leaks, (
        f"daily_flow.lunch directive has bare ADK placeholders: {leaks}. "
        "Anything the user-facing text wants to render literally as {x} must "
        "either use no braces or break `isidentifier()`."
    )
