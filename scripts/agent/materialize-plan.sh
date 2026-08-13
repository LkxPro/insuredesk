#!/bin/sh
set -eu

parent=${1:?parent issue number required}
plan_file=${2:?ticket plan path required}
agent_plan_gh=${AGENT_LOOP_GH:-gh}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$($agent_plan_gh repo view --json nameWithOwner --jq .nameWithOwner)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

node "$script_dir/plan.mjs" render "$parent" <"$plan_file" >"$tmp/rendered.json"
printf '{}\n' >"$tmp/map.json"
parent_id=$($agent_plan_gh api "repos/$repo/issues/$parent" --jq .id)
comments=$($agent_plan_gh issue view "$parent" --json comments --jq '.comments[].body')

post_edge() {
  error="$tmp/api-error"
  verify_path=$1
  expected_id=$2
  shift 2
  if ! "$@" >/dev/null 2>"$error"; then
    if ! $agent_plan_gh api "$verify_path" --paginate --jq '.[].id' | grep -Fqx "$expected_id"; then
      cat "$error" >&2
      return 1
    fi
  fi
}

jq -c '.[]' "$tmp/rendered.json" | while IFS= read -r ticket; do
  key=$(printf '%s' "$ticket" | jq -r .key)
  existing=$(printf '%s\n' "$comments" | sed -n "s/.*<!-- agent-plan:$parent:$key:\([0-9][0-9]*\) -->.*/\1/p" | head -1)
  if [ -n "$existing" ]; then
    number=$existing
    database_id=$($agent_plan_gh api "repos/$repo/issues/$number" --jq .id)
  else
    payload=$(printf '%s' "$ticket" | jq '{title, body, labels: ["agent:task"]}')
    created=$($agent_plan_gh api --method POST "repos/$repo/issues" --input - <<EOF
$payload
EOF
)
    number=$(printf '%s' "$created" | jq -r .number)
    database_id=$(printf '%s' "$created" | jq -r .id)
    $agent_plan_gh issue comment "$parent" --body "<!-- agent-plan:$parent:$key:$number --> Created #$number for plan key \`$key\`." >/dev/null
  fi
  jq --arg key "$key" --argjson number "$number" --argjson id "$database_id" \
    '. + {($key): {number: $number, id: $id}}' "$tmp/map.json" >"$tmp/map.next.json"
  mv "$tmp/map.next.json" "$tmp/map.json"
  post_edge "repos/$repo/issues/$parent/sub_issues" "$database_id" \
    "$agent_plan_gh" api --method POST "repos/$repo/issues/$parent/sub_issues" -F sub_issue_id="$database_id"
  post_edge "repos/$repo/issues/$number/dependencies/blocked_by" "$parent_id" \
    "$agent_plan_gh" api --method POST "repos/$repo/issues/$number/dependencies/blocked_by" -F issue_id="$parent_id"
done

jq -c '.[]' "$tmp/rendered.json" | while IFS= read -r ticket; do
  key=$(printf '%s' "$ticket" | jq -r .key)
  number=$(jq -r --arg key "$key" '.[$key].number' "$tmp/map.json")
  printf '%s' "$ticket" | jq -r '.dependsOn[]' | while IFS= read -r dependency; do
    blocker_id=$(jq -r --arg key "$dependency" '.[$key].id' "$tmp/map.json")
    post_edge "repos/$repo/issues/$number/dependencies/blocked_by" "$blocker_id" \
      "$agent_plan_gh" api --method POST "repos/$repo/issues/$number/dependencies/blocked_by" -F issue_id="$blocker_id"
  done
  labels='ready-for-agent,agent:queued'
  if [ "$(printf '%s' "$ticket" | jq -r .serialOnly)" = true ]; then
    labels="$labels,serial-only"
  fi
  $agent_plan_gh issue edit "$number" --add-label "$labels" --remove-label needs-triage >/dev/null
done
