#!/bin/sh
set -eu

issue=${1:?issue number required}
worktree=${2:?worktree required}
claim_file=${3:-}
publish_marker=${4:-}
root=$(git -C "$worktree" rev-parse --show-toplevel)
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
agent_worker_gh=${AGENT_LOOP_GH:-gh}

gh_call() {
  sh "$script_dir/agent/net-call.sh" "$agent_worker_gh" "$@"
}
git_call() {
  sh "$script_dir/agent/net-call.sh" git "$@"
}
git_call_fast() {
  AGENT_NET_CALL_ATTEMPTS=2 AGENT_NET_CALL_TIMEOUT_SECONDS=15 \
    sh "$script_dir/agent/net-call.sh" git "$@"
}
run_dir=$(mktemp -d)
restore_head=''
published=false
artifact_dir=$(dirname "$worktree")
check_lock="$artifact_dir/.check.lock"
check_lock_held=''
ignored_snapshot="$run_dir/ignored-before"
ignored_after="$run_dir/ignored-after"
ignored_created="$run_dir/ignored-created"
git -C "$worktree" ls-files --others --ignored --exclude-standard | sort >"$ignored_snapshot"
release_check_lock() {
  [ -n "$check_lock_held" ] || return 0
  rm -f "$check_lock/pid"
  rmdir "$check_lock" 2>/dev/null || true
  check_lock_held=''
}
acquire_check_lock() {
  while :; do
    if mkdir "$check_lock" 2>/dev/null; then
      printf '%s\n' "$$" >"$check_lock/pid"
      check_lock_held=1
      return 0
    fi
    owner=''
    [ -f "$check_lock/pid" ] && owner=$(cat "$check_lock/pid")
    case $owner in
      *[!0-9]*|'') ;;
      *) kill -0 "$owner" 2>/dev/null && { sleep 5; continue; } ;;
    esac
    rm -f "$check_lock/pid"
    rmdir "$check_lock" 2>/dev/null || sleep 5
  done
}
cleaned=''
cleanup() {
  [ -z "$cleaned" ] || return 0
  cleaned=1
  release_check_lock
  if [ -n "$restore_head" ] && [ "$published" = false ]; then
    git -C "$worktree" reset --hard "$restore_head" >/dev/null 2>&1 || true
    git -C "$worktree" clean -fd >/dev/null 2>&1 || true
    git -C "$worktree" ls-files --others --ignored --exclude-standard | sort >"$ignored_after"
    comm -13 "$ignored_snapshot" "$ignored_after" >"$ignored_created"
    while IFS= read -r ignored_path; do
      [ -n "$ignored_path" ] || continue
      case $ignored_path in
        /*|../*|*/../*) continue ;;
      esac
      rm -rf -- "$worktree/$ignored_path"
    done <"$ignored_created"
  fi
  rm -rf "$run_dir"
}
abort() {
  trap - EXIT HUP INT TERM
  cleanup
  exit 143
}
trap cleanup EXIT
trap abort HUP INT TERM
mkdir -p "$run_dir/gh"

claim_owned() {
  [ -z "$claim_file" ] && return 0
  [ -f "$claim_file" ] || return 1
  claim_ref=$(sed -n '1p' "$claim_file")
  slot_ref=$(sed -n '2p' "$claim_file")
  expected=$(sed -n '3p' "$claim_file")
  max=${AGENT_CLAIM_VERIFY_ATTEMPTS:-3}
  case $max in *[!0-9]*|'') max=3 ;; esac
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    current=$(git_call_fast -C "$worktree" ls-remote origin "$claim_ref" | awk 'NR == 1 {print $1}')
    slot_current=$(git_call_fast -C "$worktree" ls-remote origin "$slot_ref" | awk 'NR == 1 {print $1}')
    if [ -n "$expected" ] && [ "$current" = "$expected" ] && [ "$slot_current" = "$expected" ]; then
      return 0
    fi
    # 两次 ls-remote 之间 heartbeat 可能推进 sha 造成假丢失；退避后复查再定性。
    [ "$attempt" -lt "$max" ] || return 1
    sleep "${AGENT_CLAIM_VERIFY_DELAY:-2}"
  done
}

fence_claim() {
  [ -z "$claim_file" ] && return 0
  [ -z "$publish_marker" ] || : >"$publish_marker"
  claim_ref=$(sed -n '1p' "$claim_file")
  slot_ref=$(sed -n '2p' "$claim_file")
  expected=$(sed -n '3p' "$claim_file")
  fenced=$(git -C "$worktree" -c user.name=insuredesk-agent-claim \
    -c user.email=insuredesk-agent-claim@users.noreply.github.com \
    commit-tree "$expected^{tree}" -p "$expected" -m "publish issue $issue by $$")
  git_call -C "$worktree" push --atomic \
    --force-with-lease="$claim_ref:$expected" --force-with-lease="$slot_ref:$expected" \
    origin "$fenced:$claim_ref" "$fenced:$slot_ref" >/dev/null || return 1
  sed -i.bak "3s/.*/$fenced/" "$claim_file"
  rm -f "$claim_file.bak"
}

issue_file="$run_dir/issue.json"
gh_call issue view "$issue" --json number,title,body,comments,labels >"$issue_file"
labels=$(jq -r '.labels[].name' "$issue_file")
mode=task
prompt_file="$root/.github/agent-prompts/task.md"
if printf '%s\n' "$labels" | grep -Fqx 'agent:repair'; then
  mode=repair
  prompt_file="$root/.github/agent-prompts/repair.md"
fi

repair_context=''
if [ "$mode" = repair ]; then
  branch=$(git -C "$worktree" branch --show-current)
  failed_run=$(gh_call run list --branch "$branch" --status failure --limit 1 \
    --json databaseId --jq '.[0].databaseId' || true)
  if [ -n "$failed_run" ]; then
    repair_context=$run_dir/failed-ci.log
    gh_call run view "$failed_run" --log-failed >"$repair_context" 2>&1 || true
  fi
fi

run_agent() {
  prompt=$1
  output=$2
  # 保留 GitHub 发布隔离；HOME 不伪造，让 claude 读本机配置与凭据。
  GIT_CONFIG_GLOBAL=/dev/null \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url \
    GIT_CONFIG_VALUE_0=disabled://agent-model-has-no-publish-authority \
    GH_CONFIG_DIR="$run_dir/gh" GH_TOKEN='' GITHUB_TOKEN='' SSH_AUTH_SOCK='' \
    AGENT_WORKTREE="$worktree" \
    AGENT_TASK_FILE="$prompt" \
    AGENT_OUTPUT_FILE="$output" \
    "$script_dir/agent/run-executor.sh"
}

# subtype=error_during_execution 或结果 JSON 缺失/不可解析（CLI 崩溃）属于
# provider/网络 transient，同 run 内退避重试；error_max_turns 等行为类失败
# 重试无益，直接失败。
executor_transient() {
  subtype=$(jq -r '.subtype // empty' "$1" 2>/dev/null || true)
  case $subtype in ''|error_during_execution) return 0 ;; esac
  return 1
}

run_agent_with_retry() {
  prompt=$1
  output=$2
  max=${AGENT_EXECUTOR_ATTEMPTS:-2}
  case $max in *[!0-9]*|'') max=2 ;; esac
  [ "$max" -gt 0 ] || max=2
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    if run_agent "$prompt" "$output"; then
      return 0
    fi
    [ "$attempt" -lt "$max" ] || return 1
    executor_transient "$output" || return 1
    echo "executor attempt $attempt failed (transient); retrying" >&2
    sleep "${AGENT_EXECUTOR_RETRY_DELAY:-30}"
  done
}

task_file="$run_dir/task.md"
implementation_result="$artifact_dir/issue-$issue.implementation.json"
review_result="$artifact_dir/issue-$issue.review.json"
{
  cat "$prompt_file"
  printf '\n\n<issue_json>\n'
  jq -c . "$issue_file"
  printf '</issue_json>\n'
  if [ -n "$repair_context" ]; then
    printf '\n<failed_ci_log>\n'
    cat "$repair_context"
    printf '</failed_ci_log>\n'
  fi
} >"$task_file"

start_head=$(git -C "$worktree" rev-parse --verify '@{upstream}^{commit}' 2>/dev/null || \
  git -C "$worktree" rev-parse --verify 'origin/main^{commit}' 2>/dev/null || \
  git -C "$worktree" rev-parse --verify 'HEAD^{commit}')
git -C "$worktree" reset --hard "$start_head" >/dev/null
git -C "$worktree" clean -fd >/dev/null
restore_head=$start_head

# failure_class: process=executor/环境类，自动重排队一次；
# fatal=模型行为类（改历史/越界/零产出），立即 blocked；
# exhausted=确定性门在修复预算内未过，立即 blocked。
failure=''
failure_class=process
history_unchanged() {
  [ "$(git -C "$worktree" rev-parse HEAD)" = "$start_head" ]
}
verify_touch_set() {
  changed=$(git -C "$worktree" ls-files --modified --others --exclude-standard)
  { jq -c . "$issue_file"; printf '%s\n' "$changed"; } | node "$script_dir/agent/verify-touch-set.mjs" >/dev/null
}
check_with_lock() {
  acquire_check_lock
  make -C "$worktree" check >"$run_dir/check.log" 2>&1
  status=$?
  release_check_lock
  return "$status"
}

if ! run_agent_with_retry "$task_file" "$implementation_result"; then
  failure='Agent implementation process failed.'
elif ! history_unchanged; then
  failure='Agent changed git history instead of leaving a controller-owned diff.'
  failure_class=fatal
fi

if [ -z "$failure" ] && [ "${AGENT_REVIEW_ENABLED:-1}" = 1 ]; then
  review_file="$run_dir/review.md"
  {
    cat "$root/.github/agent-prompts/review.md"
    printf '\n\n<issue_json>\n'
    jq -c . "$issue_file"
    printf '</issue_json>\n'
  } >"$review_file"
  if ! run_agent_with_retry "$review_file" "$review_result"; then
    failure='Agent review process failed.'
  elif ! history_unchanged; then
    failure='Review agent changed git history instead of leaving a controller-owned diff.'
    failure_class=fatal
  fi
fi

if [ -z "$failure" ]; then
  changed=$(git -C "$worktree" ls-files --modified --others --exclude-standard)
  if [ -z "$changed" ]; then
    failure='Agent produced no repository change.'
    failure_class=fatal
  elif ! verify_touch_set; then
    failure='Agent changed files outside the declared touch-set.'
    failure_class=fatal
  fi
fi

fix_round=0
sweep_round=0
max_fix_rounds=${AGENT_FIX_MAX_ROUNDS:-3}
case $max_fix_rounds in *[!0-9]*) max_fix_rounds=3 ;; esac
# 清扫可能误删 eslint-disable/@ts-ignore 等指令注释，有改动就必须重跑 check。
worktree_fingerprint() {
  { git -C "$worktree" diff --binary
    git -C "$worktree" ls-files --others --exclude-standard \
      | while IFS= read -r f; do
          printf '%s ' "$f"
          git -C "$worktree" hash-object -- "$f" 2>/dev/null || true
        done
  } | git hash-object --stdin
}
while [ -z "$failure" ]; do
  if check_with_lock; then
    if [ "${AGENT_COMMENT_SWEEP_ENABLED:-1}" != 1 ]; then
      break
    fi
    sweep_round=$((sweep_round + 1))
    sweep_file="$run_dir/comment-sweep.md"
    {
      cat "$root/.github/agent-prompts/comment-sweep.md"
      printf '\n\n<issue_json>\n'
      jq -c . "$issue_file"
      printf '</issue_json>\n'
    } >"$sweep_file"
    sweep_before=$(worktree_fingerprint)
    if ! run_agent_with_retry "$sweep_file" "$artifact_dir/issue-$issue.sweep-$sweep_round.json"; then
      failure='Agent comment sweep process failed.'
    elif ! history_unchanged; then
      failure='Comment sweep changed git history instead of leaving a controller-owned diff.'
      failure_class=fatal
    elif ! verify_touch_set; then
      failure='Comment sweep changed files outside the declared touch-set.'
      failure_class=fatal
    elif [ "$sweep_before" = "$(worktree_fingerprint)" ]; then
      break
    fi
  else
    fix_round=$((fix_round + 1))
    if [ "$fix_round" -gt "$max_fix_rounds" ]; then
      failure="Deterministic make check failed after $max_fix_rounds fix rounds."
      failure_class=exhausted
      break
    fi
    fix_file="$run_dir/fix-$fix_round.md"
    {
      cat "$prompt_file"
      printf '\n\n<issue_json>\n'
      jq -c . "$issue_file"
      printf '</issue_json>\n\n<failed_check_log>\n'
      tail -n 200 "$run_dir/check.log"
      printf '\n</failed_check_log>\n'
    } >"$fix_file"
    if ! run_agent_with_retry "$fix_file" "$artifact_dir/issue-$issue.fix-$fix_round.json"; then
      failure='Agent fix process failed.'
    elif ! history_unchanged; then
      failure='Fix agent changed git history instead of leaving a controller-owned diff.'
      failure_class=fatal
    elif ! verify_touch_set; then
      failure='Fix agent changed files outside the declared touch-set.'
      failure_class=fatal
    fi
  fi
done

if [ -z "$failure" ] && ! claim_owned; then
  failure='Agent lost its distributed claim before publication.'
fi

# fence 与 heartbeat 并发：lease 被拒或传输抖动都按可重试处理，fence_claim
# 每次重读 claim 文件拿到 heartbeat 推进后的新 sha。
fence_attempt=0
fence_max=${AGENT_FENCE_ATTEMPTS:-3}
case $fence_max in *[!0-9]*|'') fence_max=3 ;; esac
while [ -z "$failure" ]; do
  fence_attempt=$((fence_attempt + 1))
  fence_claim && break
  if [ "$fence_attempt" -ge "$fence_max" ]; then
    failure='Agent could not fence its distributed claim for publication.'
    break
  fi
  sleep $((fence_attempt * 2))
done

if [ -z "$failure" ]; then
  git -C "$worktree" config user.name 'insuredesk-agent'
  git -C "$worktree" config user.email 'insuredesk-agent@users.noreply.github.com'
  git -C "$worktree" add --all
  git -C "$worktree" commit -m "agent: resolve issue #$issue"
  if git_call -C "$worktree" push --set-upstream origin HEAD; then
    published=true
  else
    failure='Agent could not push its publication branch.'
  fi
fi

if [ -z "$failure" ]; then
  branch=$(git -C "$worktree" branch --show-current)
  if ! pr=$(gh_call pr list --head "$branch" --state open --json number --jq '.[0].number'); then
    failure='Agent could not list pull requests for its publication branch.'
  elif [ -z "$pr" ]; then
    title=$(jq -r .title "$issue_file")
    body_file="$run_dir/pr-body.md"
    printf 'Closes #%s\n\nAutomated implementation; review and `make check` passed before publication.\n' "$issue" >"$body_file"
    if pr_url=$(gh_call pr create --head "$branch" --base main --title "$title (#$issue)" \
      --body-file "$body_file"); then
      pr=${pr_url##*/}
    else
      failure='Agent could not open its pull request.'
    fi
  fi
fi

if [ -z "$failure" ]; then
  gh_call pr edit "$pr" --add-label agent:automerge >/dev/null || \
    failure='Agent published but could not label its pull request.'
fi

if [ -z "$failure" ]; then
  # ready-for-agent 必须一并摘除：unlabeled 事件会触发 transition 工作流，
  # 只要 ready-for-agent 还在就会被重新入队，与 CI/merge 关单窗口形成竞态。
  # CI 失败回队由 reconcile-ci 重新补 ready-for-agent。
  gh_call issue edit "$issue" --remove-label 'agent:running,agent:repair,ready-for-agent' >/dev/null
  gh_call issue comment "$issue" --body "Agent PR #$pr published after scope, review, and full CI-equivalent checks." >/dev/null
  exit 0
fi

if [ "$published" = false ]; then
  git -C "$worktree" reset --hard "$start_head" >/dev/null
  git -C "$worktree" clean -fd >/dev/null
fi

# 进程级失败多为 transient（provider/网络/claim 竞争），自动重排队一次；
# 再失败或行为类/预算耗尽失败转 blocked 叫人。
if [ "$failure_class" = process ]; then
  comments=$(gh_call issue view "$issue" --json comments --jq '[.comments[].body | select(contains("<!-- agent-requeue:"))] | length')
  case $comments in *[!0-9]*|'') comments=1 ;; esac
  if [ "$comments" -lt 1 ]; then
    gh_call issue comment "$issue" --body "<!-- agent-requeue:1 --> $failure Requeued automatically; a second process-level failure will block." >/dev/null
    gh_call issue edit "$issue" --add-label agent:queued --remove-label agent:running >/dev/null
    exit 1
  fi
fi

gh_call issue edit "$issue" --add-label agent:blocked --remove-label 'agent:running,agent:queued' >/dev/null
gh_call issue comment "$issue" --body "$failure See .worktrees/issue-$issue.log for executor output." >/dev/null
if command -v osascript >/dev/null 2>&1; then
  osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title (item 2 of argv)' -e 'end run' -- \
    "$failure" "InsureDesk agent blocked: issue #$issue" >/dev/null 2>&1 || true
fi
exit 1
