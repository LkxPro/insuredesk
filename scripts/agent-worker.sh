#!/bin/sh
set -eu

issue=${1:?issue number required}
worktree=${2:?worktree required}
claim_file=${3:-}
publish_marker=${4:-}
root=$(git -C "$worktree" rev-parse --show-toplevel)
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
agent_worker_gh=${AGENT_LOOP_GH:-gh}
run_dir=$(mktemp -d)
restore_head=''
published=false
ignored_snapshot="$run_dir/ignored-before"
ignored_after="$run_dir/ignored-after"
ignored_created="$run_dir/ignored-created"
git -C "$worktree" ls-files --others --ignored --exclude-standard | sort >"$ignored_snapshot"
cleanup() {
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
  trap - HUP INT TERM
  cleanup
  exit 143
}
trap cleanup EXIT
trap abort HUP INT TERM
mkdir -p "$run_dir/gh" "$run_dir/home" "$run_dir/config"

claim_owned() {
  [ -z "$claim_file" ] && return 0
  [ -f "$claim_file" ] || return 1
  claim_ref=$(sed -n '1p' "$claim_file")
  slot_ref=$(sed -n '2p' "$claim_file")
  expected=$(sed -n '3p' "$claim_file")
  current=$(git -C "$worktree" ls-remote origin "$claim_ref" | awk 'NR == 1 {print $1}')
  slot_current=$(git -C "$worktree" ls-remote origin "$slot_ref" | awk 'NR == 1 {print $1}')
  [ -n "$expected" ] && [ "$current" = "$expected" ] && [ "$slot_current" = "$expected" ]
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
  git -C "$worktree" push --atomic \
    --force-with-lease="$claim_ref:$expected" --force-with-lease="$slot_ref:$expected" \
    origin "$fenced:$claim_ref" "$fenced:$slot_ref" >/dev/null || return 1
  sed -i.bak "3s/.*/$fenced/" "$claim_file"
  rm -f "$claim_file.bak"
}

issue_file="$run_dir/issue.json"
$agent_worker_gh issue view "$issue" --json number,title,body,comments,labels >"$issue_file"
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
  failed_run=$($agent_worker_gh run list --branch "$branch" --status failure --limit 1 \
    --json databaseId --jq '.[0].databaseId')
  if [ -n "$failed_run" ]; then
    repair_context=$run_dir/failed-ci.log
    $agent_worker_gh run view "$failed_run" --log-failed >"$repair_context" 2>&1 || true
  fi
fi

run_agent() {
  prompt=$1
  output=$2
  HOME="$run_dir/home" XDG_CONFIG_HOME="$run_dir/config" GIT_CONFIG_GLOBAL=/dev/null \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url \
    GIT_CONFIG_VALUE_0=disabled://agent-model-has-no-publish-authority \
    GH_CONFIG_DIR="$run_dir/gh" GH_TOKEN='' GITHUB_TOKEN='' SSH_AUTH_SOCK='' \
    AGENT_WORKTREE="$worktree" \
    AGENT_TASK_FILE="$prompt" \
    AGENT_OUTPUT_FILE="$output" \
    "$script_dir/agent/run-executor.sh"
}

task_file="$run_dir/task.md"
artifact_dir=$(dirname "$worktree")
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
if ! run_agent "$task_file" "$implementation_result"; then
  failure='Agent implementation process failed.'
elif [ "$(git -C "$worktree" rev-parse HEAD)" != "$start_head" ]; then
  failure='Agent changed git history instead of leaving a controller-owned diff.'
else
  failure=''
fi

if [ -z "$failure" ] && [ "${AGENT_REVIEW_ENABLED:-1}" = 1 ]; then
  review_file="$run_dir/review.md"
  {
    cat "$root/.github/agent-prompts/review.md"
    printf '\n\n<issue_json>\n'
    jq -c . "$issue_file"
    printf '</issue_json>\n'
  } >"$review_file"
  if ! run_agent "$review_file" "$review_result"; then
    failure='Agent review process failed.'
  elif [ "$(git -C "$worktree" rev-parse HEAD)" != "$start_head" ]; then
    failure='Review agent changed git history instead of leaving a controller-owned diff.'
  fi
fi

changed=$(git -C "$worktree" ls-files --modified --others --exclude-standard)
if [ -z "$failure" ] && [ -z "$changed" ]; then
  failure='Agent produced no repository change.'
fi

if [ -z "$failure" ]; then
  if ! { jq -c . "$issue_file"; printf '%s\n' "$changed"; } | node "$script_dir/agent/verify-touch-set.mjs"; then
    failure='Agent changed files outside the declared touch-set.'
  fi
fi

if [ -z "$failure" ] && ! make -C "$worktree" check; then
  failure='Deterministic make check failed.'
fi

if [ -z "$failure" ] && ! claim_owned; then
  failure='Agent lost its distributed claim before publication.'
fi

if [ -z "$failure" ] && ! fence_claim; then
  failure='Agent could not fence its distributed claim for publication.'
fi

if [ -z "$failure" ]; then
  git -C "$worktree" config user.name 'insuredesk-agent'
  git -C "$worktree" config user.email 'insuredesk-agent@users.noreply.github.com'
  git -C "$worktree" add --all
  git -C "$worktree" commit -m "agent: resolve issue #$issue"
  git -C "$worktree" push --set-upstream origin HEAD
  published=true
fi

if [ -z "$failure" ]; then
  branch=$(git -C "$worktree" branch --show-current)
  pr=$($agent_worker_gh pr list --head "$branch" --state open --json number --jq '.[0].number')
  if [ -z "$pr" ]; then
    title=$(jq -r .title "$issue_file")
    body_file="$run_dir/pr-body.md"
    printf 'Closes #%s\n\nAutomated implementation; review and `make check` passed before publication.\n' "$issue" >"$body_file"
    pr_url=$($agent_worker_gh pr create --head "$branch" --base main --title "$title (#$issue)" \
      --body-file "$body_file")
    pr=${pr_url##*/}
  fi
  $agent_worker_gh pr edit "$pr" --add-label agent:automerge >/dev/null

  $agent_worker_gh issue edit "$issue" --remove-label 'agent:running,agent:repair' >/dev/null
  $agent_worker_gh issue comment "$issue" --body "Agent PR #$pr published after scope, review, and full CI-equivalent checks." >/dev/null
  exit 0
fi

if [ "$published" = false ]; then
  git -C "$worktree" reset --hard "$start_head" >/dev/null
  git -C "$worktree" clean -fd >/dev/null
fi
$agent_worker_gh issue edit "$issue" --add-label agent:blocked --remove-label 'agent:running,agent:queued' >/dev/null
$agent_worker_gh issue comment "$issue" --body "$failure See .worktrees/issue-$issue.log for executor output." >/dev/null
exit 1
