#!/bin/sh
set -eu

agent_loop_gh=${AGENT_LOOP_GH:-gh}

usage() {
  echo "usage: $0 {bootstrap|validate-body|transition|queue|dispatch|daemon|reconcile-ci} [arg]" >&2
  exit 64
}

labels_of() {
  printf '%s' "$1" | jq -r '.labels[].name'
}

has_label() {
  labels_of "$1" | grep -Fqx "$2"
}

ensure_label() {
  name=$1 description=$2 color=$3
  if ! printf '%s\n' "$agent_loop_labels" | grep -Fqx "$name"; then
    "$agent_loop_gh" label create "$name" --description "$description" --color "$color"
  fi
}

bootstrap() {
  agent_loop_labels=$("$agent_loop_gh" label list --limit 100 --json name --jq '.[].name')
  ensure_label 'needs-info' 'Waiting for information needed to proceed' 'd876e3'
  ensure_label 'ready-for-human' 'Requires human implementation' 'fbca04'
  ensure_label 'grill-me' 'Human decision clarification in progress' '8250df'
  ensure_label 'decision-confirmed' 'Human confirmed the Grill Me decisions' '0e8a16'
  ensure_label 'agent:brief' 'Agent turns confirmed decisions into executable tickets' '1d76db'
  ensure_label 'agent:task' 'Validated executable implementation ticket' '1d76db'
  ensure_label 'agent:queued' 'Awaiting dependency-free agent dispatch' 'fbca04'
  ensure_label 'agent:running' 'Agent worker owns this issue' '0969da'
  ensure_label 'agent:repair' 'Existing agent PR needs a CI repair pass' 'd93f0b'
  ensure_label 'agent:blocked' 'Agent needs a new decision or named authority' 'b60205'
  ensure_label 'agent:automerge' 'Agent PR may merge after required checks' '0e8a16'
  ensure_label 'serial-only' 'Autopilot: run exclusively, no parallel siblings' 'd93f0b'
}

validate_body() {
  body=$(cat)
  for heading in Goal Scope 'Acceptance criteria' Dependencies; do
    if ! printf '%s\n' "$body" | grep -Eq "^#{2,3} $heading$"; then
      echo "missing required heading: $heading" >&2
      return 1
    fi
  done
  if ! printf '%s\n' "$body" | awk '/^#{2,3} Acceptance criteria$/{found=1; next} /^#{2,3} /{if (found) exit} found && /^- \[[ xX]\] .+/{ok=1} END{exit !ok}'; then
    echo 'acceptance criteria need at least one checkbox' >&2
    return 1
  fi
  if ! printf '%s\n' "$body" | awk '/^#{2,3} Dependencies$/{found=1; next} /^#{2,3} /{if (found) exit} found && /^- /{ok=1} END{exit !ok}'; then
    echo 'dependencies need an explicit list or - None' >&2
    return 1
  fi
}

issue_json() {
  "$agent_loop_gh" issue view "$1" --json number,state,body,labels
}

transition() {
  issue=${1:?issue number required}
  json=$(issue_json "$issue")
  state=$(printf '%s' "$json" | jq -r .state)
  [ "$state" = OPEN ] || return 0
  if has_label "$json" 'agent:blocked' || has_label "$json" 'agent:running'; then
    return 0
  fi

  if has_label "$json" 'grill-me' && has_label "$json" 'decision-confirmed'; then
    "$agent_loop_gh" issue edit "$issue" --add-label 'ready-for-agent,agent:brief,agent:queued' --remove-label 'needs-triage,needs-info' >/dev/null
    return 0
  fi

  if has_label "$json" 'ready-for-agent' && ! has_label "$json" 'agent:brief'; then
    if printf '%s' "$json" | jq -r .body | validate_body; then
      "$agent_loop_gh" issue edit "$issue" --add-label 'agent:task,agent:queued' --remove-label 'needs-triage,needs-info' >/dev/null
    else
      "$agent_loop_gh" issue edit "$issue" --add-label needs-info >/dev/null
    fi
  fi
}

blocked_by_open_issue() {
  "$agent_loop_gh" api "repos/{owner}/{repo}/issues/$1" --jq '.issue_dependencies_summary.blocked_by' | grep -Eq '^[1-9][0-9]*$'
}

queue_json() {
  "$agent_loop_gh" issue list --state open --label ready-for-agent --limit 100 --json number,labels
}

queue() {
  candidates=$(queue_json)
  running=$(printf '%s' "$candidates" | jq '[.[] | select(any(.labels[]; .name == "agent:running"))] | length')
  running_serial=$(printf '%s' "$candidates" | jq -r '.[] | select(any(.labels[]; .name == "agent:running")) | .number' |
    while IFS= read -r issue; do
      json=$(issue_json "$issue")
      if has_label "$json" 'serial-only'; then
        echo 1
        break
      fi
    done)
  if [ -n "$running_serial" ]; then
    return 0
  fi

  serial=$(printf '%s' "$candidates" | jq -r '.[] | select(any(.labels[]; .name == "agent:queued") and any(.labels[]; .name == "serial-only")) | .number' |
    while IFS= read -r issue; do
      if ! blocked_by_open_issue "$issue"; then
        printf '%s\n' "$issue"
        break
      fi
    done)
  if [ -n "$serial" ]; then
    [ "$running" -eq 0 ] && printf '%s\n' "$serial"
    return 0
  fi

  printf '%s\n' "$candidates" | jq -r '.[] | select(any(.labels[]; .name == "agent:queued") and (any(.labels[]; .name == "agent:task") or any(.labels[]; .name == "agent:brief"))) | .number' |
  while IFS= read -r issue; do
    [ -n "$issue" ] || continue
    if blocked_by_open_issue "$issue"; then
      continue
    fi
    json=$(issue_json "$issue")
    has_label "$json" 'serial-only' && continue
    if has_label "$json" 'agent:task' && ! printf '%s' "$json" | jq -r .body | validate_body; then
      "$agent_loop_gh" issue edit "$issue" --add-label needs-info --remove-label agent:queued >/dev/null
      continue
    fi
    printf '%s\n' "$issue"
  done
}

dispatch() {
  root=$(git rev-parse --show-toplevel)
  worktrees=${AGENT_LOOP_WORKTREES:-"$root/.worktrees"}
  mkdir -p "$worktrees"
  git fetch origin main
  queue | while IFS= read -r issue; do
    [ -n "$issue" ] || continue
    worktree="$worktrees/issue-$issue"
    branch="codex/issue-$issue"
    if [ ! -d "$worktree" ]; then
      if git show-ref --verify --quiet "refs/heads/$branch"; then
        git worktree add "$worktree" "$branch"
      else
        git worktree add -b "$branch" "$worktree" origin/main
      fi
    fi
    "$agent_loop_gh" issue edit "$issue" --add-label agent:running --remove-label agent:queued >/dev/null
    nohup sh "$root/scripts/agent-worker.sh" "$issue" "$worktree" >"$worktrees/issue-$issue.log" 2>&1 &
    echo "started #$issue in $worktree"
  done
}

daemon() {
  interval=${AGENT_LOOP_INTERVAL:-30}
  case $interval in *[!0-9]*|'') echo 'AGENT_LOOP_INTERVAL must be a positive integer' >&2; exit 64;; esac
  while :; do
    dispatch
    sleep "$interval"
  done
}

reconcile_ci() {
  branch=${1:?branch required}
  issue=${branch#codex/issue-}
  case $issue in *[!0-9]*|'') exit 0;; esac
  pr=$("$agent_loop_gh" pr list --head "$branch" --state open --json number,labels --jq '.[] | select(any(.labels[]; .name == "agent:automerge")) | .number' | head -1)
  [ -n "$pr" ] || exit 0
  "$agent_loop_gh" issue edit "$issue" --add-label 'agent:repair,agent:queued' --remove-label agent:running >/dev/null
}

case ${1:-} in
  bootstrap) bootstrap ;;
  validate-body) validate_body ;;
  transition) transition "${2:-}" ;;
  queue) queue ;;
  dispatch) dispatch ;;
  daemon) daemon ;;
  reconcile-ci) reconcile_ci "${2:-}" ;;
  *) usage ;;
esac
