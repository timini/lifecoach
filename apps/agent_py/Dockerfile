# syntax=docker/dockerfile:1.7
# Lifecoach agent (Python ADK). Multi-stage build using `uv` for fast,
# reproducible installs from uv.lock. Image base intentionally matches the
# Python version in pyproject.toml + .python-version.
#
# Build context: MONOREPO ROOT (matches `apps/web/Dockerfile` + the
# `infra/deploy.sh` / `infra/preview-deploy.sh` convention). Run as:
#   docker build -f apps/agent_py/Dockerfile -t lifecoach-agent .

FROM python:3.12-slim AS builder

# --- Install uv ---
COPY --from=ghcr.io/astral-sh/uv:0.8.2 /uv /uvx /usr/local/bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Install dependencies first (cacheable) — only invalidated when lockfile
# changes. README.md is copied in this layer too because hatchling reads it
# at editable-install time even with `--no-install-project` (the project
# metadata is validated regardless).
COPY apps/agent_py/pyproject.toml apps/agent_py/uv.lock apps/agent_py/README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Now copy source and install the project itself.
COPY apps/agent_py/src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# --- Runtime image ---
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Non-root runtime user — drop the default root for defense in depth.
# UID 1001 matches the convention `apps/web/Dockerfile` already uses.
RUN useradd --uid 1001 --no-create-home --shell /usr/sbin/nologin lifecoach

# Copy resolved venv + source from the builder.
COPY --from=builder --chown=lifecoach:0 /app/.venv /app/.venv
COPY --from=builder --chown=lifecoach:0 /app/src /app/src

USER lifecoach

EXPOSE 8080

# Cloud Run respects $PORT; uvicorn picks up via shell expansion. Single
# worker — Cloud Run scales horizontally, not via multi-worker uvicorn.
CMD ["sh", "-c", "uvicorn lifecoach_agent.server:app --host 0.0.0.0 --port ${PORT:-8080}"]
