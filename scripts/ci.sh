#!/bin/sh
# Full CI check suite. Runs on the host: the CI runner invokes it, and
# `make check` runs the same bytes locally before a push.
# Tests bring up their own Postgres via Testcontainers on the host Docker socket.
set -e

# 本地跑时自动切到 .nvmrc 钉定的 node 并备好 pnpm；CI 里 setup-node /
# pnpm/action-setup 已备好，这步空转。
. scripts/ensure-node.sh

# CHECKPOINT_DISABLE kills Prisma's update/telemetry phone-home in CI.
export CI=true CHECKPOINT_DISABLE=1

# Shell scripts aren't part of the pnpm workspace, so run their POSIX tests
# here or they never execute in CI. Cheap and dep-free — do it first.
sh scripts/upgrade.test.sh
sh scripts/dev-ports.test.sh
sh scripts/agent-loop.test.sh
sh scripts/agent/net-call.test.sh
sh scripts/agent/publish.test.sh
sh scripts/agent/run-executor.test.sh
node --test scripts/agent/*.test.mjs

pnpm install --frozen-lockfile
pnpm --filter @insuredesk/api run db:generate
pnpm lint
pnpm typecheck
pnpm build
pnpm test
