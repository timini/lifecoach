# Multi-stage build for the Lifecoach ADK agent.
# Build context must be the monorepo root (see apps/agent/.dockerignore).

# ----- deps -----
FROM node:22-slim AS deps
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY apps/agent/package.json apps/agent/tsconfig.json ./apps/agent/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/user-state/package.json ./packages/user-state/
COPY packages/config/package.json ./packages/config/
COPY packages/testing/package.json ./packages/testing/
RUN pnpm install --frozen-lockfile

# ----- build -----
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app
COPY --from=deps /app /app
COPY packages/shared-types ./packages/shared-types
COPY packages/user-state ./packages/user-state
COPY packages/config ./packages/config
COPY packages/testing ./packages/testing
COPY apps/agent ./apps/agent
RUN pnpm --filter @lifecoach/agent... build

# ----- gws (Google Workspace CLI) -----
# Pinned release of the official (experimental) Workspace CLI. Token is
# injected at runtime via GOOGLE_WORKSPACE_CLI_TOKEN env var — see
# apps/agent/src/tools/callWorkspace.ts.
FROM debian:bookworm-slim AS gws
ARG GWS_VERSION=v0.22.5
ARG GWS_ARCHIVE=google-workspace-cli-x86_64-unknown-linux-gnu.tar.gz
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
  curl -fsSL -o /tmp/gws.tar.gz \
    "https://github.com/googleworkspace/cli/releases/download/${GWS_VERSION}/${GWS_ARCHIVE}"; \
  mkdir -p /tmp/gws-extract; \
  tar -xzf /tmp/gws.tar.gz -C /tmp/gws-extract; \
  # Find the binary (name may be gws or google-workspace-cli depending on release)
  GWS_BIN="$(find /tmp/gws-extract -type f \( -name gws -o -name google-workspace-cli \) -perm -u+x | head -n1)"; \
  test -n "${GWS_BIN}"; \
  install -m 0755 "${GWS_BIN}" /usr/local/bin/gws; \
  /usr/local/bin/gws --version

# ----- runtime -----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Run as non-root
RUN useradd --system --uid 10001 --gid 0 --shell /sbin/nologin lifecoach
COPY --from=build --chown=lifecoach:0 /app /app
COPY --from=gws /usr/local/bin/gws /usr/local/bin/gws
USER 10001
ENV PORT=8080
EXPOSE 8080
CMD ["node", "apps/agent/dist/server.js"]
