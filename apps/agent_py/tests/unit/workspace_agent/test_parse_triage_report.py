"""Unit tests for `parse_triage_report`.

This is the only bridge between the sub-agent's free-text response and
the structured `TriageReport` the main coach acts on. It has four code
paths (no marker / malformed JSON / schema-invalid JSON / happy path)
and all of them need explicit coverage — the eval fixture only asserts
the marker is *present*, not that the parser correctly extracts the
report.
"""

from __future__ import annotations

from lifecoach_agent.workspace_agent.agent_tools.triage_inbox import (
    parse_triage_report,
)

_VALID_REPORT_JSON = (
    "{"
    '"noise":[{"id":"m1","from":"news@x","subject":"Digest","context":"received 2h ago; newsletter digest"}],'
    '"actions":[{"id":"m2","from":"a@x","subject":"Sign-off","context":"received today; renewal is ready","task":"sign contract by Friday"}],'
    '"events":[{"id":"m3","from":"Sarah <s@example.com>","subject":"Lunch","context":"received yesterday; lunch Tue 12:30 at Tortilla","proposedStart":"2026-05-12T12:30:00+01:00"}],'
    '"info":[{"id":"m4","from":"school@x","subject":"Photo day","context":"received yesterday; Year 3 photo day Friday","note":"Friday, uniform"}]'
    "}"
)


def test_no_marker_returns_parse_error_with_raw_text() -> None:
    text = "Sure, here's what I found in your inbox..."
    out = parse_triage_report(text)
    assert out.status == "parse_error"
    assert out.report is None
    assert out.raw == text


def test_malformed_json_inside_markers_returns_parse_error() -> None:
    text = "<TRIAGE_REPORT>{not valid json}</TRIAGE_REPORT>"
    out = parse_triage_report(text)
    assert out.status == "parse_error"
    assert out.report is None
    assert out.raw == text


def test_schema_invalid_json_returns_parse_error() -> None:
    # Valid JSON, but `actions` entry is missing the required `task` field.
    bad = (
        '<TRIAGE_REPORT>{"noise":[],"actions":[{"id":"m2","from":"a@x",'
        '"subject":"x","context":"received today"}],"events":[],"info":[]}</TRIAGE_REPORT>'
    )
    out = parse_triage_report(bad)
    assert out.status == "parse_error"
    assert out.report is None


def test_missing_context_returns_parse_error() -> None:
    bad = (
        '<TRIAGE_REPORT>{"noise":[{"id":"m1","from":"n@x","subject":"Digest"}],'
        '"actions":[],"events":[],"info":[]}</TRIAGE_REPORT>'
    )
    out = parse_triage_report(bad)
    assert out.status == "parse_error"
    assert out.report is None


def test_happy_path_returns_validated_report() -> None:
    out = parse_triage_report(f"<TRIAGE_REPORT>{_VALID_REPORT_JSON}</TRIAGE_REPORT>")
    assert out.status == "ok"
    assert out.report is not None
    assert len(out.report.noise) == 1
    assert out.report.noise[0].id == "m1"
    assert len(out.report.actions) == 1
    assert out.report.actions[0].task == "sign contract by Friday"
    assert out.report.events[0].proposedStart == "2026-05-12T12:30:00+01:00"
    assert out.report.events[0].from_ == "Sarah <s@example.com>"
    assert "Tue 12:30" in out.report.events[0].context
    assert out.report.info[0].note == "Friday, uniform"


def test_first_marker_wins_when_multiple_present() -> None:
    # The regex uses re.search → only the first match. Locks that in:
    # if the sub-agent ever emits two reports the parent uses the first.
    decoy = '<TRIAGE_REPORT>{"noise":[],"actions":[],"events":[],"info":[]}</TRIAGE_REPORT>'
    real = f"<TRIAGE_REPORT>{_VALID_REPORT_JSON}</TRIAGE_REPORT>"
    out = parse_triage_report(f"{decoy}\n\nthen later: {real}")
    assert out.status == "ok"
    assert out.report is not None
    # The first marker is the empty decoy.
    assert out.report.noise == []
    assert out.report.actions == []


def test_marker_with_surrounding_text_still_parses() -> None:
    text = (
        f"Here's the triage:\n<TRIAGE_REPORT>{_VALID_REPORT_JSON}</TRIAGE_REPORT>\nHope that helps."
    )
    out = parse_triage_report(text)
    assert out.status == "ok"
    assert out.report is not None
    assert out.raw == text  # raw includes the surrounding prose


def test_marker_with_inner_whitespace_is_stripped() -> None:
    text = f"<TRIAGE_REPORT>\n  {_VALID_REPORT_JSON}  \n</TRIAGE_REPORT>"
    out = parse_triage_report(text)
    assert out.status == "ok"
    assert out.report is not None
