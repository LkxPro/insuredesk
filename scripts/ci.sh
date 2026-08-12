#!/bin/sh
# Full CI check suite. Runs on the host: the CI runner invokes it, and
# `make check` runs the same bytes locally before a push.
# Tests bring up their own Postgres via Testcontainers on the host Docker socket.
#
# pnpm is expected on PATH already (CI: pnpm/action-setup; local: corepack
# enable). Enabling corepack here too would double-provision pnpm and can
# collide with the runner's copy.
set -e

# CHECKPOINT_DISABLE kills Prisma's update/telemetry phone-home in CI.
export CI=true CHECKPOINT_DISABLE=1

# Shell scripts aren't part of the pnpm workspace, so run their POSIX tests
# here or they never execute in CI. Cheap and dep-free — do it first.
sh scripts/upgrade.test.sh

pnpm install --frozen-lockfile
pnpm --filter @insuredesk/api run db:generate
pnpm lint
pnpm typecheck
pnpm build
pnpm test
