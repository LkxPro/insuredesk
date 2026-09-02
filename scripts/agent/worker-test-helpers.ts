import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
export const ISSUE_BODY =
  "## Goal\nTest\n## Scope\nOnly test\n## Declared touch-set\n- allowed.txt\n## Logical locks\n- None\n## Acceptance criteria\n- [ ] done\n## Dependencies\n- None\n## Test plan\n- test";

export interface Sandbox {
  dir: string;
  repo: string;
  origin: string;
  bin: string;
  worktrees: string;
}

export async function git(cwd: string, args: string[]) {
  return (await run("git", ["-C", cwd, ...args])).stdout.trim();
}

export async function writeShim(dir: string, name: string, body: string) {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await run("chmod", ["+x", path]);
}

async function setupSandbox(
  claudeBody: string,
  makeBody: string,
  specParent?: number,
): Promise<Sandbox> {
  const dir = await mkdtemp(join(tmpdir(), "worker-test-"));
  const repo = join(dir, "repo");
  const origin = join(dir, "origin.git");
  const bin = join(dir, "bin");
  const worktrees = dir;
  await mkdir(join(repo, ".github", "agent-prompts"), { recursive: true });
  await mkdir(bin);
  for (const prompt of ["task.md", "review.md", "comment-sweep.md", "repair.md", "stuck-nudge.md"])
    await cp(
      join(REPO_ROOT, ".github", "agent-prompts", prompt),
      join(repo, ".github", "agent-prompts", prompt),
    );
  await run("git", ["init", "--bare", "-q", origin]);
  await run("git", ["init", "-q", repo]);
  await git(repo, ["config", "user.name", "test"]);
  await git(repo, ["config", "user.email", "test@test"]);
  await writeFile(join(repo, "base.txt"), "base\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-qm", "base"]);
  await git(repo, ["branch", "-M", "main"]);
  await git(repo, ["remote", "add", "origin", origin]);
  await git(repo, ["push", "-q", "-u", "origin", "main"]);
  if (specParent !== undefined) {
    await git(repo, ["checkout", "-qb", `agent/spec-${specParent}`]);
    await writeFile(join(repo, "sibling.txt"), "sibling\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-qm", "sibling slice"]);
    await git(repo, ["push", "-q", "origin", `agent/spec-${specParent}`]);
    await git(repo, ["checkout", "-qb", "codex/issue-7", `origin/agent/spec-${specParent}`]);
  } else {
    await git(repo, ["checkout", "-qb", "codex/issue-7"]);
  }
  const issueBody =
    specParent === undefined
      ? ISSUE_BODY
      : `<!-- agent-plan:${specParent}:slice -->\nPart of #${specParent}.\n${ISSUE_BODY}`;

  await writeShim(
    bin,
    "gh",
    `capture="$AGENT_TEST_CAPTURE"
printf '%s\\n' "$*" >>"$capture"
case "$*" in
  'issue view 7 --json number,title,body,comments,labels')
    cat <<'JSON'
{"number":7,"title":"Test task","body":${JSON.stringify(issueBody)},"comments":[],"labels":[{"name":"agent:task"}]}
JSON
    ;;
  'issue view 7 --json comments --jq .comments') printf '[]\\n' ;;
  'pr list --head codex/issue-7 --state open --json number') printf '[]\\n' ;;
  'pr list --head codex/issue-7 --state open --json number,baseRefName') printf '[]\\n' ;;
  'pr create'* ) printf 'https://example.test/pull/12\\n' ;;
esac
exit 0`,
  );
  await writeShim(bin, "claude", claudeBody);
  await writeShim(bin, "make", makeBody);
  return { dir, repo, origin, bin, worktrees };
}

export function sandboxEnv(sandbox: Sandbox): NodeJS.ProcessEnv {
  return {
    PATH: `${sandbox.bin}:${process.env.PATH}`,
    AGENT_LOOP_GH: join(sandbox.bin, "gh"),
    AGENT_CLAUDE_BIN: join(sandbox.bin, "claude"),
    AGENT_TEST_CAPTURE: join(sandbox.dir, "gh-calls"),
    AGENT_TEST_CLAUDE_STDIN: join(sandbox.dir, "claude-stdin"),
    AGENT_TEST_CLAUDE_ARGS: join(sandbox.dir, "claude-args"),
    AGENT_REVIEW_ENABLED: "0",
    AGENT_CLAIM_HEARTBEAT_INTERVAL: "3600",
    AGENT_BLOCK_NOTIFY: "0",
  };
}

export function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

export const RESULT_EVENT =
  '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"duration_ms":100,"result":"done"}';

// executor 以 stream-json 长存会话运行:shim 逐行读 user message,每行回一轮事件。
export const CLAUDE_HAPPY = `while IFS= read -r line; do
  printf '%s\\n' "$line" >>"$AGENT_TEST_CLAUDE_STDIN"
  printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write"}]},"num_turns":1}'
  case $line in
    *'final comment sweep'*) : ;;
    *'commit message'*) printf '%b\\n' 'feat: 实现工单\\n\\n实现 allowed.txt。\\n\\nRefs #7' >"$PWD/.agent-commit-message" ;;
    *) printf 'implemented\\n' >"$PWD/allowed.txt" ;;
  esac
  printf '%s\\n' '${RESULT_EVENT}'
done`;

export const MAKE_OK = "exit 0";

const sandboxes: string[] = [];

export async function cleanupSandboxes(): Promise<void> {
  for (const dir of sandboxes) await rm(dir, { recursive: true, force: true });
}

export async function makeSandbox(
  claudeBody: string,
  makeBody: string,
  specParent?: number,
): Promise<Sandbox> {
  const sandbox = await setupSandbox(claudeBody, makeBody, specParent);
  sandboxes.push(sandbox.dir);
  return sandbox;
}
