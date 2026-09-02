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

subset="${1:-all}"

# 子 shell 继承父 shell 变量:all 模式分叉前装一次,层内跳过;单跑某层时层内自装。
install_deps() {
  [ "${_deps_installed:-0}" = "1" ] && return 0
  pnpm install --frozen-lockfile
  _deps_installed=1
}

run_static() {
  # Shell scripts aren't part of the pnpm workspace, so run their POSIX tests
  # here or they never execute in CI.
  sh scripts/upgrade.test.sh
  sh scripts/upgrade.integration.test.sh
  sh scripts/dev-ports.test.sh
  sh scripts/agent/publish.test.sh
  node --test scripts/agent/*.test.ts
  node --test scripts/agent/*.test.mjs

  install_deps

  node --test scripts/changelog/*.test.ts
  node scripts/changelog/validate.ts
  node --test scripts/release/*.test.ts

  pnpm lint
  pnpm typecheck
  # api build 与 typecheck 同为 tsc --noEmit,增量价值只剩 vite 打包。
  pnpm --filter @insuredesk/web exec vite build
}

run_api() {
  install_deps
  . scripts/ensure-docker.sh
  pnpm --filter @insuredesk/shared --filter @insuredesk/api run test
}

run_web() {
  install_deps
  pnpm --filter @insuredesk/web run test "$@"
}

# 本地 all 三层并行;失败层日志完整打出,check.log 尾部即有效报错。
run_all() {
  install_deps
  logs_dir="$(mktemp -d)"
  run_static >"$logs_dir/static.log" 2>&1 &
  p_static=$!
  run_api >"$logs_dir/api.log" 2>&1 &
  p_api=$!
  run_web >"$logs_dir/web.log" 2>&1 &
  p_web=$!
  fail_static=0; fail_api=0; fail_web=0
  wait "$p_static" || fail_static=1
  wait "$p_api" || fail_api=1
  wait "$p_web" || fail_web=1
  failed=""
  for layer in static api web; do
    eval "failed_flag=\$fail_$layer"
    if [ "$failed_flag" = "0" ]; then
      echo "✓ $layer"
    else
      failed="$failed $layer"
    fi
  done
  for layer in $failed; do
    echo "===== ci.sh $layer failed; full log: ====="
    cat "$logs_dir/$layer.log"
  done
  rm -rf "$logs_dir"
  [ -z "$failed" ]
}

case "$subset" in
  static) run_static ;;
  api) run_api ;;
  web) shift; run_web "$@" ;;
  all) run_all ;;
  *) echo "usage: ci.sh [static|api|web] [extra vitest args for web]" >&2; exit 2 ;;
esac
