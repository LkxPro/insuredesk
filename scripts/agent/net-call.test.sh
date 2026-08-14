#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

cat >"$tmp/flaky" <<'EOF'
#!/bin/sh
n=$(cat "$CALLS" 2>/dev/null || echo 0)
n=$((n + 1))
printf '%s\n' "$n" >"$CALLS"
if [ "$n" -lt 3 ]; then
  echo 'fatal: unable to connect to remote: connection reset by peer' >&2
  exit 128
fi
printf 'eventual-ok\n'
EOF

cat >"$tmp/permanent" <<'EOF'
#!/bin/sh
n=$(cat "$CALLS" 2>/dev/null || echo 0)
n=$((n + 1))
printf '%s\n' "$n" >"$CALLS"
echo '! [remote rejected] main (stale info)' >&2
exit 1
EOF

cat >"$tmp/not-found" <<'EOF'
#!/bin/sh
n=$(cat "$CALLS" 2>/dev/null || echo 0)
n=$((n + 1))
printf '%s\n' "$n" >"$CALLS"
echo 'GraphQL: Could not resolve to an issue or pull request with the number of 999999.' >&2
exit 1
EOF
chmod +x "$tmp/flaky" "$tmp/permanent" "$tmp/not-found"

# 传输层错误重试到成功；半截 stdout 不放行，只有最终成功输出。
: >"$tmp/calls"
out=$(CALLS="$tmp/calls" AGENT_NET_CALL_BASE_DELAY=0 \
  sh "$script_dir/net-call.sh" "$tmp/flaky")
[ "$out" = eventual-ok ]
[ "$(cat "$tmp/calls")" = 3 ]

# 确定性错误（lease 拒绝）不重试，首次失败即返回。
: >"$tmp/calls"
if CALLS="$tmp/calls" AGENT_NET_CALL_BASE_DELAY=0 \
  sh "$script_dir/net-call.sh" "$tmp/permanent" >/dev/null 2>&1; then
  echo 'permanent error unexpectedly succeeded' >&2
  exit 1
fi
[ "$(cat "$tmp/calls")" = 1 ]

# "Could not resolve to an issue" 是确定性 404，不得误判为 DNS 抖动重试。
: >"$tmp/calls"
if CALLS="$tmp/calls" AGENT_NET_CALL_BASE_DELAY=0 \
  sh "$script_dir/net-call.sh" "$tmp/not-found" >/dev/null 2>&1; then
  echo 'not-found error unexpectedly succeeded' >&2
  exit 1
fi
[ "$(cat "$tmp/calls")" = 1 ]

# transient 打满 attempts 后放弃。
: >"$tmp/calls"
if CALLS="$tmp/calls" AGENT_NET_CALL_BASE_DELAY=0 AGENT_NET_CALL_ATTEMPTS=2 \
  sh "$script_dir/net-call.sh" "$tmp/flaky" >/dev/null 2>&1; then
  echo 'exhausted transient unexpectedly succeeded' >&2
  exit 1
fi
[ "$(cat "$tmp/calls")" = 2 ]
