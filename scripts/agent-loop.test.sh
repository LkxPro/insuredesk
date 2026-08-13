#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

valid_body='## Goal
Outcome
## Scope
Only this change
## Acceptance criteria
- [ ] Observable behaviour
## Dependencies
- None'
printf '%s\n' "$valid_body" | sh "$script_dir/agent-loop.sh" validate-body

form_body='### Goal
Outcome
### Scope
Only this change
### Acceptance criteria
- [ ] Observable behaviour
### Dependencies
- None'
printf '%s\n' "$form_body" | sh "$script_dir/agent-loop.sh" validate-body

invalid_body='## Goal
Outcome
## Scope
Only this change
## Acceptance criteria
- [ ] Observable behaviour'
if printf '%s\n' "$invalid_body" | sh "$script_dir/agent-loop.sh" validate-body >/dev/null 2>&1; then
  echo 'missing dependencies unexpectedly validated' >&2
  exit 1
fi

misplaced_checkbox='## Goal
- [ ] This does not belong here
## Scope
Only this change
## Acceptance criteria
No checklist
## Dependencies
- None'
if printf '%s\n' "$misplaced_checkbox" | sh "$script_dir/agent-loop.sh" validate-body >/dev/null 2>&1; then
  echo 'misplaced checklist unexpectedly validated' >&2
  exit 1
fi

sh -n "$script_dir/agent-loop.sh"
sh -n "$script_dir/agent-worker.sh"

worker_dir=$(mktemp -d)
trap 'rm -rf "$worker_dir"' EXIT HUP INT TERM
mkdir -p "$worker_dir/bin" "$worker_dir/repo/.github/agent-prompts"
cp "$script_dir/../.github/agent-prompts/task.md" "$worker_dir/repo/.github/agent-prompts/task.md"
git -C "$worker_dir/repo" init -q
cat >"$worker_dir/bin/gh" <<'EOF'
#!/bin/sh
case "$*" in
  'issue view 7 --json labels --jq .labels[].name') printf 'agent:task\n' ;;
  'issue view 7 --json state --jq .state') printf 'CLOSED\n' ;;
esac
EOF
cat >"$worker_dir/bin/codex" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >"$AGENT_LOOP_TEST_CODEX_ARGS"
EOF
chmod +x "$worker_dir/bin/gh" "$worker_dir/bin/codex"
AGENT_LOOP_GH="$worker_dir/bin/gh" AGENT_LOOP_CODEX="$worker_dir/bin/codex" AGENT_LOOP_TEST_CODEX_ARGS="$worker_dir/codex-args" sh "$script_dir/agent-worker.sh" 7 "$worker_dir/repo"
grep -Fq 'Issue: #7.' "$worker_dir/codex-args"
