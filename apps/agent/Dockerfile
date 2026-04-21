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

# ----- runtime -----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Run as non-root
RUN useradd --system --uid 10001 --gid 0 --shell /sbin/nologin lifecoach
COPY --from=build --chown=lifecoach:0 /app /app
USER 10001
ENV PORT=8080
EXPOSE 8080
CMD ["node", "apps/agent/dist/server.js"]
