#!/bin/sh
set -eu

parent=${1:?parent spec issue number required (0 for parentless)}
plan_file=${2:?structured ticket plan path required}
case $parent in *[!0-9]*|'') echo 'parent must be an issue number or 0 for parentless' >&2; exit 64;; esac
# 无 parent 时用 plan 内容哈希当锁 key：同 plan 重跑串行化，不同 plan 互不阻塞。
if [ "$parent" -gt 0 ]; then
  lock_key=$parent
else
  lock_key="plan-$(git hash-object "$plan_file")"
fi
agent_publish_gh=${AGENT_LOOP_GH:-gh}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d)
lock_file="$tmp/publication.lock"
guard=''
cleanup() {
  if [ -n "$guard" ]; then
    kill "$guard" 2>/dev/null || true
    wait "$guard" 2>/dev/null || true
  fi
  sh "$script_dir/publication-lock.sh" release tickets "$lock_key" "$lock_file"
  rm -rf "$tmp"
}
abort() {
  trap - HUP INT TERM
  cleanup
  exit 143
}
trap cleanup EXIT
trap abort HUP INT TERM
sh "$script_dir/publication-lock.sh" acquire tickets "$lock_key" "$lock_file"
sh "$script_dir/publication-guard.sh" tickets "$lock_key" "$lock_file" "$$" & guard=$!

gh_call() {
  sh "$script_dir/publication-lock.sh" verify tickets "$lock_key" "$lock_file"
  sh "$script_dir/github-call.sh" "$agent_publish_gh" "$@"
}

repo=$(gh_call repo view --json nameWithOwner --jq .nameWithOwner)

comments=''
if [ "$parent" -gt 0 ]; then
  parent_json=$(gh_call issue view "$parent" --json state,labels,comments)
  if [ "$(printf '%s' "$parent_json" | jq -r .state)" != OPEN ] || \
    ! printf '%s' "$parent_json" | jq -e 'any(.labels[]; .name == "agent:spec")' >/dev/null; then
    echo "parent #$parent must be an open agent:spec issue" >&2
    exit 65
  fi
  comments=$(printf '%s' "$parent_json" | jq -r '.comments[].body')
fi

node "$script_dir/plan.mjs" render "$parent" <"$plan_file" >"$tmp/rendered.json"

# spec 分支是子票 PR 的 base,必须先于任何子票落库;建支失败即中止,lease 释放后重跑幂等。
if [ "$parent" -gt 0 ]; then
  main_sha=$(gh_call api "repos/$repo/git/ref/heads/main" --jq .object.sha)
  if ! gh_call api --method POST "repos/$repo/git/refs" \
    -F "ref=refs/heads/agent/spec-$parent" -F "sha=$main_sha" >/dev/null 2>"$tmp/branch-error"; then
    # 重发/并发下分支已存在不算失败;确认 ref 真实存在才放行,否则中止。
    if ! gh_call api "repos/$repo/git/ref/heads/agent/spec-$parent" --jq .object.sha >/dev/null 2>&1; then
      cat "$tmp/branch-error" >&2
      exit 1
    fi
  fi
fi

printf '{}\n' >"$tmp/map.json"
all_tasks=$(gh_call api "repos/$repo/issues?state=all&labels=agent%3Atask&per_page=100" --paginate)

post_edge() {
  error="$tmp/api-error"
  verify_path=$1
  expected_id=$2
  shift 2
  if ! "$@" >/dev/null 2>"$error"; then
    if ! gh_call api "$verify_path" --paginate --jq '.[].id' | grep -Fqx "$expected_id"; then
      cat "$error" >&2
      return 1
    fi
  fi
}

jq -c '.[]' "$tmp/rendered.json" | while IFS= read -r ticket; do
  key=$(printf '%s' "$ticket" | jq -r .key)
  existing=$(printf '%s\n' "$comments" | sed -n "s/.*<!-- agent-plan:$parent:$key:\([0-9][0-9]*\) -->.*/\1/p" | head -1)
  if [ -z "$existing" ]; then
    existing=$(printf '%s' "$all_tasks" | jq -r --arg marker "<!-- agent-plan:$parent:$key -->" \
      '.[] | select(.body != null and (.body | contains($marker))) | .number' | head -1)
  fi
  if [ -n "$existing" ]; then
    number=$existing
    database_id=$(gh_call api "repos/$repo/issues/$number" --jq .id)
  else
    payload=$(printf '%s' "$ticket" | jq '{title, body, labels: ["agent:task"]}')
    sh "$script_dir/publication-lock.sh" verify tickets "$lock_key" "$lock_file"
    created=$(gh_call api --method POST "repos/$repo/issues" --input - <<EOF
$payload
EOF
)
    number=$(printf '%s' "$created" | jq -r .number)
    database_id=$(printf '%s' "$created" | jq -r .id)
    if [ "$parent" -gt 0 ]; then
      sh "$script_dir/publication-lock.sh" verify tickets "$lock_key" "$lock_file"
      gh_call issue comment "$parent" --body "<!-- agent-plan:$parent:$key:$number --> Created #$number for plan key \`$key\`." >/dev/null
    fi
  fi
  jq --arg key "$key" --argjson number "$number" --argjson id "$database_id" \
    '. + {($key): {number: $number, id: $id}}' "$tmp/map.json" >"$tmp/map.next.json"
  mv "$tmp/map.next.json" "$tmp/map.json"
  if [ "$parent" -gt 0 ]; then
    sh "$script_dir/publication-lock.sh" verify tickets "$lock_key" "$lock_file"
    post_edge "repos/$repo/issues/$parent/sub_issues" "$database_id" \
      gh_call api --method POST "repos/$repo/issues/$parent/sub_issues" -F sub_issue_id="$database_id"
  fi
done

jq 'with_entries(.value = .value.number)' "$tmp/map.json" >"$tmp/numbers.json"
node "$script_dir/plan.mjs" render "$parent" "$tmp/numbers.json" <"$plan_file" >"$tmp/rendered.json"

jq -c '.[]' "$tmp/rendered.json" | while IFS= read -r ticket; do
  key=$(printf '%s' "$ticket" | jq -r .key)
  number=$(jq -r --arg key "$key" '.[$key].number' "$tmp/map.json")
  printf '%s' "$ticket" | jq -r .body >"$tmp/body-$number.md"
  sh "$script_dir/publication-lock.sh" verify tickets "$lock_key" "$lock_file"
  gh_call issue edit "$number" --body-file "$tmp/body-$number.md" >/dev/null
  printf '%s' "$ticket" | jq -r '.dependsOn[]' | while IFS= read -r dependency; do
    blocker_id=$(jq -r --arg key "$dependency" '.[$key].id' "$tmp/map.json")
    sh "$script_dir/publication-lock.sh" verify tickets "$lock_key" "$lock_file"
    post_edge "repos/$repo/issues/$number/dependencies/blocked_by" "$blocker_id" \
      gh_call api --method POST "repos/$repo/issues/$number/dependencies/blocked_by" -F issue_id="$blocker_id"
  done
done

jq -c '.[]' "$tmp/rendered.json" | while IFS= read -r ticket; do
  key=$(printf '%s' "$ticket" | jq -r .key)
  number=$(jq -r --arg key "$key" '.[$key].number' "$tmp/map.json")
  labels='ready-for-agent,agent:queued'
  if [ "$(printf '%s' "$ticket" | jq -r .serialOnly)" = true ]; then
    labels="$labels,serial-only"
  fi
  sh "$script_dir/publication-lock.sh" verify tickets "$lock_key" "$lock_file"
  gh_call issue edit "$number" --add-label "$labels" --remove-label needs-triage >/dev/null
done

jq 'with_entries(.value = .value.number)' "$tmp/map.json"
