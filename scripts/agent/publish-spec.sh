#!/bin/sh
set -eu

title=${1:?spec title required}
spec_file=${2:?spec Markdown path required}
agent_publish_gh=${AGENT_LOOP_GH:-gh}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

[ -f "$spec_file" ] || { echo "spec file not found: $spec_file" >&2; exit 66; }
for heading in 'Problem Statement' Solution 'User Stories' 'Implementation Decisions' \
  'Testing Decisions' 'Out of Scope' 'Further Notes'; do
  if ! grep -Eq "^#{2,3} $heading$" "$spec_file"; then
    echo "missing required spec heading: $heading" >&2
    exit 65
  fi
done

key=$(git hash-object "$spec_file")
marker="<!-- agent-spec:$key -->"
lock_file=$(mktemp)
tmp=$(mktemp)
guard=''
cleanup() {
  if [ -n "$guard" ]; then
    kill "$guard" 2>/dev/null || true
    wait "$guard" 2>/dev/null || true
  fi
  sh "$script_dir/publication-lock.sh" release spec "$key" "$lock_file"
  rm -f "$lock_file" "$tmp"
}
abort() {
  trap - HUP INT TERM
  cleanup
  exit 143
}
trap cleanup EXIT
trap abort HUP INT TERM
rm -f "$lock_file"
sh "$script_dir/publication-lock.sh" acquire spec "$key" "$lock_file"
sh "$script_dir/publication-guard.sh" spec "$key" "$lock_file" "$$" & guard=$!

gh_call() {
  sh "$script_dir/publication-lock.sh" verify spec "$key" "$lock_file"
  sh "$script_dir/github-call.sh" "$agent_publish_gh" "$@"
}

repo=$(gh_call repo view --json nameWithOwner --jq .nameWithOwner)
existing=$(gh_call api "repos/$repo/issues?state=all&labels=agent%3Aspec&per_page=100" \
  --paginate --jq ".[] | select(.body != null and (.body | contains(\"$marker\"))) | .html_url" | head -1)
if [ -n "$existing" ]; then
  printf '%s\n' "$existing"
  exit 0
fi

{
  printf '%s\n\n' "$marker"
  cat "$spec_file"
} >"$tmp"
sh "$script_dir/publication-lock.sh" verify spec "$key" "$lock_file"
gh_call issue create --title "$title" --body-file "$tmp" --label agent:spec
