#!/bin/sh
# Full CI check suite, run inside a one-shot container on the dev compose
# service — same image, same Node/pnpm versions as local development
# (invocation lives in .github/workflows/ci.yml).
# --no-deps skips the dev db: tests bring up their own Postgres via
# Testcontainers on the mounted Docker socket.
set -e

# CHECKPOINT_DISABLE kills Prisma's update/telemetry phone-home in CI.
export CI=true CHECKPOINT_DISABLE=1

# Shell scripts aren't part of the pnpm workspace, so run their POSIX tests
# here or they never execute in CI. Cheap and dep-free — do it first.
sh scripts/upgrade.test.sh

# One-shot containers lose corepack's shims and pnpm's config; point the store
# at the bind-mounted path so the CI cache can persist it across runs.
corepack enable
pnpm config set store-dir /app/.pnpm-store

pnpm install --frozen-lockfile
pnpm --filter @insuredesk/api run db:generate
pnpm lint
pnpm typecheck
pnpm build
pnpm test
