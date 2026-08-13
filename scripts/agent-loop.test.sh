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
