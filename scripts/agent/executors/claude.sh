#!/bin/sh
set -eu

: "${AGENT_WORKTREE:?set AGENT_WORKTREE to the isolated worktree path}"
: "${AGENT_TASK_FILE:?set AGENT_TASK_FILE to the task file path}"
: "${AGENT_OUTPUT_FILE:?set AGENT_OUTPUT_FILE to the result file path}"

claude_bin=${AGENT_CLAUDE_BIN:-claude}
permission_mode=${AGENT_CLAUDE_PERMISSION_MODE:-bypassPermissions}
allowed_tools=${AGENT_CLAUDE_ALLOWED_TOOLS:-Bash,Read,Edit,Write,Glob,Grep}
max_turns=${AGENT_MAX_TURNS:-80}

set -- -p --output-format json --max-turns "$max_turns" --allowedTools "$allowed_tools"

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
