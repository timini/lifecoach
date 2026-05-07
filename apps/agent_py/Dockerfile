# syntax=docker/dockerfile:1.7
# Lifecoach agent (Python ADK). Multi-stage build using `uv` for fast,
# reproducible installs from uv.lock. Image base intentionally matches the
# Python version in pyproject.toml + .python-version.

FROM python:3.12-slim AS builder

# --- Install uv ---
COPY --from=ghcr.io/astral-sh/uv:0.8.2 /uv /uvx /usr/local/bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Install dependencies first (cacheable) — only invalidated when lockfile changes.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Now copy source and install the project itself.
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# --- Runtime image ---
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Copy resolved venv + source from the builder.
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src

EXPOSE 8080

# `lifecoach_agent.server:app` is added in Phase 9. Until then, this image
# starts but the /chat endpoint won't exist yet — that's fine, no preview
# deploy uses it before Phase 11.
CMD ["uvicorn", "lifecoach_agent.server:app", "--host", "0.0.0.0", "--port", "8080"]
