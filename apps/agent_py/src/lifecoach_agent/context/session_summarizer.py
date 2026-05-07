"""Production summarizer for `session_summary.py`. Wraps a single
google-genai call against gemini-flash-lite-latest — the cheap, fast
model issue #10 specifies for one-paragraph daily-summary work.

Kept in its own file so the data-layer (`session_summary.py`) stays
LLM-agnostic and unit-testable with a stub. The server in Phase 9 plugs
this factory into `SessionSummaryClient`.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

MODEL = "gemini-flash-lite-latest"

SYSTEM_PROMPT = """You write one-paragraph summaries of a single day's coaching chat between a User and Coach. The summary will be injected into tomorrow's system prompt so the Coach has continuity without re-reading the transcript.

Rules:
- One paragraph, ~80 words. No headings, no bullets.
- Capture: what they talked about, what the user committed to or felt, anything left unresolved.
- Past tense, third person ("the user", "they"). No "I" or "we".
- No quoting verbatim. Compress.
- No greetings, sign-offs, or meta-commentary about being an AI.

Output ONLY the summary paragraph."""


Summarizer = Callable[[str], Awaitable[str | None]]


def create_gemini_flash_lite_summarizer(
    *, client: Any | None = None, model: str | None = None
) -> Summarizer:
    """Build a `Summarizer` backed by google-genai. Pass a stub `client`
    in tests; production wiring leaves it None and lets google-genai
    pick up Vertex credentials from the environment."""
    from google import genai

    real_client = client or genai.Client()
    chosen_model = model or MODEL

    async def summarize(transcript: str) -> str | None:
        if not transcript.strip():
            return None
        try:
            response = await real_client.aio.models.generate_content(
                model=chosen_model,
                contents=[
                    {
                        "role": "user",
                        "parts": [
                            {"text": SYSTEM_PROMPT},
                            {"text": "\n\nTRANSCRIPT:\n"},
                            {"text": transcript},
                        ],
                    }
                ],
                config={"temperature": 0.3, "max_output_tokens": 256},
            )
        except Exception:  # noqa: BLE001
            return None
        # Drill into candidates -> content -> parts -> text in a tolerant way.
        text = ""
        candidates = getattr(response, "candidates", None) or []
        if candidates:
            content = getattr(candidates[0], "content", None)
            parts = getattr(content, "parts", None) or [] if content else []
            text = "".join(
                p.text for p in parts if isinstance(getattr(p, "text", None), str)
            ).strip()
        return text if text else None

    return summarize
