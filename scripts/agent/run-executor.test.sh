#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/worktree" "$tmp/bin"
printf 'test prompt\n' >"$tmp/prompt.md"

cat >"$tmp/bin/custom-adapter" <<'EOF'
#!/bin/sh
printf '%s\n' "$AGENT_WORKTREE" >"$ADAPTER_LOG"
cp "$AGENT_TASK_FILE" "$AGENT_OUTPUT_FILE"
EOF
chmod +x "$tmp/bin/custom-adapter"

AGENT_EXECUTOR_ADAPTER="$tmp/bin/custom-adapter" \
  AGENT_WORKTREE="$tmp/worktree" \
  AGENT_TASK_FILE="$tmp/prompt.md" \
  AGENT_OUTPUT_FILE="$tmp/output.txt" \
  ADAPTER_LOG="$tmp/adapter.log" \
  "$repo/scripts/agent/run-executor.sh"

grep -Fqx "$tmp/worktree" "$tmp/adapter.log"
grep -Fqx 'test prompt' "$tmp/output.txt"

if AGENT_EXECUTOR='../escape' \
  AGENT_WORKTREE="$tmp/worktree" \
  AGENT_TASK_FILE="$tmp/prompt.md" \
  AGENT_OUTPUT_FILE="$tmp/output.txt" \
  "$repo/scripts/agent/run-executor.sh" >/dev/null 2>&1; then
  echo 'unsafe executor name unexpectedly accepted' >&2
  exit 1
fi
