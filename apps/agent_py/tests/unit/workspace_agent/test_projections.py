"""Unit tests for the workspace projection helpers."""

from __future__ import annotations

import base64

from lifecoach_agent.workspace_agent.projections import (
    BODY_BYTE_CAP,
    project_calendar_event,
    project_calendar_list_entry,
    project_gmail_message,
    project_task,
)


def _b64url(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).rstrip(b"=").decode("ascii")


# -- gmail ----------------------------------------------------------------


def test_project_gmail_message_decodes_text_plain_body() -> None:
    raw = {
        "id": "m1",
        "threadId": "t1",
        "snippet": "Hi there",
        "payload": {
            "mimeType": "multipart/alternative",
            "headers": [
                {"name": "From", "value": "Alice <a@example.com>"},
                {"name": "Subject", "value": "Hello"},
                {"name": "Date", "value": "Mon, 12 May 2026 09:00:00 +0100"},
                {"name": "Message-ID", "value": "<abc@mail>"},
                {"name": "DKIM-Signature", "value": "dropped"},
            ],
            "parts": [
                {
                    "mimeType": "text/plain",
                    "body": {"data": _b64url("Hello, world!\nHow are you?")},
                },
                {"mimeType": "text/html", "body": {"data": _b64url("<p>Hello!</p>")}},
            ],
        },
    }
    proj = project_gmail_message(raw)
    assert proj.id == "m1"
    assert proj.threadId == "t1"
    assert proj.from_ == "Alice <a@example.com>"
    assert proj.subject == "Hello"
    assert proj.date == "Mon, 12 May 2026 09:00:00 +0100"
    assert proj.body.startswith("Hello, world!")
    assert proj.truncated is False
    assert proj.headers == {"Message-Id": "<abc@mail>"}


def test_project_gmail_message_falls_back_to_html_and_strips() -> None:
    raw = {
        "id": "m2",
        "payload": {
            "mimeType": "text/html",
            "headers": [{"name": "Subject", "value": "HTML only"}],
            "body": {"data": _b64url("<p>Hi <b>there</b></p>")},
        },
    }
    proj = project_gmail_message(raw)
    assert proj.subject == "HTML only"
    assert proj.body == "Hi there"


def test_project_gmail_message_caps_body() -> None:
    long = "x" * (BODY_BYTE_CAP + 200)
    raw = {
        "id": "m3",
        "payload": {
            "mimeType": "text/plain",
            "body": {"data": _b64url(long)},
        },
    }
    proj = project_gmail_message(raw)
    assert proj.truncated is True
    assert proj.body.endswith("…[truncated]")
    assert len(proj.body.encode("utf-8")) <= BODY_BYTE_CAP + 32  # marker bytes


def test_project_gmail_message_handles_missing_payload() -> None:
    proj = project_gmail_message({"id": "m4"})
    assert proj.id == "m4"
    assert proj.threadId == "m4"  # falls back to id
    assert proj.body == ""
    assert proj.from_ == ""


# -- calendar list --------------------------------------------------------


def test_project_calendar_list_entry_minimum_fields_and_description() -> None:
    raw = {
        "id": "family-123@group.calendar.google.com",
        "summary": "Family",
        "primary": False,
        "accessRole": "writer",
        "timeZone": "Europe/London",
        "description": "Shared calendar",
        "etag": "drop-me",
    }

    proj = project_calendar_list_entry(raw)

    assert proj.model_dump(exclude_none=True) == {
        "id": "family-123@group.calendar.google.com",
        "summary": "Family",
        "primary": False,
        "accessRole": "writer",
        "timeZone": "Europe/London",
        "description": "Shared calendar",
    }


def test_project_calendar_list_entry_defaults_missing_optional_values() -> None:
    proj = project_calendar_list_entry({"id": "cal-1"})

    assert proj.summary == "(no name)"
    assert proj.primary is False
    assert proj.accessRole == ""
    assert proj.timeZone == ""
    assert proj.description is None


# -- calendar -------------------------------------------------------------


def test_project_calendar_event_basic() -> None:
    raw = {
        "id": "ev1",
        "summary": "Lunch",
        "start": {"dateTime": "2026-05-12T12:00:00+01:00", "timeZone": "Europe/London"},
        "end": {"dateTime": "2026-05-12T13:00:00+01:00", "timeZone": "Europe/London"},
        "location": "Cafe",
        "attendees": [
            {"email": "a@example.com"},
            {"email": "b@example.com"},
            {"responseStatus": "needsAction"},  # no email — dropped
        ],
        "htmlLink": "https://cal/x",
        "etag": "drop-me",
    }
    proj = project_calendar_event(raw, calendar_id="primary")
    assert proj.id == "ev1"
    assert proj.summary == "Lunch"
    assert proj.start.dateTime == "2026-05-12T12:00:00+01:00"
    assert proj.start.timeZone == "Europe/London"
    assert proj.attendees == ["a@example.com", "b@example.com"]
    assert proj.location == "Cafe"
    assert proj.link == "https://cal/x"
    assert proj.calendarId == "primary"


def test_project_calendar_event_all_day_and_defaults() -> None:
    raw = {"id": "ev2", "start": {"date": "2026-05-12"}, "end": {"date": "2026-05-13"}}
    proj = project_calendar_event(raw)
    assert proj.summary == "(no title)"
    assert proj.start.date == "2026-05-12"
    assert proj.end.date == "2026-05-13"
    assert proj.calendarId is None


# -- tasks ----------------------------------------------------------------


def test_project_task_needs_action_default() -> None:
    raw = {"id": "t1", "title": "Send invoice", "due": "2026-05-15T00:00:00Z"}
    proj = project_task(raw, "@default")
    assert proj.status == "needsAction"
    assert proj.taskListId == "@default"
    assert proj.due == "2026-05-15T00:00:00Z"


def test_project_task_completed_status_preserved() -> None:
    raw = {"id": "t2", "title": "Pay rent", "status": "completed", "completed": "2026-05-01"}
    proj = project_task(raw, "list-x")
    assert proj.status == "completed"
    assert proj.completed == "2026-05-01"


def test_project_task_untitled_fallback() -> None:
    proj = project_task({"id": "t3"}, "@default")
    assert proj.title == "(untitled)"
