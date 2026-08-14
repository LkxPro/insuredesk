#!/bin/sh
set -eu

agent_loop_gh=${AGENT_LOOP_GH:-gh}
agent_loop_daemon_lock=''
agent_loop_dispatch_lock=''
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# 短超时快失败：claim/心跳验证必须远快于 stale 窗口，长退避留给 dispatch 主路。
gh_call() {
  sh "$script_dir/agent/net-call.sh" "$agent_loop_gh" "$@"
}
git_call() {
  sh "$script_dir/agent/net-call.sh" git "$@"
}
git_call_fast() {
  AGENT_NET_CALL_ATTEMPTS=2 AGENT_NET_CALL_TIMEOUT_SECONDS=15 \
    sh "$script_dir/agent/net-call.sh" git "$@"
}

usage() {
  echo "usage: $0 {bootstrap|validate-body|transition|queue|dispatch|daemon|claim|release-claim|release-remote-claim|heartbeat-claim|reconcile-ci} [arg]" >&2
  exit 64
}

release_lock() {
  lock=$1
  [ -n "$lock" ] || return 0
  owner=''
  [ -f "$lock/pid" ] && owner=$(cat "$lock/pid")
  case $owner in
    *[!0-9]*|'') ;;
    "$$") ;;
    *) return 1 ;;
  esac
  rm -f "$lock/pid"
  rmdir "$lock" 2>/dev/null || true
}

cleanup_locks() {
  release_lock "$agent_loop_dispatch_lock"
  release_lock "$agent_loop_daemon_lock"
}

acquire_lock() {
  lock=$1
  if mkdir "$lock" 2>/dev/null; then
    printf '%s\n' "$$" >"$lock/pid"
    return 0
  fi
  owner=''
  [ -f "$lock/pid" ] && owner=$(cat "$lock/pid")
  case $owner in
    *[!0-9]*|'') ;;
    *) kill -0 "$owner" 2>/dev/null && return 1 ;;
  esac
  rm -f "$lock/pid"
  rmdir "$lock" 2>/dev/null || return 1
  mkdir "$lock" 2>/dev/null || return 1
  printf '%s\n' "$$" >"$lock/pid"
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
    gh_call label create "$name" --description "$description" --color "$color"
  fi
}

bootstrap() {
  agent_loop_labels=$(gh_call label list --limit 100 --json name --jq '.[].name')
  ensure_label 'needs-info' 'Waiting for information needed to proceed' 'd876e3'
  ensure_label 'ready-for-human' 'Requires human implementation' 'fbca04'
  ensure_label 'agent:spec' 'Confirmed specification published from a local design session' '8250df'
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
  gh_call issue view "$1" --json number,state,body,labels
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
    blocker_id=$(gh_call api "repos/{owner}/{repo}/issues/$blocker" --jq .id)
    if ! gh_call api --method POST "repos/{owner}/{repo}/issues/$issue/dependencies/blocked_by" \
      -F issue_id="$blocker_id" >/dev/null 2>"${TMPDIR:-/tmp}/agent-dependency-error.$$"; then
      if ! gh_call api "repos/{owner}/{repo}/issues/$issue/dependencies/blocked_by" \
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

  if has_label "$json" 'agent:spec'; then
    gh_call issue edit "$issue" --remove-label 'ready-for-agent,agent:queued,agent:running,agent:task,needs-info' >/dev/null
    return 0
  fi

  if has_label "$json" 'ready-for-agent'; then
    if printf '%s' "$json" | jq -r .body | validate_body; then
      sync_dependencies "$issue" "$(printf '%s' "$json" | jq -r .body)"
      gh_call issue edit "$issue" --add-label 'agent:task,agent:queued' --remove-label 'needs-triage,needs-info' >/dev/null
    else
      gh_call issue edit "$issue" --add-label needs-info --remove-label 'ready-for-agent,agent:queued,agent:task' >/dev/null
    fi
  fi
}

queue_json() {
  queued=$(gh_call issue list --state open --label agent:queued --limit 100 --json number,labels)
  running=$(gh_call issue list --state open --label agent:running --limit 100 --json number,labels)
  jq -n --argjson queued "$queued" --argjson running "$running" \
    '$queued + $running | unique_by(.number)'
}

queue() {
  max_parallel=${1:-${AGENT_LOOP_MAX_PARALLEL:-4}}
  case $max_parallel in *[!0-9]*|'') echo 'AGENT_LOOP_MAX_PARALLEL must be a positive integer' >&2; exit 64;; esac
  [ "$max_parallel" -gt 0 ] || { echo 'AGENT_LOOP_MAX_PARALLEL must be a positive integer' >&2; exit 64; }
  root=$(git rev-parse --show-toplevel)
  payload=$(queue_json | jq -r '.[].number' |
    while IFS= read -r issue; do
      gh_call api "repos/{owner}/{repo}/issues/$issue"
    done | jq -s .)
  result=$(printf '%s' "$payload" | node "$root/scripts/agent/frontier.mjs" "$max_parallel")
  printf '%s' "$result" | jq -r '.skipped[] | "skip #\(.number): \(.reason)"' >&2
  printf '%s' "$result" | jq -r '.selected[]'
}

pid_is_alive() {
  pid_file=$1
  [ -f "$pid_file" ] || return 1
  pid=$(cat "$pid_file")
  case $pid in
    *[!0-9]*|'') return 1 ;;
    *) kill -0 "$pid" 2>/dev/null ;;
  esac
}

claim_issue() {
  issue=${1:?issue number required}
  worktrees=${2:?worktree root required}
  max_parallel=${3:-${AGENT_LOOP_MAX_PARALLEL:-4}}
  case $max_parallel in *[!0-9]*|'') echo 'claim capacity must be a positive integer' >&2; return 64;; esac
  [ "$max_parallel" -gt 0 ] || { echo 'claim capacity must be a positive integer' >&2; return 64; }
  root=$(git rev-parse --show-toplevel)
  claim_ref="refs/heads/agent-claims/issue-$issue"
  claim_file="$worktrees/issue-$issue.claim"
  [ ! -f "$claim_file" ] || return 1
  claim_sha=$(git -C "$root" rev-parse origin/main)
  slot=1
  while [ "$slot" -le "$max_parallel" ]; do
    slot_ref="refs/heads/agent-slots/$slot"
    claim_commit=$(git -C "$root" -c user.name=insuredesk-agent-claim \
      -c user.email=insuredesk-agent-claim@users.noreply.github.com \
      commit-tree "$claim_sha^{tree}" -p "$claim_sha" -m "claim issue $issue slot $slot by $$")
    printf '%s\n%s\n%s\n' "$claim_ref" "$slot_ref" "$claim_commit" >"$claim_file"
    if git -C "$root" push --atomic origin "$claim_commit:$claim_ref" \
      "$claim_commit:$slot_ref" >/dev/null 2>&1; then
      return 0
    fi
    slot=$((slot + 1))
  done
  rm -f "$claim_file"
  return 1
}

release_claim() {
  issue=${1:?issue number required}
  worktrees=${2:?worktree root required}
  root=$(git rev-parse --show-toplevel)
  claim_file="$worktrees/issue-$issue.claim"
  [ -f "$claim_file" ] || return 0
  claim_ref=$(sed -n '1p' "$claim_file")
  slot_ref=$(sed -n '2p' "$claim_file")
  claim_sha=$(sed -n '3p' "$claim_file")
  case $claim_ref in
    refs/heads/agent-claims/issue-"$issue") ;;
    *) echo "refusing unexpected claim ref in $claim_file" >&2; return 1 ;;
  esac
  slot=${slot_ref#refs/heads/agent-slots/}
  case $slot in
    *[!0-9]*|''|0) echo "refusing unexpected slot ref in $claim_file" >&2; return 1 ;;
  esac
  case $claim_sha in *[!0-9a-f]*|'') return 1;; esac
  if ! git_call -C "$root" push --atomic \
    --force-with-lease="$claim_ref:$claim_sha" --force-with-lease="$slot_ref:$claim_sha" \
    origin ":$claim_ref" ":$slot_ref" >/dev/null; then
    return 1
  fi
  rm -f "$claim_file"
}

release_remote_claim() {
  issue=${1:?issue number required}
  expected_sha=${2:-}
  root=$(git rev-parse --show-toplevel)
  claim_ref="refs/heads/agent-claims/issue-$issue"
  claim_sha=$(git_call_fast -C "$root" ls-remote origin "$claim_ref" | awk 'NR == 1 {print $1}')
  [ -n "$claim_sha" ] || return 0
  [ -z "$expected_sha" ] || [ "$claim_sha" = "$expected_sha" ] || return 1
  git_call -C "$root" fetch -q origin "$claim_ref"
  message=$(git -C "$root" log -1 --format=%B FETCH_HEAD)
  slot=$(printf '%s\n' "$message" | sed -n 's/^claim issue [0-9][0-9]* slot \([0-9][0-9]*\) by .*/\1/p')
  case $slot in *[!0-9]*|''|0) echo "cannot verify remote claim #$issue" >&2; return 1;; esac
  slot_ref="refs/heads/agent-slots/$slot"
  slot_sha=$(git_call_fast -C "$root" ls-remote origin "$slot_ref" | awk 'NR == 1 {print $1}')
  [ "$slot_sha" = "$claim_sha" ] || { echo "claim/slot owner mismatch for #$issue" >&2; return 1; }
  git_call -C "$root" push --atomic \
    --force-with-lease="$claim_ref:$claim_sha" --force-with-lease="$slot_ref:$claim_sha" \
    origin ":$claim_ref" ":$slot_ref" >/dev/null
}

remote_claim_is_stale() {
  issue=${1:?issue number required}
  stale_seconds=${AGENT_CLAIM_STALE_SECONDS:-300}
  case $stale_seconds in *[!0-9]*|'') return 1;; esac
  claim_ref="refs/heads/agent-claims/issue-$issue"
  git_call fetch -q origin "$claim_ref" || return 1
  claimed_at=$(git log -1 --format=%ct FETCH_HEAD)
  now=$(date +%s)
  [ $((now - claimed_at)) -ge "$stale_seconds" ] || return 1
  git rev-parse FETCH_HEAD
}

heartbeat_claim() {
  issue=${1:?issue number required}
  worktrees=${2:?worktree root required}
  claim_file="$worktrees/issue-$issue.claim"
  [ -f "$claim_file" ] || return 1
  claim_ref=$(sed -n '1p' "$claim_file")
  slot_ref=$(sed -n '2p' "$claim_file")
  expected=$(sed -n '3p' "$claim_file")
  current=$(git_call_fast ls-remote origin "$claim_ref" | awk 'NR == 1 {print $1}')
  slot_current=$(git_call_fast ls-remote origin "$slot_ref" | awk 'NR == 1 {print $1}')
  [ -n "$current" ] && [ "$current" = "$slot_current" ] && [ "$current" = "$expected" ] || return 1
  slot=${slot_ref#refs/heads/agent-slots/}
  heartbeat=$(git -c user.name=insuredesk-agent-claim \
    -c user.email=insuredesk-agent-claim@users.noreply.github.com \
    commit-tree "$current^{tree}" -p "$current" -m "claim issue $issue slot $slot by $$")
  git_call push --atomic \
    --force-with-lease="$claim_ref:$current" --force-with-lease="$slot_ref:$current" \
    origin "$heartbeat:$claim_ref" "$heartbeat:$slot_ref" >/dev/null
  sed -i.bak "3s/.*/$heartbeat/" "$claim_file"
  rm -f "$claim_file.bak"
}

dispatch() {
  root=$(git rev-parse --show-toplevel)
  worktrees=${AGENT_LOOP_WORKTREES:-"$root/.worktrees"}
  max_parallel=${AGENT_LOOP_MAX_PARALLEL:-4}
  case $max_parallel in *[!0-9]*|'') echo 'AGENT_LOOP_MAX_PARALLEL must be a positive integer' >&2; exit 64;; esac
  [ "$max_parallel" -gt 0 ] || { echo 'AGENT_LOOP_MAX_PARALLEL must be a positive integer' >&2; exit 64; }
  mkdir -p "$worktrees"
  dispatch_lock="$worktrees/.dispatch.lock"
  if ! acquire_lock "$dispatch_lock"; then
    echo "another dispatcher owns $dispatch_lock" >&2
    return 75
  fi
  agent_loop_dispatch_lock=$dispatch_lock
  trap cleanup_locks EXIT HUP INT TERM
  for orphan_claim in "$worktrees"/issue-*.claim; do
    [ -f "$orphan_claim" ] || continue
    orphan_issue=${orphan_claim##*/issue-}
    orphan_issue=${orphan_issue%.claim}
    case $orphan_issue in *[!0-9]*|'') continue;; esac
    if ! pid_is_alive "$worktrees/issue-$orphan_issue.pid"; then
      orphan_json=$(issue_json "$orphan_issue")
      if ! has_label "$orphan_json" agent:running; then
        release_claim "$orphan_issue" "$worktrees" || true
      fi
    fi
  done
  for closed_worktree in "$worktrees"/issue-*; do
    [ -d "$closed_worktree" ] || continue
    closed_issue=${closed_worktree##*/issue-}
    case $closed_issue in *[!0-9]*|'') continue;; esac
    if gh_call issue view "$closed_issue" --json state --jq .state | grep -Fqx CLOSED; then
      if pid_is_alive "$worktrees/issue-$closed_issue.pid"; then
        echo "defer cleanup #$closed_issue: worker is still active" >&2
        continue
      fi
      release_claim "$closed_issue" "$worktrees" || true
      closed_branch=$(git -C "$closed_worktree" branch --show-current)
      git worktree remove --force "$closed_worktree"
      case $closed_branch in codex/issue-*) git branch -D "$closed_branch" >/dev/null 2>&1 || true;; esac
      rm -f "$worktrees/issue-$closed_issue.pid" "$worktrees/issue-$closed_issue.log" \
        "$worktrees/issue-$closed_issue.implementation.json" "$worktrees/issue-$closed_issue.review.json" \
        "$worktrees/issue-$closed_issue.publishing"
    fi
  done
  queue_json | jq -r '.[] | select(any(.labels[]; .name == "agent:running")) | .number' |
  while IFS= read -r running_issue; do
    pid_file="$worktrees/issue-$running_issue.pid"
    if ! pid_is_alive "$pid_file"; then
      if [ -f "$worktrees/issue-$running_issue.claim" ]; then
        release_claim "$running_issue" "$worktrees" || continue
        rm -f "$worktrees/issue-$running_issue.publishing"
        gh_call issue edit "$running_issue" --add-label agent:queued --remove-label agent:running >/dev/null
        gh_call issue comment "$running_issue" --body 'Recovered a stale local agent:running claim; requeued for dispatch.' >/dev/null
      else
        remote_sha=$(git_call_fast -C "$root" ls-remote origin "refs/heads/agent-claims/issue-$running_issue" | awk 'NR == 1 {print $1}')
        if [ -z "$remote_sha" ]; then
          # 孤儿 running：本地 pid/claim 与远端 claim 都不存在，无人会来释放。
          gh_call issue edit "$running_issue" --add-label agent:queued --remove-label agent:running >/dev/null
          gh_call issue comment "$running_issue" --body 'Recovered an orphaned agent:running label; no live claim exists locally or remotely.' >/dev/null
          continue
        fi
        stale_sha=$(remote_claim_is_stale "$running_issue" || true)
        if [ -n "$stale_sha" ] && release_remote_claim "$running_issue" "$stale_sha"; then
          gh_call issue edit "$running_issue" --add-label agent:queued --remove-label agent:running >/dev/null
          gh_call issue comment "$running_issue" --body 'Recovered an expired remote agent claim; requeued for dispatch.' >/dev/null
        else
          echo "leave #$running_issue running: another clone has a live lease" >&2
        fi
      fi
    fi
  done
  git_call fetch origin main
  queue "$max_parallel" | while IFS= read -r issue; do
    [ -n "$issue" ] || continue
    if ! claim_issue "$issue" "$worktrees" "$max_parallel"; then
      stale_sha=$(remote_claim_is_stale "$issue" || true)
      if [ -n "$stale_sha" ] && release_remote_claim "$issue" "$stale_sha" && \
        claim_issue "$issue" "$worktrees" "$max_parallel"; then
        echo "recovered expired claim for #$issue" >&2
      else
        echo "skip #$issue: already claimed" >&2
        continue
      fi
    fi
    claim_payload=$(queue_json | jq -r '.[].number' |
      while IFS= read -r claim_candidate; do
        gh_call api "repos/{owner}/{repo}/issues/$claim_candidate"
      done | jq -s .)
    claim_frontier=$(printf '%s' "$claim_payload" | node "$root/scripts/agent/frontier.mjs" "$max_parallel")
    if [ "$(printf '%s' "$claim_frontier" | jq -r --argjson issue "$issue" '.selected | index($issue) != null')" != true ]; then
      release_claim "$issue" "$worktrees" || true
      echo "skip #$issue: eligibility changed before claim" >&2
      continue
    fi
    worktree="$worktrees/issue-$issue"
    branch="codex/issue-$issue"
    if [ ! -d "$worktree" ]; then
      if git show-ref --verify --quiet "refs/heads/$branch"; then
        if ! git worktree add "$worktree" "$branch"; then
          release_claim "$issue" "$worktrees" || true
          continue
        fi
      else
        if ! git worktree add -b "$branch" "$worktree" origin/main; then
          release_claim "$issue" "$worktrees" || true
          continue
        fi
      fi
    fi
    if ! gh_call issue edit "$issue" --add-label agent:running --remove-label agent:queued >/dev/null; then
      release_claim "$issue" "$worktrees" || true
      continue
    fi
    pid_file="$worktrees/issue-$issue.pid"
    # 上一轮残留的 run 产物会冒充本轮状态（如旧 fix-1.json 触发假 fix 信号）。
    rm -f "$worktrees/issue-$issue.publishing" \
      "$worktrees/issue-$issue.implementation.json" "$worktrees/issue-$issue.review.json" \
      "$worktrees"/issue-"$issue".fix-*.json
    nohup sh -c '
      sh "$1" "$2" "$3" "$7" "$8" & worker=$!
      misses=0
      while kill -0 "$worker" 2>/dev/null; do
        sleep "${AGENT_CLAIM_HEARTBEAT_INTERVAL:-60}"
        kill -0 "$worker" 2>/dev/null || break
        [ ! -f "$8" ] || break
        if sh "$4" heartbeat-claim "$2" "$5"; then
          misses=0
          continue
        fi
        [ ! -f "$8" ] || break
        # 单次网络抖动不该杀健康 worker；连续失败才认定 claim 丢失。
        # 默认 3 次 × 60s 间隔，仍显著低于 300s stale 判定窗口。
        misses=$((misses + 1))
        [ "$misses" -lt "${AGENT_CLAIM_HEARTBEAT_MAX_MISSES:-3}" ] && continue
        descendants=$(pgrep -P "$worker" 2>/dev/null || true)
        for descendant in $descendants; do
          pkill -TERM -P "$descendant" 2>/dev/null || true
          kill -TERM "$descendant" 2>/dev/null || true
        done
        kill -TERM "$worker" 2>/dev/null || true
        sleep 2
        descendants=$(pgrep -P "$worker" 2>/dev/null || true)
        for descendant in $descendants; do
          pkill -KILL -P "$descendant" 2>/dev/null || true
          kill -KILL "$descendant" 2>/dev/null || true
        done
        kill -KILL "$worker" 2>/dev/null || true
        break
      done & heartbeat=$!
      wait "$worker"; status=$?
      kill "$heartbeat" 2>/dev/null || true
      sh "$4" release-claim "$2" "$5" || true
      rm -f "$6" "$8"
      exit "$status"
    ' sh \
      "$root/scripts/agent-worker.sh" "$issue" "$worktree" "$root/scripts/agent-loop.sh" \
      "$worktrees" "$pid_file" "$worktrees/issue-$issue.claim" "$worktrees/issue-$issue.publishing" \
      >"$worktrees/issue-$issue.log" 2>&1 &
    printf '%s\n' "$!" >"$pid_file"
    echo "started #$issue in $worktree"
  done
  release_lock "$agent_loop_dispatch_lock"
  agent_loop_dispatch_lock=''
}

daemon() {
  interval=${AGENT_LOOP_INTERVAL:-30}
  case $interval in *[!0-9]*|'') echo 'AGENT_LOOP_INTERVAL must be a positive integer' >&2; exit 64;; esac
  root=$(git rev-parse --show-toplevel)
  worktrees=${AGENT_LOOP_WORKTREES:-"$root/.worktrees"}
  mkdir -p "$worktrees"
  daemon_lock="$worktrees/.daemon.lock"
  if ! acquire_lock "$daemon_lock"; then
    echo "another daemon owns $daemon_lock" >&2
    return 75
  fi
  agent_loop_daemon_lock=$daemon_lock
  trap cleanup_locks EXIT HUP INT TERM
  while :; do
    # 网络抖动集中在 dispatch 里回吐；一个失败的 tick 不该杀死常驻 daemon。
    if ! dispatch; then
      echo "dispatch tick failed; retrying after $interval seconds" >&2
    fi
    sleep "$interval"
  done
}

reconcile_ci() {
  branch=${1:?branch required}
  issue=${branch#codex/issue-}
  case $issue in *[!0-9]*|'') exit 0;; esac
  pr=$(gh_call pr list --head "$branch" --state open --json number,labels --jq '.[] | select(any(.labels[]; .name == "agent:automerge")) | .number' | head -1)
  [ -n "$pr" ] || exit 0
  max_attempts=${AGENT_REPAIR_MAX_ATTEMPTS:-3}
  case $max_attempts in *[!0-9]*|'') max_attempts=3 ;; esac
  attempts=$(gh_call issue view "$issue" --json comments \
    --jq '[.comments[].body | select(contains("<!-- agent-attempts:"))] | length')
  case $attempts in *[!0-9]*|'') attempts=0 ;; esac
  if [ "$attempts" -ge "$max_attempts" ]; then
    gh_call issue edit "$issue" --add-label agent:blocked \
      --remove-label 'agent:running,agent:queued,agent:repair' >/dev/null
    gh_call issue comment "$issue" \
      --body "CI repair attempt budget ($max_attempts) exhausted; needs human attention." >/dev/null
    exit 0
  fi
  gh_call issue comment "$issue" \
    --body "<!-- agent-attempts:$((attempts + 1)) --> CI failed on PR #$pr; requeued for repair (attempt $((attempts + 1))/$max_attempts)." >/dev/null
  # frontier 要求 queued+ready-for-agent；worker 发布时已摘除后者，回队必须补齐。
  gh_call issue edit "$issue" --add-label 'agent:repair,agent:queued,ready-for-agent' --remove-label agent:running >/dev/null
}

case ${1:-} in
  bootstrap) bootstrap ;;
  validate-body) validate_body ;;
  transition) transition "${2:-}" ;;
  queue) queue ;;
  dispatch) dispatch ;;
  daemon) daemon ;;
  claim) claim_issue "${2:-}" "${3:-}" "${4:-}" ;;
  release-claim) release_claim "${2:-}" "${3:-}" ;;
  release-remote-claim) release_remote_claim "${2:-}" "${3:-}" ;;
  heartbeat-claim) heartbeat_claim "${2:-}" "${3:-}" ;;
  reconcile-ci) reconcile_ci "${2:-}" ;;
  *) usage ;;
esac
