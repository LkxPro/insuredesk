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
cat >/dev/null
printf '{"result":"ok"}\n'
EOF
chmod +x "$tmp/bin/claude"

if AGENT_EXECUTOR=claude \
  AGENT_CLAUDE_BIN="$tmp/bin/claude" \
  ANTHROPIC_BASE_URL=https://provider.invalid \
  AGENT_MODEL=test-model \
  AGENT_WORKTREE="$tmp/worktree" \
  AGENT_TASK_FILE="$tmp/prompt.md" \
  AGENT_OUTPUT_FILE="$tmp/output.txt" \
  "$repo/scripts/agent/run-executor.sh" >/dev/null 2>&1; then
  echo 'Claude adapter unexpectedly accepted missing credentials' >&2
  exit 1
fi

if AGENT_EXECUTOR=claude \
  AGENT_CLAUDE_BIN="$tmp/bin/claude" \
  ANTHROPIC_BASE_URL=https://provider.invalid \
  ANTHROPIC_AUTH_TOKEN=token \
  ANTHROPIC_API_KEY=key \
  AGENT_MODEL=test-model \
  AGENT_WORKTREE="$tmp/worktree" \
  AGENT_TASK_FILE="$tmp/prompt.md" \
  AGENT_OUTPUT_FILE="$tmp/output.txt" \
  "$repo/scripts/agent/run-executor.sh" >/dev/null 2>&1; then
  echo 'Claude adapter unexpectedly accepted two credential modes' >&2
  exit 1
fi

for credential in token key; do
  if [ "$credential" = token ]; then
    ANTHROPIC_AUTH_TOKEN=value ANTHROPIC_API_KEY='' \
      AGENT_EXECUTOR=claude AGENT_CLAUDE_BIN="$tmp/bin/claude" \
      ANTHROPIC_BASE_URL=https://provider.invalid AGENT_MODEL=test-model \
      AGENT_WORKTREE="$tmp/worktree" AGENT_TASK_FILE="$tmp/prompt.md" \
      AGENT_OUTPUT_FILE="$tmp/output.txt" "$repo/scripts/agent/run-executor.sh"
  else
    ANTHROPIC_AUTH_TOKEN='' ANTHROPIC_API_KEY=value \
      AGENT_EXECUTOR=claude AGENT_CLAUDE_BIN="$tmp/bin/claude" \
      ANTHROPIC_BASE_URL=https://provider.invalid AGENT_MODEL=test-model \
      AGENT_WORKTREE="$tmp/worktree" AGENT_TASK_FILE="$tmp/prompt.md" \
      AGENT_OUTPUT_FILE="$tmp/output.txt" "$repo/scripts/agent/run-executor.sh"
  fi
done
