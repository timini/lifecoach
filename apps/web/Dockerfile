# Multi-stage build for the Lifecoach Next.js frontend.
# Build context must be the monorepo root.

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
COPY apps/web ./apps/web

# NEXT_PUBLIC_* vars are inlined at build time. Passed as --build-arg from
# deploy.sh, which reads them from terraform output.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY} \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN} \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID} \
    NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}

RUN pnpm --filter @lifecoach/web build

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
