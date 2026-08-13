#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

valid_body='## Goal
Outcome
## Scope
Only this change
## Declared touch-set
- apps/api/src/services/**
## Logical locks
- None
## Acceptance criteria
- [ ] Observable behaviour
## Dependencies
- None
## Test plan
- Run focused tests'
printf '%s\n' "$valid_body" | sh "$script_dir/agent-loop.sh" validate-body

form_body='### Goal
Outcome
### Scope
Only this change
### Declared touch-set
- apps/api/src/services/**
### Logical locks
- None
### Acceptance criteria
- [ ] Observable behaviour
### Dependencies
- None
### Test plan
- Run focused tests'
printf '%s\n' "$form_body" | sh "$script_dir/agent-loop.sh" validate-body

invalid_body='## Goal
Outcome
## Scope
Only this change
## Declared touch-set
- apps/api/src/services/**
## Logical locks
- None
## Acceptance criteria
- [ ] Observable behaviour
## Test plan
- Run focused tests'
if printf '%s\n' "$invalid_body" | sh "$script_dir/agent-loop.sh" validate-body >/dev/null 2>&1; then
  echo 'missing dependencies unexpectedly validated' >&2
  exit 1
fi

misplaced_checkbox='## Goal
- [ ] This does not belong here
## Scope
Only this change
## Declared touch-set
- apps/api/src/services/**
## Logical locks
- None
## Acceptance criteria
No checklist
## Dependencies
- None
## Test plan
- Run focused tests'
if printf '%s\n' "$misplaced_checkbox" | sh "$script_dir/agent-loop.sh" validate-body >/dev/null 2>&1; then
  echo 'misplaced checklist unexpectedly validated' >&2
  exit 1
fi

missing_touch_set='## Goal
Outcome
## Scope
Only this change
## Logical locks
- None
## Acceptance criteria
- [ ] Observable behaviour
## Dependencies
- None
## Test plan
- Run focused tests'
if printf '%s\n' "$missing_touch_set" | sh "$script_dir/agent-loop.sh" validate-body >/dev/null 2>&1; then
  echo 'missing touch-set unexpectedly validated' >&2
  exit 1
fi

empty_touch_set='## Goal
Outcome
## Scope
Only this change
## Declared touch-set
## Logical locks
- None
## Acceptance criteria
- [ ] Observable behaviour
## Dependencies
- None
## Test plan
- Run focused tests'
if printf '%s\n' "$empty_touch_set" | sh "$script_dir/agent-loop.sh" validate-body >/dev/null 2>&1; then
  echo 'empty touch-set unexpectedly validated' >&2
  exit 1
fi

none_touch_set=$(printf '%s\n' "$valid_body" | sed 's#- apps/api/src/services/\*\*#- None#')
if printf '%s\n' "$none_touch_set" | sh "$script_dir/agent-loop.sh" validate-body >/dev/null 2>&1; then
  echo 'None touch-set unexpectedly validated' >&2
  exit 1
fi

sh -n "$script_dir/agent-loop.sh"
sh -n "$script_dir/agent-worker.sh"

worker_dir=$(mktemp -d)
trap 'rm -rf "$worker_dir"' EXIT HUP INT TERM
mkdir -p "$worker_dir/bin" "$worker_dir/repo/.github/agent-prompts"
cp "$script_dir/../.github/agent-prompts/task.md" "$worker_dir/repo/.github/agent-prompts/task.md"
git init -q --bare "$worker_dir/remote.git"
git -C "$worker_dir/repo" init -q
git -C "$worker_dir/repo" config user.name test
git -C "$worker_dir/repo" config user.email test@example.com
printf 'base\n' >"$worker_dir/repo/base.txt"
git -C "$worker_dir/repo" add base.txt .github/agent-prompts/task.md
git -C "$worker_dir/repo" commit -qm base
git -C "$worker_dir/repo" branch -M codex/issue-7
git -C "$worker_dir/repo" remote add origin "$worker_dir/remote.git"
cat >"$worker_dir/bin/gh" <<'EOF'
#!/bin/sh
case "$*" in
  'issue view 7 --json number,title,body,comments,labels')
    printf '%s\n' '{"number":7,"title":"Test task","body":"## Goal\nTest\n## Scope\nOnly test\n## Declared touch-set\n- allowed.txt\n## Logical locks\n- None\n## Acceptance criteria\n- [ ] done\n## Dependencies\n- None\n## Test plan\n- test","comments":[],"labels":[{"name":"agent:task"}]}' ;;
  'pr list --head codex/issue-7 --state open --json number --jq .[0].number') printf '12\n' ;;
esac
EOF
cat >"$worker_dir/bin/claude" <<'EOF'
#!/bin/sh
printf '%s\n' "$PWD" >"$AGENT_LOOP_TEST_CLAUDE_CWD"
printf '%s\n' "$@" >"$AGENT_LOOP_TEST_CLAUDE_ARGS"
printf '%s\n' "$ANTHROPIC_BASE_URL" >"$AGENT_LOOP_TEST_PROVIDER_URL"
printf '%s\n' "$ANTHROPIC_AUTH_TOKEN" >"$AGENT_LOOP_TEST_PROVIDER_TOKEN"
tee "$AGENT_LOOP_TEST_CLAUDE_STDIN" >/dev/null
printf 'implemented\n' >"$PWD/allowed.txt"
printf '{"result":"done"}\n'
EOF
cat >"$worker_dir/bin/make" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$worker_dir/bin/gh" "$worker_dir/bin/claude"
chmod +x "$worker_dir/bin/make"
PATH="$worker_dir/bin:$PATH" \
  AGENT_LOOP_GH="$worker_dir/bin/gh" \
  AGENT_CLAUDE_BIN="$worker_dir/bin/claude" \
  AGENT_MODEL="custom-provider-model" \
  AGENT_REVIEW_ENABLED=0 \
  ANTHROPIC_BASE_URL="https://provider.invalid" \
  ANTHROPIC_AUTH_TOKEN="test-provider-token" \
  AGENT_LOOP_TEST_CLAUDE_CWD="$worker_dir/claude-cwd" \
  AGENT_LOOP_TEST_CLAUDE_ARGS="$worker_dir/claude-args" \
  AGENT_LOOP_TEST_CLAUDE_STDIN="$worker_dir/claude-stdin" \
  AGENT_LOOP_TEST_PROVIDER_URL="$worker_dir/provider-url" \
  AGENT_LOOP_TEST_PROVIDER_TOKEN="$worker_dir/provider-token" \
  sh "$script_dir/agent-worker.sh" 7 "$worker_dir/repo"
grep -Fqx "$worker_dir/repo" "$worker_dir/claude-cwd"
grep -Fqx -- '--model' "$worker_dir/claude-args"
grep -Fqx 'custom-provider-model' "$worker_dir/claude-args"
grep -Fqx -- '--dangerously-skip-permissions' "$worker_dir/claude-args"
grep -Fq '"number":7' "$worker_dir/claude-stdin"
grep -Fqx 'https://provider.invalid' "$worker_dir/provider-url"
grep -Fqx 'test-provider-token' "$worker_dir/provider-token"

claim_dir="$worker_dir/claim"
mkdir -p "$claim_dir/repo" "$claim_dir/artifacts"
git init -q --bare "$claim_dir/remote.git"
git -C "$claim_dir/repo" init -q
git -C "$claim_dir/repo" config user.name test
git -C "$claim_dir/repo" config user.email test@example.com
printf 'base\n' >"$claim_dir/repo/base.txt"
git -C "$claim_dir/repo" add base.txt
git -C "$claim_dir/repo" commit -qm base
git -C "$claim_dir/repo" branch -M main
git -C "$claim_dir/repo" remote add origin "$claim_dir/remote.git"
git -C "$claim_dir/repo" push -q -u origin main
(
  cd "$claim_dir/repo"
  sh "$script_dir/agent-loop.sh" claim 42 "$claim_dir/artifacts" 1
  if sh "$script_dir/agent-loop.sh" claim 42 "$claim_dir/artifacts" 1 >/dev/null 2>&1; then
    echo 'duplicate remote claim unexpectedly succeeded' >&2
    exit 1
  fi
  if sh "$script_dir/agent-loop.sh" claim 43 "$claim_dir/artifacts" 1 >/dev/null 2>&1; then
    echo 'global remote capacity slot unexpectedly overcommitted' >&2
    exit 1
  fi
  sh "$script_dir/agent-loop.sh" release-claim 42 "$claim_dir/artifacts"
  sh "$script_dir/agent-loop.sh" claim 43 "$claim_dir/artifacts" 1
  sh "$script_dir/agent-loop.sh" heartbeat-claim 43 "$claim_dir/artifacts"
  claim_sha=$(sed -n '3p' "$claim_dir/artifacts/issue-43.claim")
  if sh "$script_dir/agent-loop.sh" release-remote-claim 43 0000000000000000000000000000000000000000 >/dev/null 2>&1; then
    echo 'stale owner unexpectedly deleted a newer claim' >&2
    exit 1
  fi
  test -n "$(git ls-remote origin refs/heads/agent-claims/issue-43)"
  rm "$claim_dir/artifacts/issue-43.claim"
  AGENT_CLAIM_STALE_SECONDS=0 sh "$script_dir/agent-loop.sh" release-remote-claim 43 "$claim_sha"
  test -z "$(git ls-remote origin refs/heads/agent-claims/issue-43)"
  test -z "$(git ls-remote origin refs/heads/agent-slots/1)"
)

mkdir -p "$claim_dir/artifacts/.daemon.lock"
printf '%s\n' "$$" >"$claim_dir/artifacts/.daemon.lock/pid"
if (
  cd "$claim_dir/repo"
  AGENT_LOOP_WORKTREES="$claim_dir/artifacts" sh "$script_dir/agent-loop.sh" daemon
) >/dev/null 2>&1; then
  echo 'second daemon unexpectedly acquired singleton lock' >&2
  exit 1
fi
rm -f "$claim_dir/artifacts/.daemon.lock/pid"
rmdir "$claim_dir/artifacts/.daemon.lock"

cat >"$claim_dir/gh-transition" <<'EOF'
#!/bin/sh
case "$*" in
  'issue view 10 --json number,state,body,labels')
    printf '%s\n' '{"number":10,"state":"OPEN","body":"Confirmed spec","labels":[{"name":"agent:spec"},{"name":"ready-for-agent"}]}' ;;
  'issue edit 10 --remove-label ready-for-agent,agent:queued,agent:running,agent:task,needs-info')
    printf '%s\n' "$*" >"$TRANSITION_CAPTURE" ;;
  *) echo "unexpected gh command: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$claim_dir/gh-transition"
TRANSITION_CAPTURE="$claim_dir/transition" AGENT_LOOP_GH="$claim_dir/gh-transition" \
  sh "$script_dir/agent-loop.sh" transition 10
grep -Fqx 'issue edit 10 --remove-label ready-for-agent,agent:queued,agent:running,agent:task,needs-info' \
  "$claim_dir/transition"

git -C "$claim_dir/repo" worktree add -q -b codex/issue-11 "$claim_dir/artifacts/issue-11" main
printf '%s\n' "$$" >"$claim_dir/artifacts/issue-11.pid"
mkdir -p "$claim_dir/repo/scripts/agent"
cp "$script_dir/agent/frontier.mjs" "$claim_dir/repo/scripts/agent/frontier.mjs"
cat >"$claim_dir/gh-cleanup" <<'EOF'
#!/bin/sh
case "$*" in
  'issue view 11 --json state --jq .state') printf 'CLOSED\n' ;;
  'issue list --state open --label agent:queued --limit 100 --json number,labels') printf '[]\n' ;;
  'issue list --state open --label agent:running --limit 100 --json number,labels') printf '[]\n' ;;
  *) echo "unexpected gh command: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$claim_dir/gh-cleanup"
(
  cd "$claim_dir/repo"
  AGENT_LOOP_GH="$claim_dir/gh-cleanup" AGENT_LOOP_WORKTREES="$claim_dir/artifacts" \
    sh "$script_dir/agent-loop.sh" dispatch >/dev/null
)
test -d "$claim_dir/artifacts/issue-11"
rm -f "$claim_dir/artifacts/issue-11.pid"

commit_dir="$worker_dir/commit-rejection"
mkdir -p "$commit_dir/repo/.github/agent-prompts" "$commit_dir/bin"
cp "$script_dir/../.github/agent-prompts/task.md" "$commit_dir/repo/.github/agent-prompts/task.md"
git -C "$commit_dir/repo" init -q
git -C "$commit_dir/repo" config user.name test
git -C "$commit_dir/repo" config user.email test@example.com
printf 'base\n' >"$commit_dir/repo/base.txt"
printf '.env.*\n' >"$commit_dir/repo/.gitignore"
git -C "$commit_dir/repo" add .
git -C "$commit_dir/repo" commit -qm base
git -C "$commit_dir/repo" branch -M codex/issue-8
commit_start=$(git -C "$commit_dir/repo" rev-parse HEAD)
cat >"$commit_dir/bin/gh" <<'EOF'
#!/bin/sh
case "$*" in
  'issue view 8 --json number,title,body,comments,labels')
    printf '%s\n' '{"number":8,"title":"Commit rejection","body":"## Goal\nTest\n## Scope\nOnly test\n## Declared touch-set\n- allowed.txt\n## Logical locks\n- None\n## Acceptance criteria\n- [ ] done\n## Dependencies\n- None\n## Test plan\n- test","comments":[],"labels":[{"name":"agent:task"}]}' ;;
esac
EOF
cat >"$commit_dir/bin/claude" <<'EOF'
#!/bin/sh
printf 'model commit\n' >allowed.txt
printf 'ignored residual\n' >.env.agent-test
git add allowed.txt
git commit -qm 'model-owned commit'
printf '{"result":"done"}\n'
EOF
chmod +x "$commit_dir/bin/gh" "$commit_dir/bin/claude"
if PATH="$commit_dir/bin:$PATH" \
  AGENT_LOOP_GH="$commit_dir/bin/gh" \
  AGENT_CLAUDE_BIN="$commit_dir/bin/claude" \
  AGENT_REVIEW_ENABLED=0 \
  ANTHROPIC_BASE_URL=https://provider.invalid \
  ANTHROPIC_AUTH_TOKEN=test \
  AGENT_MODEL=test-model \
  sh "$script_dir/agent-worker.sh" 8 "$commit_dir/repo" >/dev/null 2>&1; then
  echo 'worker unexpectedly accepted a model-owned commit' >&2
  exit 1
fi
test "$(git -C "$commit_dir/repo" rev-parse HEAD)" = "$commit_start"
test ! -e "$commit_dir/repo/allowed.txt"
test ! -e "$commit_dir/repo/.env.agent-test"

fence_dir="$worker_dir/fence"
mkdir -p "$fence_dir/repo/.github/agent-prompts" "$fence_dir/bin" "$fence_dir/artifacts"
cp "$script_dir/../.github/agent-prompts/task.md" "$fence_dir/repo/.github/agent-prompts/task.md"
git init -q --bare "$fence_dir/remote.git"
git -C "$fence_dir/repo" init -q
git -C "$fence_dir/repo" config user.name test
git -C "$fence_dir/repo" config user.email test@example.com
printf 'base\n' >"$fence_dir/repo/base.txt"
git -C "$fence_dir/repo" add .
git -C "$fence_dir/repo" commit -qm base
git -C "$fence_dir/repo" branch -M codex/issue-12
git -C "$fence_dir/repo" remote add origin "$fence_dir/remote.git"
git -C "$fence_dir/repo" push -q -u origin codex/issue-12
git -C "$fence_dir/repo" push -q origin HEAD:main
(
  cd "$fence_dir/repo"
  sh "$script_dir/agent-loop.sh" claim 12 "$fence_dir/artifacts" 1
)
cat >"$fence_dir/bin/gh" <<'EOF'
#!/bin/sh
case "$*" in
  'issue view 12 --json number,title,body,comments,labels')
    printf '%s\n' '{"number":12,"title":"Fence","body":"## Goal\nTest\n## Scope\nOnly test\n## Declared touch-set\n- allowed.txt\n## Logical locks\n- None\n## Acceptance criteria\n- [ ] done\n## Dependencies\n- None\n## Test plan\n- test","comments":[],"labels":[{"name":"agent:task"}]}' ;;
  *) echo "unexpected publish command: $*" >&2; exit 1 ;;
esac
EOF
cat >"$fence_dir/bin/claude" <<'EOF'
#!/bin/sh
printf 'change\n' >allowed.txt
printf '{"result":"done"}\n'
EOF
cat >"$fence_dir/bin/make" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$fence_dir/bin/gh" "$fence_dir/bin/claude" "$fence_dir/bin/make"
git -C "$fence_dir/repo" push -q --atomic --force \
  origin HEAD:refs/heads/agent-claims/issue-12 HEAD:refs/heads/agent-slots/1
if PATH="$fence_dir/bin:$PATH" AGENT_LOOP_GH="$fence_dir/bin/gh" \
  AGENT_CLAUDE_BIN="$fence_dir/bin/claude" AGENT_REVIEW_ENABLED=0 \
  ANTHROPIC_BASE_URL=https://provider.invalid ANTHROPIC_AUTH_TOKEN=test AGENT_MODEL=test-model \
  sh "$script_dir/agent-worker.sh" 12 "$fence_dir/repo" "$fence_dir/artifacts/issue-12.claim" \
  >/dev/null 2>&1; then
  echo 'worker unexpectedly published after losing its claim' >&2
  exit 1
fi

repair_dir="$worker_dir/repair"
mkdir -p "$repair_dir/repo/.github/agent-prompts" "$repair_dir/bin"
cp "$script_dir/../.github/agent-prompts/"*.md "$repair_dir/repo/.github/agent-prompts/"
git -C "$repair_dir/repo" init -q
git -C "$repair_dir/repo" config user.name test
git -C "$repair_dir/repo" config user.email test@example.com
git -C "$repair_dir/repo" add .
git -C "$repair_dir/repo" commit -qm base
git -C "$repair_dir/repo" branch -M codex/issue-9
cat >"$repair_dir/bin/gh" <<'EOF'
#!/bin/sh
case "$*" in
  'issue view 9 --json number,title,body,comments,labels')
    printf '%s\n' '{"number":9,"title":"Task repair","body":"## Goal\nRepair\n## Scope\nTask\n## Declared touch-set\n- allowed.txt\n## Logical locks\n- None\n## Acceptance criteria\n- [ ] fixed\n## Dependencies\n- None\n## Test plan\n- test","comments":[],"labels":[{"name":"agent:task"},{"name":"agent:repair"}]}' ;;
  'run list --branch codex/issue-9 --status failure --limit 1 --json databaseId --jq .[0].databaseId') printf '88\n' ;;
  'run view 88 --log-failed') printf 'FAILED-CI-DIAGNOSTIC\n' ;;
esac
EOF
cat >"$repair_dir/bin/capture-adapter" <<'EOF'
#!/bin/sh
cp "$AGENT_TASK_FILE" "$REPAIR_CAPTURE"
exit 1
EOF
chmod +x "$repair_dir/bin/gh" "$repair_dir/bin/capture-adapter"
if PATH="$repair_dir/bin:$PATH" \
  AGENT_LOOP_GH="$repair_dir/bin/gh" \
  AGENT_EXECUTOR_ADAPTER="$repair_dir/bin/capture-adapter" \
  REPAIR_CAPTURE="$repair_dir/task.md" \
  sh "$script_dir/agent-worker.sh" 9 "$repair_dir/repo" >/dev/null 2>&1; then
  echo 'failing repair adapter unexpectedly succeeded' >&2
  exit 1
fi
grep -Fq 'existing agent PR failed CI' "$repair_dir/task.md"
grep -Fq 'FAILED-CI-DIAGNOSTIC' "$repair_dir/task.md"
