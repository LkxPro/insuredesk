#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/bin" "$tmp/state"
git init -q --bare "$tmp/lock-remote.git"
git -C "$tmp" init -q lock-repo
git -C "$tmp/lock-repo" config user.name test
git -C "$tmp/lock-repo" config user.email test@example.com
printf 'base\n' >"$tmp/lock-repo/base.txt"
git -C "$tmp/lock-repo" add base.txt
git -C "$tmp/lock-repo" commit -qm base
git -C "$tmp/lock-repo" branch -M main
git -C "$tmp/lock-repo" remote add origin "$tmp/lock-remote.git"
git -C "$tmp/lock-repo" push -q -u origin main

cat >"$tmp/spec.md" <<'EOF'
## Problem Statement
Operators need an outcome.
## Solution
Deliver it.
## User Stories
1. As an operator, I want the outcome.
## Implementation Decisions
- Preserve the contract.
## Testing Decisions
- Verify behavior.
## Out of Scope
- Unrelated work.
## Further Notes
- None.
EOF

cat >"$tmp/bin/gh-spec" <<'EOF'
#!/bin/sh
case "$*" in
  'repo view --json nameWithOwner --jq .nameWithOwner') printf '%s\n' 'LkxPro/insuredesk' ;;
  api\ repos/LkxPro/insuredesk/issues?state=all\&labels=agent%3Aspec\&per_page=100\ --paginate\ --jq\ *)
    if [ -f "$PUBLISH_CAPTURE/spec-body" ]; then
      printf '%s\n' 'https://github.com/LkxPro/insuredesk/issues/100'
    fi ;;
  issue\ create\ --title\ *\ --body-file\ *\ --label\ agent:spec)
    [ ! -f "$PUBLISH_CAPTURE/spec-created" ] || { echo duplicate >&2; exit 1; }
    : >"$PUBLISH_CAPTURE/spec-created"
    printf '%s\n' "$*" >"$PUBLISH_CAPTURE/spec-command"
    body_file=$(printf '%s\n' "$*" | sed -n 's/.*--body-file \([^ ]*\) --label.*/\1/p')
    cp "$body_file" "$PUBLISH_CAPTURE/spec-body"
    printf '%s\n' 'https://github.com/LkxPro/insuredesk/issues/100' ;;
  *) echo "unexpected spec command: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/gh-spec"
PUBLISH_CAPTURE="$tmp/state" AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" AGENT_LOOP_GH="$tmp/bin/gh-spec" \
  sh "$script_dir/publish-spec.sh" 'Spec: Operator outcome' "$tmp/spec.md" >"$tmp/spec-url"
grep -Fqx 'https://github.com/LkxPro/insuredesk/issues/100' "$tmp/spec-url"
grep -Fq 'issue create --title Spec: Operator outcome' "$tmp/state/spec-command"
grep -Fq '<!-- agent-spec:' "$tmp/state/spec-body"
grep -Fq '## Testing Decisions' "$tmp/state/spec-body"
PUBLISH_CAPTURE="$tmp/state" AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" AGENT_LOOP_GH="$tmp/bin/gh-spec" \
  sh "$script_dir/publish-spec.sh" 'Spec: Operator outcome' "$tmp/spec.md" >"$tmp/spec-url-rerun"
grep -Fqx 'https://github.com/LkxPro/insuredesk/issues/100' "$tmp/spec-url-rerun"

lock_file="$tmp/state/lock"
AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" AGENT_PUBLISH_LOCK_STALE_SECONDS=4 \
  AGENT_PUBLISH_HEARTBEAT_INTERVAL=1 AGENT_PUBLISH_REQUEST_TIMEOUT_SECONDS=1 \
  sh "$script_dir/publication-lock.sh" acquire test same "$lock_file"
sleep 4
AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" sh "$script_dir/publication-lock.sh" heartbeat test same "$lock_file"
AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" sh "$script_dir/publication-lock.sh" verify test same "$lock_file"
if AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" AGENT_PUBLISH_LOCK_WAIT_SECONDS=0 \
  AGENT_PUBLISH_LOCK_STALE_SECONDS=4 AGENT_PUBLISH_HEARTBEAT_INTERVAL=1 \
  AGENT_PUBLISH_REQUEST_TIMEOUT_SECONDS=1 \
  sh "$script_dir/publication-lock.sh" acquire test same "$tmp/state/contender" >/dev/null 2>&1; then
  echo 'concurrent publication lock unexpectedly succeeded' >&2
  exit 1
fi
AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" sh "$script_dir/publication-lock.sh" release test same "$lock_file"

cat >"$tmp/bin/slow-gh" <<'EOF'
#!/bin/sh
sleep 5
EOF
chmod +x "$tmp/bin/slow-gh"
started=$(date +%s)
if AGENT_PUBLISH_REQUEST_TIMEOUT_SECONDS=1 sh "$script_dir/github-call.sh" "$tmp/bin/slow-gh"; then
  echo 'slow GitHub call unexpectedly succeeded' >&2
  exit 1
fi
[ $(($(date +%s) - started)) -lt 5 ]

guard_lock="$tmp/state/guard-lock"
AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" sh "$script_dir/publication-lock.sh" acquire guard loss "$guard_lock"
(
  trap 'exit 143' TERM
  while :; do sleep 1; done
) & guarded_owner=$!
AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" AGENT_PUBLISH_HEARTBEAT_INTERVAL=1 \
  sh "$script_dir/publication-guard.sh" guard loss "$guard_lock" "$guarded_owner" & guard_pid=$!
git -C "$tmp/lock-repo" push -q --force origin HEAD:refs/heads/agent-publish-locks/guard-loss
wait "$guard_pid" || true
if kill -0 "$guarded_owner" 2>/dev/null; then
  echo 'guarded publisher survived lease loss' >&2
  kill -KILL "$guarded_owner" 2>/dev/null || true
  exit 1
fi

cat >"$tmp/plan.json" <<'EOF'
{
  "tickets": [
    {
      "key": "first",
      "title": "First slice",
      "goal": "Deliver the first slice",
      "acceptanceCriteria": ["First behavior works"],
      "outOfScope": ["Second behavior"],
      "touchSet": ["apps/api/src/first/**"],
      "logicalLocks": ["shared-contract"],
      "testPlan": ["Run first test"],
      "dependsOn": [],
      "serialOnly": false
    },
    {
      "key": "second",
      "title": "Second slice",
      "goal": "Deliver the second slice",
      "acceptanceCriteria": ["Second behavior works"],
      "outOfScope": ["Unrelated behavior"],
      "touchSet": ["apps/api/src/second/**"],
      "logicalLocks": ["shared-contract"],
      "testPlan": ["Run second test"],
      "dependsOn": ["first"],
      "serialOnly": false
    }
  ]
}
EOF

cat >"$tmp/bin/gh-tickets" <<'EOF'
#!/bin/sh
case "$*" in
  'repo view --json nameWithOwner --jq .nameWithOwner') printf '%s\n' 'LkxPro/insuredesk' ;;
  'issue view 100 --json state,labels,comments')
    printf '%s\n' '{"state":"OPEN","labels":[{"name":"agent:spec"}],"comments":[]}' ;;
  'api repos/LkxPro/insuredesk/issues?state=all&labels=agent%3Atask&per_page=100 --paginate')
    jq -n \
      --rawfile first "$PUBLISH_CAPTURE/body-101.md" \
      --rawfile second "$PUBLISH_CAPTURE/body-102.md" \
      '[{number: 101, id: 1101, body: $first}, {number: 102, id: 1102, body: $second}]' \
      2>/dev/null || printf '[]\n' ;;
  'api repos/LkxPro/insuredesk/issues/101 --jq .id') printf '1101\n' ;;
  'api repos/LkxPro/insuredesk/issues/102 --jq .id') printf '1102\n' ;;
  'api --method POST repos/LkxPro/insuredesk/issues --input -')
    count_file="$PUBLISH_CAPTURE/count"
    count=100
    [ ! -f "$count_file" ] || count=$(cat "$count_file")
    count=$((count + 1))
    printf '%s\n' "$count" >"$count_file"
    tee "$PUBLISH_CAPTURE/create-$count.json" >/dev/null
    printf '{"number":%s,"id":%s}\n' "$count" "$((1000 + count))" ;;
  issue\ comment\ 100\ --body\ *)
    printf '%s\n' "$*" >>"$PUBLISH_CAPTURE/comments" ;;
  api\ --method\ POST\ repos/LkxPro/insuredesk/issues/100/sub_issues\ -F\ sub_issue_id=*)
    printf '%s\n' "$*" >>"$PUBLISH_CAPTURE/sub-issues" ;;
  'issue edit 101 --body-file '*|'issue edit 102 --body-file '*)
    number=$(printf '%s\n' "$*" | awk '{print $3}')
    body_file=$(printf '%s\n' "$*" | awk '{print $5}')
    cp "$body_file" "$PUBLISH_CAPTURE/body-$number.md" ;;
  'api --method POST repos/LkxPro/insuredesk/issues/102/dependencies/blocked_by -F issue_id=1101')
    printf '%s\n' "$*" >>"$PUBLISH_CAPTURE/dependencies" ;;
  issue\ edit\ 101\ --add-label\ *|issue\ edit\ 102\ --add-label\ *)
    printf '%s\n' "$*" >>"$PUBLISH_CAPTURE/labels" ;;
  *) echo "unexpected tickets command: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/gh-tickets"
PUBLISH_CAPTURE="$tmp/state" AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" AGENT_LOOP_GH="$tmp/bin/gh-tickets" \
  sh "$script_dir/publish-tickets.sh" 100 "$tmp/plan.json" >"$tmp/map.json"

jq -e '.first == 101 and .second == 102' "$tmp/map.json" >/dev/null
jq -e '.labels == ["agent:task"]' "$tmp/state/create-101.json" >/dev/null
grep -Fq 'Part of #100.' "$tmp/state/body-101.md"
for heading in Goal Scope 'Declared touch-set' 'Logical locks' 'Acceptance criteria' Dependencies 'Test plan'; do
  grep -Fq "## $heading" "$tmp/state/body-101.md"
done
grep -Fq '#101 (plan key: `first`)' "$tmp/state/body-102.md"
grep -Fqx 'api --method POST repos/LkxPro/insuredesk/issues/102/dependencies/blocked_by -F issue_id=1101' \
  "$tmp/state/dependencies"
[ "$(wc -l <"$tmp/state/sub-issues" | tr -d ' ')" = 2 ]
[ "$(grep -Fc 'ready-for-agent,agent:queued' "$tmp/state/labels")" = 2 ]
PUBLISH_CAPTURE="$tmp/state" AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" AGENT_LOOP_GH="$tmp/bin/gh-tickets" \
  sh "$script_dir/publish-tickets.sh" 100 "$tmp/plan.json" >"$tmp/map-rerun.json"
jq -e '.first == 101 and .second == 102' "$tmp/map-rerun.json" >/dev/null
[ "$(cat "$tmp/state/count")" = 102 ]

cat >"$tmp/plan-solo.json" <<'EOF'
{
  "tickets": [
    {
      "key": "solo-fix",
      "title": "Solo fix",
      "goal": "Deliver the solo fix",
      "acceptanceCriteria": ["Solo behavior works"],
      "outOfScope": ["Unrelated behavior"],
      "touchSet": ["apps/api/src/solo/**"],
      "logicalLocks": [],
      "testPlan": ["Run solo test"],
      "dependsOn": [],
      "serialOnly": false
    }
  ]
}
EOF

cat >"$tmp/bin/gh-parentless" <<'EOF'
#!/bin/sh
case "$*" in
  'repo view --json nameWithOwner --jq .nameWithOwner') printf '%s\n' 'LkxPro/insuredesk' ;;
  'api repos/LkxPro/insuredesk/issues?state=all&labels=agent%3Atask&per_page=100 --paginate')
    jq -n --rawfile solo "$PUBLISH_CAPTURE/body-201.md" \
      '[{number: 201, id: 1201, body: $solo}]' 2>/dev/null || printf '[]\n' ;;
  'api repos/LkxPro/insuredesk/issues/201 --jq .id') printf '1201\n' ;;
  'api --method POST repos/LkxPro/insuredesk/issues --input -')
    [ ! -f "$PUBLISH_CAPTURE/parentless-created" ] || { echo 'duplicate parentless create' >&2; exit 1; }
    : >"$PUBLISH_CAPTURE/parentless-created"
    tee "$PUBLISH_CAPTURE/create-201.json" >/dev/null
    printf '{"number":201,"id":1201}\n' ;;
  'issue edit 201 --body-file '*)
    body_file=$(printf '%s\n' "$*" | awk '{print $5}')
    cp "$body_file" "$PUBLISH_CAPTURE/body-201.md" ;;
  'issue edit 201 --add-label '*)
    printf '%s\n' "$*" >>"$PUBLISH_CAPTURE/parentless-labels" ;;
  *) echo "parentless publish touched an unexpected surface: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/gh-parentless"
PUBLISH_CAPTURE="$tmp/state" AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" AGENT_LOOP_GH="$tmp/bin/gh-parentless" \
  sh "$script_dir/publish-tickets.sh" 0 "$tmp/plan-solo.json" >"$tmp/map-parentless.json"
jq -e '.["solo-fix"] == 201' "$tmp/map-parentless.json" >/dev/null
jq -e '.labels == ["agent:task"]' "$tmp/state/create-201.json" >/dev/null
grep -Fq '<!-- agent-plan:0:solo-fix -->' "$tmp/state/body-201.md"
if grep -Fq 'Part of #' "$tmp/state/body-201.md"; then
  echo 'parentless body unexpectedly references a parent' >&2
  exit 1
fi
grep -Fq 'ready-for-agent,agent:queued' "$tmp/state/parentless-labels"
PUBLISH_CAPTURE="$tmp/state" AGENT_PUBLISH_GIT_DIR="$tmp/lock-repo" AGENT_LOOP_GH="$tmp/bin/gh-parentless" \
  sh "$script_dir/publish-tickets.sh" 0 "$tmp/plan-solo.json" >"$tmp/map-parentless-rerun.json"
jq -e '.["solo-fix"] == 201' "$tmp/map-parentless-rerun.json" >/dev/null
