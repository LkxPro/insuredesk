#!/bin/sh
set -eu

: "${AGENT_WORKTREE:?set AGENT_WORKTREE to the isolated worktree path}"
: "${AGENT_TASK_FILE:?set AGENT_TASK_FILE to the task file path}"
: "${AGENT_OUTPUT_FILE:?set AGENT_OUTPUT_FILE to the result file path}"

claude_bin=${AGENT_CLAUDE_BIN:-claude}
permission_mode=${AGENT_CLAUDE_PERMISSION_MODE:-bypassPermissions}

set -- -p --output-format json

if [ -n "${AGENT_MAX_TURNS:-}" ]; then
  set -- "$@" --max-turns "$AGENT_MAX_TURNS"
fi

# headless -p 下权限弹窗等于自动拒绝，必须显式 bypass；账户/provider/model
# 一律由本机 claude 配置决定，这里不感知。
if [ "$permission_mode" = bypassPermissions ]; then
  set -- "$@" --dangerously-skip-permissions
else
  set -- "$@" --permission-mode "$permission_mode"
fi

if [ -n "${AGENT_MODEL:-}" ]; then
  set -- "$@" --model "$AGENT_MODEL"
fi

cd "$AGENT_WORKTREE"
"$claude_bin" "$@" <"$AGENT_TASK_FILE" >"$AGENT_OUTPUT_FILE"
