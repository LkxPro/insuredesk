import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { claimIssue, claimRefOf } from "./claim.ts";
import { readStatus } from "./status.ts";
import { runWorker } from "./worker.ts";

const run = promisify(execFile);
const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const ISSUE_BODY =
  "## Goal\nTest\n## Scope\nOnly test\n## Declared touch-set\n- allowed.txt\n## Logical locks\n- None\n## Acceptance criteria\n- [ ] done\n## Dependencies\n- None\n## Test plan\n- test";

interface Sandbox {
  dir: string;
  repo: string;
  origin: string;
  bin: string;
  worktrees: string;
}

async function git(cwd: string, args: string[]) {
  return (await run("git", ["-C", cwd, ...args])).stdout.trim();
}

async function writeShim(dir: string, name: string, body: string) {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await run("chmod", ["+x", path]);
}

async function setupSandbox(claudeBody: string, makeBody: string): Promise<Sandbox> {
  const dir = await mkdtemp(join(tmpdir(), "worker-test-"));
  const repo = join(dir, "repo");
  const origin = join(dir, "origin.git");
  const bin = join(dir, "bin");
  const worktrees = dir;
  await mkdir(join(repo, ".github", "agent-prompts"), { recursive: true });
  await mkdir(bin);
  for (const prompt of ["task.md", "review.md", "comment-sweep.md", "repair.md"])
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
  await git(repo, ["checkout", "-qb", "codex/issue-7"]);

  await writeShim(
    bin,
    "gh",
    `capture="$AGENT_TEST_CAPTURE"
printf '%s\\n' "$*" >>"$capture"
case "$*" in
  'issue view 7 --json number,title,body,comments,labels')
    cat <<'JSON'
{"number":7,"title":"Test task","body":${JSON.stringify(ISSUE_BODY)},"comments":[],"labels":[{"name":"agent:task"}]}
JSON
    ;;
  'issue view 7 --json comments --jq .comments') printf '[]\\n' ;;
  'pr list --head codex/issue-7 --state open --json number') printf '[]\\n' ;;
  'pr create'* ) printf 'https://example.test/pull/12\\n' ;;
esac
exit 0`,
  );
  await writeShim(bin, "claude", claudeBody);
  await writeShim(bin, "make", makeBody);
  return { dir, repo, origin, bin, worktrees };
}

function sandboxEnv(sandbox: Sandbox): NodeJS.ProcessEnv {
  return {
    PATH: `${sandbox.bin}:${process.env.PATH}`,
    AGENT_LOOP_GH: join(sandbox.bin, "gh"),
    AGENT_CLAUDE_BIN: join(sandbox.bin, "claude"),
    AGENT_TEST_CAPTURE: join(sandbox.dir, "gh-calls"),
    AGENT_REVIEW_ENABLED: "0",
    AGENT_CLAIM_HEARTBEAT_INTERVAL: "3600",
    AGENT_BLOCK_NOTIFY: "0",
  };
}

function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const RESULT_EVENT =
  '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"duration_ms":100,"result":"done"}';

const CLAUDE_HAPPY = `input=$(cat)
printf '%s\\n' "$input" >"$AGENT_TEST_CLAUDE_STDIN"
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write"}]},"num_turns":1}'
case $input in
  *'final comment sweep'*) : ;;
  *) printf 'implemented\\n' >"$PWD/allowed.txt" ;;
esac
printf '%s\\n' '${RESULT_EVENT}'`;

const MAKE_OK = "exit 0";

const sandboxes: string[] = [];
after(async () => {
  for (const dir of sandboxes) await rm(dir, { recursive: true, force: true });
});

async function makeSandbox(claudeBody: string, makeBody: string): Promise<Sandbox> {
  const sandbox = await setupSandbox(claudeBody, makeBody);
  sandboxes.push(sandbox.dir);
  return sandbox;
}

test("worker 全管线：impl→check→sweep→publish→摘标签→claim 释放", async () => {
  const sandbox = await makeSandbox(CLAUDE_HAPPY, MAKE_OK);
  process.env.AGENT_TEST_CLAUDE_STDIN = join(sandbox.dir, "claude-stdin");
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  // 发布后分支已推、claim refs 已释放。
  const branches = await git(sandbox.origin, ["branch", "--list"]);
  assert.ok(branches.includes("codex/issue-7"));
  assert.equal(
    await git(sandbox.origin, ["rev-parse", "--verify", claimRefOf(7)]).catch(() => "gone"),
    "gone",
  );
  // 摘标签与关单评论发生过。
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(
    calls.includes("issue edit 7 --remove-label agent:running,agent:repair,ready-for-agent"),
  );
  assert.ok(calls.includes("pr create"));
  assert.ok(calls.includes("agent:automerge"));
  // 状态机走到 done,事件流有 result。
  const status = await readStatus(sandbox.worktrees, 7);
  assert.equal(status?.phase, "done");
  assert.equal(status?.turns, 3);
  const events = await readFile(join(sandbox.worktrees, "issue-7.events.jsonl"), "utf8");
  assert.ok(events.includes('"type":"result"'));
});

test("worker 拒绝模型提交的 git 历史改动(fatal→blocked)", async () => {
  const claude = `input=$(cat)
printf 'implemented\\n' >"$PWD/allowed.txt"
git add allowed.txt
git -c user.name=x -c user.email=x@x commit -qm hijack
printf '%s\\n' '${RESULT_EVENT}'`;
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
  });
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("--add-label agent:blocked"));
  // fatal 不重排队。
  assert.ok(!calls.includes("--add-label agent:queued"));
});

test("check 永久失败打满 fix 轮次 → exhausted→blocked", async () => {
  const sandbox = await makeSandbox(CLAUDE_HAPPY, "exit 1");
  await withEnv({ ...sandboxEnv(sandbox), AGENT_FIX_MAX_ROUNDS: "1" }, async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
  });
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("fix rounds"));
  assert.ok(calls.includes("--add-label agent:blocked"));
});

test("发布前 claim 丢失 → process 失败,自动重排队一次", async () => {
  // heartbeat 间隔拉到 1 小时,模拟不到;直接让 fence 前的 claimOwned 失败:
  // claim 之后立刻由"另一克隆"把远端 refs 删掉。
  const claude = `${CLAUDE_HAPPY}`;
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    // 用 shim 包一层 git:收到 push --atomic 创建 claim 之外的 ls-remote 时先删远端。
    await git(sandbox.origin, ["update-ref", "-d", claimRefOf(7)]);
    await git(sandbox.origin, ["update-ref", "-d", "refs/heads/agent-slots/1"]);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
  });
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("agent-requeue:1"));
  assert.ok(calls.includes("--add-label agent:queued"));
});
