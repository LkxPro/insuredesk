#!/bin/sh
set -eu

issue=${1:?issue number required}
worktree=${2:?worktree required}
root=$(git -C "$worktree" rev-parse --show-toplevel)
agent_worker_gh=${AGENT_LOOP_GH:-gh}
agent_worker_codex=${AGENT_LOOP_CODEX:-codex}

labels=$("$agent_worker_gh" issue view "$issue" --json labels --jq '.labels[].name')
prompt_file="$root/.github/agent-prompts/task.md"
if printf '%s\n' "$labels" | grep -Fqx 'agent:brief'; then
  prompt_file="$root/.github/agent-prompts/brief.md"
elif printf '%s\n' "$labels" | grep -Fqx 'agent:repair'; then
  prompt_file="$root/.github/agent-prompts/repair.md"
fi

prompt="$(cat "$prompt_file")

Issue: #$issue. Use gh issue view $issue --comments before acting."

if "$agent_worker_codex" exec --dangerously-bypass-approvals-and-sandbox -C "$worktree" "$prompt"; then
  if "$agent_worker_gh" issue view "$issue" --json state --jq .state | grep -Fqx CLOSED; then
    exit 0
  fi
  pr=$("$agent_worker_gh" pr list --head "codex/issue-$issue" --state open --json number --jq '.[0].number')
  if [ -n "$pr" ]; then
    "$agent_worker_gh" pr edit "$pr" --add-label agent:automerge >/dev/null
    "$agent_worker_gh" issue edit "$issue" --remove-label 'agent:running,agent:repair' >/dev/null
    exit 0
  fi
fi

"$agent_worker_gh" issue edit "$issue" --add-label agent:blocked --remove-label 'agent:running,agent:queued' >/dev/null
"$agent_worker_gh" issue comment "$issue" --body 'Agent worker exited without a closing issue or open PR. Start a Grill Me issue if a decision is missing.' >/dev/null
exit 1
