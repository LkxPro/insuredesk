# Multi-stage build for the InsureDesk API. The API runs straight
# from TypeScript source via Node's native type stripping (no compile step), so
# the runtime stage carries source + production deps rather than a JS bundle.
# It also serves the built web SPA (apps/web/dist) via @fastify/static.

# ---- Base: shared toolchain + network setup (inherited by both stages) -----
FROM node:24.19.0-alpine AS base

# Optional registry/engine mirrors. Default to official sources (so GitHub CI
# stays global); override for mainland-China / restricted networks, e.g.:
#   docker build \
#     --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#     --build-arg PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma \
#     -f apps/api/Dockerfile -t insuredesk-api .
# See docs/deployment.md → "Building behind a restricted network". Declared once
# here; both derived stages inherit the resulting ENV/files, so build-args reach
# whichever stage the build targets.
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PRISMA_ENGINES_MIRROR=https://binaries.prisma.sh

# Prisma's query engine needs openssl on Alpine (musl) at generate + runtime.
RUN apk add --no-cache openssl
# pnpm via corepack, pinned to the repo's packageManager field.
RUN corepack enable

# Skip Prisma's telemetry/version-check network call; point its engine
# downloader at the chosen mirror (this env is honored by Prisma directly).
ENV CHECKPOINT_DISABLE=1
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

# ---- Build stage: full install, Prisma client, and the web bundle ----------
FROM base AS build

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
# The web build inlines changelog yaml + screenshots via import.meta.glob;
# a missing dir makes the glob silently empty, so this COPY is load-bearing.
COPY changelog ./changelog

RUN retry pnpm --filter @insuredesk/api run db:generate

# Release tag baked into both surfaces (web bundle + api env). Declared this
# late so a tag change only re-runs the build/tail layers, never the installs.
ARG APP_VERSION=dev
RUN VITE_APP_VERSION=$APP_VERSION pnpm --filter @insuredesk/web run build

# ---- Runtime stage: production deps + source + built SPA -------------------
FROM base AS runtime

ENV NODE_ENV=production

# Production-only install for the API workspace and its deps.
# Web is excluded — its bundle arrives prebuilt.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN retry pnpm install --prod --frozen-lockfile --filter "@insuredesk/api..."

# API + shared source, and the Prisma schema (for migrations).
COPY apps/api/src ./apps/api/src
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/tsconfig.json apps/api/prisma.config.ts apps/api/docker-entrypoint.sh ./apps/api/
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/

# The Prisma client generates into the source tree (schema.prisma output =
# src/generated/prisma), which .dockerignore keeps out of the build context — so
# the COPY above can't carry it in and it must be generated here. Then bring in
# the prebuilt SPA.
RUN retry pnpm --filter @insuredesk/api run db:generate
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Server config. HOST 0.0.0.0 so it's reachable inside the container network;
# the compose file binds it to 127.0.0.1 on the host. WEB_DIST_PATH points the
# static server (src/server.ts) at the bundle.
ENV HOST=0.0.0.0
ENV PORT=3000
ENV WEB_DIST_PATH=/app/apps/web/dist
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
EXPOSE 3000

# Scripts assume cwd = apps/api (relative .env load, Prisma schema path).
WORKDIR /app/apps/api
CMD ["./docker-entrypoint.sh"]
