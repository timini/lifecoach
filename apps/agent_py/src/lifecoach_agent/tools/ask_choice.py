"""ask_single_choice_question / ask_multiple_choice_question — UI-directive
tools that surface inline radio / checkbox widgets in chat.

The user's selection comes back as a normal chat message on the next
turn. Returning a `status` here gives the model a clear "tool succeeded;
do not produce any follow-up text this turn" signal.
"""

from __future__ import annotations

from typing import Any

from lifecoach_agent.contracts import CHOICE_TOOL_NAMES


async def ask_single_choice_question(question: str, options: list[str]) -> dict[str, Any]:
    """Ask the user a single-choice question. Renders as radio buttons
    in the chat. Prefer this over open-ended questions whenever the
    answer space is 2–8 options. After calling this tool, write NO
    additional text this turn — wait for the user to pick.

    Args:
        question: The question to show to the user (1+ chars).
        options: 2–8 short answer options, each non-empty.
    """
    _validate(question, options)
    return {"status": "shown", "kind": "single", "question": question, "options": list(options)}


async def ask_multiple_choice_question(question: str, options: list[str]) -> dict[str, Any]:
    """Ask the user a multiple-choice question (can pick multiple).
    Renders as checkboxes. Use when multiple answers make sense (e.g.,
    "which of these apply to you?"). After calling this tool, write NO
    additional text this turn — wait for the user to pick.

    Args:
        question: The question to show to the user (1+ chars).
        options: 2–8 short answer options, each non-empty.
    """
    _validate(question, options)
    return {"status": "shown", "kind": "multiple", "question": question, "options": list(options)}


def _validate(question: str, options: list[str]) -> None:
    if not isinstance(question, str) or not question.strip():
        raise ValueError("question must be a non-empty string")
    if not isinstance(options, list) or not (2 <= len(options) <= 8):
        raise ValueError("options must be a list of 2–8 items")
    for opt in options:
        if not isinstance(opt, str) or not opt:
            raise ValueError("options must all be non-empty strings")


def create_ask_single_choice_tool() -> Any:
    from google.adk.tools import FunctionTool

    # The function name must match CHOICE_TOOL_NAMES['single']; we're
    # already using that name as the def — assert at construction time
    # so a future rename trips here loudly rather than at the model.
    assert ask_single_choice_question.__name__ == CHOICE_TOOL_NAMES["single"]
    return FunctionTool(ask_single_choice_question)


def create_ask_multiple_choice_tool() -> Any:
    from google.adk.tools import FunctionTool

    assert ask_multiple_choice_question.__name__ == CHOICE_TOOL_NAMES["multiple"]
    return FunctionTool(ask_multiple_choice_question)
