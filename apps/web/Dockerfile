# syntax=docker/dockerfile:1
# Multi-stage build for the Lifecoach Next.js frontend.
# Build context must be the monorepo root.
#
# BuildKit is required: the `next build` step below consumes the stable
# Server Actions encryption key via `RUN --mount=type=secret,...` so the
# value never lands in image layers / metadata / provenance. Deploy scripts
# (infra/deploy.sh, infra/preview-deploy.sh) run with DOCKER_BUILDKIT=1.

# ----- deps -----
FROM node:22-slim AS deps
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/user-state/package.json ./packages/user-state/
COPY packages/config/package.json ./packages/config/
COPY packages/testing/package.json ./packages/testing/
COPY packages/ui/package.json ./packages/ui/
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
COPY packages/ui ./packages/ui
COPY apps/web ./apps/web

# NEXT_PUBLIC_* vars are inlined at build time. Passed as --build-arg from
# deploy.sh, which reads them from terraform output.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID
ARG NEXT_PUBLIC_NOTION_OAUTH_CLIENT_ID=""
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=""
ENV NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY} \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN} \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID} \
    NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID} \
    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID} \
    NEXT_PUBLIC_NOTION_OAUTH_CLIENT_ID=${NEXT_PUBLIC_NOTION_OAUTH_CLIENT_ID} \
    NEXT_PUBLIC_GA_MEASUREMENT_ID=${NEXT_PUBLIC_GA_MEASUREMENT_ID} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT}

# NEXT_SERVER_ACTIONS_ENCRYPTION_KEY must be present during `next build` so
# Server Action IDs stay stable across redeploys (otherwise clients with a
# cached pre-redeploy bundle post action IDs that the new revision doesn't
# recognise → "Failed to find Server Action" 500s). It's a base64-encoded
# 32-byte AES key, generated once by Terraform and stored in Secret Manager.
#
# Supplied as a BuildKit secret rather than an `ARG`/`--build-arg`: build
# args persist in image metadata / provenance / `docker history`, so anyone
# with image-pull access could recover the long-lived key shared across
# revisions. `--mount=type=secret` exposes the value only for the duration
# of this RUN and intentionally is not written into the final runtime
# image — Cloud Run mounts the same secret at runtime via `secret_env`.
#
# Local `docker build` without `--secret` still works (the if-guard skips
# the export); Next then generates an ephemeral key, which is fine for
# local smoke tests but unsafe for any image that gets deployed.
RUN --mount=type=secret,id=next_server_actions_encryption_key \
    if [ -f /run/secrets/next_server_actions_encryption_key ]; then \
      export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat /run/secrets/next_server_actions_encryption_key)"; \
    fi; \
    pnpm --filter @lifecoach/web... build

# ----- runtime -----
# Uses the standalone Next.js output to keep the image small.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN useradd --system --uid 10001 --gid 0 --shell /sbin/nologin lifecoach
COPY --from=build --chown=lifecoach:0 /app/apps/web/.next/standalone ./
COPY --from=build --chown=lifecoach:0 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=lifecoach:0 /app/apps/web/public ./apps/web/public
USER 10001
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
