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

cat >"$tmp/bin/claude" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$CLAUDE_ARGS_LOG"
cat >/dev/null
printf '{"result":"ok"}\n'
EOF
chmod +x "$tmp/bin/claude"

# 无任何 provider/model 环境变量时也照常运行：账户配置由本机 claude 设置决定。
AGENT_EXECUTOR=claude AGENT_CLAUDE_BIN="$tmp/bin/claude" \
  CLAUDE_ARGS_LOG="$tmp/args.log" \
  AGENT_WORKTREE="$tmp/worktree" AGENT_TASK_FILE="$tmp/prompt.md" \
  AGENT_OUTPUT_FILE="$tmp/output.txt" "$repo/scripts/agent/run-executor.sh"
grep -Fqx -- '--dangerously-skip-permissions' "$tmp/args.log"
if grep -Fqx -- '--model' "$tmp/args.log" || grep -Fqx -- '--max-turns' "$tmp/args.log"; then
  echo 'claude adapter passed --model/--max-turns without explicit configuration' >&2
  exit 1
fi

AGENT_EXECUTOR=claude AGENT_CLAUDE_BIN="$tmp/bin/claude" \
  CLAUDE_ARGS_LOG="$tmp/args.log" \
  AGENT_MODEL=test-model AGENT_MAX_TURNS=25 \
  AGENT_WORKTREE="$tmp/worktree" AGENT_TASK_FILE="$tmp/prompt.md" \
  AGENT_OUTPUT_FILE="$tmp/output.txt" "$repo/scripts/agent/run-executor.sh"
grep -Fqx -- '--model' "$tmp/args.log" && grep -Fqx 'test-model' "$tmp/args.log"
grep -Fqx -- '--max-turns' "$tmp/args.log" && grep -Fqx '25' "$tmp/args.log"

AGENT_EXECUTOR=claude AGENT_CLAUDE_BIN="$tmp/bin/claude" \
  CLAUDE_ARGS_LOG="$tmp/args.log" \
  AGENT_CLAUDE_PERMISSION_MODE=acceptEdits \
  AGENT_WORKTREE="$tmp/worktree" AGENT_TASK_FILE="$tmp/prompt.md" \
  AGENT_OUTPUT_FILE="$tmp/output.txt" "$repo/scripts/agent/run-executor.sh"
grep -Fqx -- '--permission-mode' "$tmp/args.log" && grep -Fqx 'acceptEdits' "$tmp/args.log"
if grep -Fqx -- '--dangerously-skip-permissions' "$tmp/args.log"; then
  echo 'claude adapter mixed bypassPermissions with explicit permission mode' >&2
  exit 1
fi
