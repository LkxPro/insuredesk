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
  for heading in Goal Scope 'Declared touch-set' 'Logical locks' 'Acceptance criteria' Dependencies 'Test plan'; do
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
  for heading in 'Declared touch-set' 'Logical locks' 'Test plan'; do
    if ! printf '%s\n' "$body" | awk -v heading="$heading" '$0 ~ "^#{2,3} " heading "$"{found=1; next} /^#{2,3} /{if (found) exit} found && /^- /{ok=1} END{exit !ok}'; then
      echo "$heading needs an explicit list or - None" >&2
      return 1
    fi
  done
  for heading in 'Declared touch-set' 'Test plan'; do
    if ! printf '%s\n' "$body" | awk -v heading="$heading" '$0 ~ "^#{2,3} " heading "$"{found=1; next} /^#{2,3} /{if (found) exit} found && /^- / && tolower($0) != "- none"{ok=1} END{exit !ok}'; then
      echo "$heading cannot be None" >&2
      return 1
    fi
  done
}

issue_json() {
  "$agent_loop_gh" issue view "$1" --json number,state,body,labels
}

sync_dependencies() {
  issue=$1
  body=$2
  refs=$(printf '%s\n' "$body" | awk '
    /^#{2,3} Dependencies$/{found=1; next}
    /^#{2,3} /{if (found) exit}
    found{print}
  ' | grep -Eo '#[0-9]+' | tr -d '#' | sort -un || true)
  for blocker in $refs; do
    blocker_id=$("$agent_loop_gh" api "repos/{owner}/{repo}/issues/$blocker" --jq .id)
    if ! "$agent_loop_gh" api --method POST "repos/{owner}/{repo}/issues/$issue/dependencies/blocked_by" \
      -F issue_id="$blocker_id" >/dev/null 2>"${TMPDIR:-/tmp}/agent-dependency-error.$$"; then
      if ! "$agent_loop_gh" api "repos/{owner}/{repo}/issues/$issue/dependencies/blocked_by" \
        --paginate --jq '.[].id' | grep -Fqx "$blocker_id"; then
        cat "${TMPDIR:-/tmp}/agent-dependency-error.$$" >&2
        rm -f "${TMPDIR:-/tmp}/agent-dependency-error.$$"
        return 1
      fi
    fi
    rm -f "${TMPDIR:-/tmp}/agent-dependency-error.$$"
  done
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
      sync_dependencies "$issue" "$(printf '%s' "$json" | jq -r .body)"
      "$agent_loop_gh" issue edit "$issue" --add-label 'agent:task,agent:queued' --remove-label 'needs-triage,needs-info' >/dev/null
    else
      "$agent_loop_gh" issue edit "$issue" --add-label needs-info --remove-label 'ready-for-agent,agent:queued,agent:task' >/dev/null
    fi
  fi
}

queue_json() {
  "$agent_loop_gh" issue list --state open --label ready-for-agent --limit 100 --json number,labels
}

queue() {
  max_parallel=${1:-${AGENT_LOOP_MAX_PARALLEL:-4}}
  case $max_parallel in *[!0-9]*|'') echo 'AGENT_LOOP_MAX_PARALLEL must be a positive integer' >&2; exit 64;; esac
  [ "$max_parallel" -gt 0 ] || { echo 'AGENT_LOOP_MAX_PARALLEL must be a positive integer' >&2; exit 64; }
  root=$(git rev-parse --show-toplevel)
  payload=$(queue_json | jq -r '.[].number' |
    while IFS= read -r issue; do
      "$agent_loop_gh" api "repos/{owner}/{repo}/issues/$issue"
    done | jq -s .)
  result=$(printf '%s' "$payload" | node "$root/scripts/agent/frontier.mjs" "$max_parallel")
  printf '%s' "$result" | jq -r '.skipped[] | "skip #\(.number): \(.reason)"' >&2
  printf '%s' "$result" | jq -r '.selected[]'
}

dispatch() {
  root=$(git rev-parse --show-toplevel)
  worktrees=${AGENT_LOOP_WORKTREES:-"$root/.worktrees"}
  max_parallel=${AGENT_LOOP_MAX_PARALLEL:-4}
  case $max_parallel in *[!0-9]*|'') echo 'AGENT_LOOP_MAX_PARALLEL must be a positive integer' >&2; exit 64;; esac
  [ "$max_parallel" -gt 0 ] || { echo 'AGENT_LOOP_MAX_PARALLEL must be a positive integer' >&2; exit 64; }
  mkdir -p "$worktrees"
  for closed_worktree in "$worktrees"/issue-*; do
    [ -d "$closed_worktree" ] || continue
    closed_issue=${closed_worktree##*/issue-}
    case $closed_issue in *[!0-9]*|'') continue;; esac
    if "$agent_loop_gh" issue view "$closed_issue" --json state --jq .state | grep -Fqx CLOSED; then
      closed_branch=$(git -C "$closed_worktree" branch --show-current)
      git worktree remove --force "$closed_worktree"
      case $closed_branch in codex/issue-*) git branch -D "$closed_branch" >/dev/null 2>&1 || true;; esac
      rm -f "$worktrees/issue-$closed_issue.pid" "$worktrees/issue-$closed_issue.log" \
        "$worktrees/issue-$closed_issue.implementation.json" "$worktrees/issue-$closed_issue.review.json"
    fi
  done
  queue_json | jq -r '.[] | select(any(.labels[]; .name == "agent:running")) | .number' |
  while IFS= read -r running_issue; do
    pid_file="$worktrees/issue-$running_issue.pid"
    alive=false
    if [ -f "$pid_file" ]; then
      pid=$(cat "$pid_file")
      case $pid in
        *[!0-9]*|'') ;;
        *) kill -0 "$pid" 2>/dev/null && alive=true ;;
      esac
    fi
    if [ "$alive" = false ]; then
      "$agent_loop_gh" issue edit "$running_issue" --add-label agent:queued --remove-label agent:running >/dev/null
      "$agent_loop_gh" issue comment "$running_issue" --body 'Recovered a stale agent:running claim; requeued for dispatch.' >/dev/null
    fi
  done
  git fetch origin main
  queue "$max_parallel" | while IFS= read -r issue; do
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
    pid_file="$worktrees/issue-$issue.pid"
    nohup sh -c 'sh "$1" "$2" "$3"; status=$?; rm -f "$4"; exit "$status"' sh \
      "$root/scripts/agent-worker.sh" "$issue" "$worktree" "$pid_file" \
      >"$worktrees/issue-$issue.log" 2>&1 &
    printf '%s\n' "$!" >"$pid_file"
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
