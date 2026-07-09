# Multi-stage build for the InsureDesk API (ADR 0007). The API runs straight
# from TypeScript source via tsx (no compile step), so the runtime stage carries
# source + production deps rather than a JS bundle. It also serves the built web
# SPA (apps/web/dist) via @fastify/static.

# ---- Build stage: full install, Prisma client, and the web bundle ----------
FROM node:22-alpine AS build

# Optional registry/engine mirrors. Default to official sources (so GitHub CI
# stays global); override for mainland-China / restricted networks, e.g.:
#   docker build \
#     --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#     --build-arg PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma \
#     -f apps/api/Dockerfile -t insuredesk-api .
# See docs/deployment.md → "Building behind a restricted network".
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PRISMA_ENGINES_MIRROR=https://binaries.prisma.sh

# Prisma's query engine needs openssl on Alpine (musl) at generate + runtime.
RUN apk add --no-cache openssl
# pnpm via corepack, pinned to the repo's packageManager field.
RUN corepack enable

# Skip Prisma's telemetry/version-check network call during install/generate.
ENV CHECKPOINT_DISABLE=1
# Point Prisma's engine downloader at the chosen mirror (env is honored here).
ENV PRISMA_ENGINES_MIRROR=$PRISMA_ENGINES_MIRROR
# Retry wrapper: the Prisma engine CDN and npm registry drop connections under
# load; retry network-heavy steps rather than fail the build on one dropped
# packet. Usage: `retry <cmd> <args...>`.
RUN printf '#!/bin/sh\nn=0\nuntil "$@"; do\n  n=$((n+1))\n  [ "$n" -ge 8 ] && echo "failed after $n attempts: $*" && exit 1\n  echo "retry $n: $*"\n  sleep 5\ndone\n' > /usr/local/bin/retry \
    && chmod +x /usr/local/bin/retry

WORKDIR /app

# Point pnpm at the chosen npm registry via a project .npmrc — reliably honored
# (unlike npm_config_registry env or `npm config set`, which write to a path
# pnpm-under-corepack doesn't read). Lockfile v9 pins integrity only, so tarball
# URLs are rebuilt from this registry.
RUN echo "registry=$NPM_REGISTRY" > /app/.npmrc

# Manifests + lockfile first so the install layer caches across source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN retry pnpm install --frozen-lockfile

# Sources (node_modules, dist, .env, tests excluded via .dockerignore).
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

# Generate the Prisma client (validates the schema early) and build the SPA.
RUN retry pnpm --filter @insuredesk/api run db:generate
RUN pnpm --filter @insuredesk/web run build

# ---- Runtime stage: production deps + source + built SPA -------------------
FROM node:22-alpine AS runtime

# Same mirror knobs as the build stage (this stage runs its own prod install
# and prisma generate). Default to official sources.
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PRISMA_ENGINES_MIRROR=https://binaries.prisma.sh

RUN apk add --no-cache openssl
RUN corepack enable

ENV NODE_ENV=production
ENV CHECKPOINT_DISABLE=1
ENV PRISMA_ENGINES_MIRROR=$PRISMA_ENGINES_MIRROR
RUN printf '#!/bin/sh\nn=0\nuntil "$@"; do\n  n=$((n+1))\n  [ "$n" -ge 8 ] && echo "failed after $n attempts: $*" && exit 1\n  echo "retry $n: $*"\n  sleep 5\ndone\n' > /usr/local/bin/retry \
    && chmod +x /usr/local/bin/retry

WORKDIR /app

# Point pnpm at the chosen npm registry via a project .npmrc (see build stage).
RUN echo "registry=$NPM_REGISTRY" > /app/.npmrc

# Production-only install for the API workspace and its deps (pulls in shared,
# tsx, prisma, @prisma/client). Web is excluded — its bundle arrives prebuilt.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN retry pnpm install --prod --frozen-lockfile --filter "@insuredesk/api..."

# API + shared source (executed by tsx) and the Prisma schema (for migrations).
COPY apps/api/src ./apps/api/src
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/tsconfig.json ./apps/api/
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/

# Regenerate the client into this stage's node_modules (pnpm's hashed virtual
# store isn't portable across stages), then bring in the prebuilt SPA.
RUN retry pnpm --filter @insuredesk/api run db:generate
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Server config. HOST 0.0.0.0 so it's reachable inside the container network;
# the compose file binds it to 127.0.0.1 on the host. WEB_DIST_PATH points the
# static server (src/server.ts) at the bundle.
ENV HOST=0.0.0.0
ENV PORT=3000
ENV WEB_DIST_PATH=/app/apps/web/dist
EXPOSE 3000

# Scripts assume cwd = apps/api (relative .env load, Prisma schema path).
WORKDIR /app/apps/api
CMD ["pnpm", "start"]
