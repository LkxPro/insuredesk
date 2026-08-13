#!/bin/sh
set -eu

: "${AGENT_WORKTREE:?set AGENT_WORKTREE to the isolated worktree path}"
: "${AGENT_TASK_FILE:?set AGENT_TASK_FILE to the task file path}"
: "${AGENT_OUTPUT_FILE:?set AGENT_OUTPUT_FILE to the result file path}"
: "${ANTHROPIC_BASE_URL:?set ANTHROPIC_BASE_URL to the custom provider URL}"
: "${AGENT_MODEL:?set AGENT_MODEL to the custom provider model}"

case ${ANTHROPIC_AUTH_TOKEN:+token}:${ANTHROPIC_API_KEY:+key} in
  token:|:key) ;;
  :) echo 'set exactly one of ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY' >&2; exit 64 ;;
  token:key) echo 'ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY are mutually exclusive' >&2; exit 64 ;;
esac

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

set -- "$@" --model "$AGENT_MODEL"

cd "$AGENT_WORKTREE"
"$claude_bin" "$@" <"$AGENT_TASK_FILE" >"$AGENT_OUTPUT_FILE"
