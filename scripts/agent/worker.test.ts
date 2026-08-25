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

function sandboxEnv(sandbox: Sandbox): NodeJS.ProcessEnv {
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

function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
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

const RESULT_EVENT =
  '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"duration_ms":100,"result":"done"}';

// executor 以 stream-json 长存会话运行:shim 逐行读 user message,每行回一轮事件。
const CLAUDE_HAPPY = `while IFS= read -r line; do
  printf '%s\\n' "$line" >>"$AGENT_TEST_CLAUDE_STDIN"
  printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write"}]},"num_turns":1}'
  case $line in
    *'final comment sweep'*) : ;;
    *'commit message'*) printf '%b\\n' 'feat: 实现工单\\n\\n实现 allowed.txt。\\n\\nRefs #7' >"$PWD/.agent-commit-message" ;;
    *) printf 'implemented\\n' >"$PWD/allowed.txt" ;;
  esac
  printf '%s\\n' '${RESULT_EVENT}'
done`;

const MAKE_OK = "exit 0";

const sandboxes: string[] = [];
after(async () => {
  for (const dir of sandboxes) await rm(dir, { recursive: true, force: true });
});

async function makeSandbox(
  claudeBody: string,
  makeBody: string,
  specParent?: number,
): Promise<Sandbox> {
  const sandbox = await setupSandbox(claudeBody, makeBody, specParent);
  sandboxes.push(sandbox.dir);
  return sandbox;
}

test("worker 全管线：impl→check→sweep→publish→摘标签→claim 释放", async () => {
  const sandbox = await makeSandbox(CLAUDE_HAPPY, MAKE_OK);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const branches = await git(sandbox.origin, ["branch", "--list"]);
  assert.ok(branches.includes("codex/issue-7"));
  assert.equal(
    await git(sandbox.origin, ["rev-parse", "--verify", claimRefOf(7)]).catch(() => "gone"),
    "gone",
  );
  // squash 合并时该 message 直接成为 main 历史。
  assert.equal(await git(sandbox.origin, ["rev-list", "--count", "main..codex/issue-7"]), "1");
  assert.equal(
    await git(sandbox.origin, ["log", "-1", "--format=%s", "codex/issue-7"]),
    "feat: 实现工单",
  );
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(
    calls.includes("issue edit 7 --remove-label agent:running,agent:repair,ready-for-agent"),
  );
  assert.ok(calls.includes("pr create"));
  assert.ok(calls.includes("agent:automerge"));
  const status = await readStatus(sandbox.worktrees, 7);
  assert.equal(status?.phase, "done");
  assert.equal(status?.turns, 3);
  const events = await readFile(join(sandbox.worktrees, "issue-7.events.jsonl"), "utf8");
  assert.ok(events.includes('"type":"result"'));
});

test("spec 子票:base 为 agent/spec-<parent>,兄弟票产出不被 reset 抹掉", async () => {
  const sandbox = await makeSandbox(CLAUDE_HAPPY, MAKE_OK, 100);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const files = await git(sandbox.origin, ["ls-tree", "-r", "--name-only", "codex/issue-7"]);
  assert.ok(files.split("\n").includes("sibling.txt"));
  assert.ok(files.split("\n").includes("allowed.txt"));
  assert.equal(
    await git(sandbox.origin, ["rev-list", "--count", "agent/spec-100..codex/issue-7"]),
    "1",
  );
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("pr create --head codex/issue-7 --base agent/spec-100"));
});

test("review 未改码:快照 check 被采信,主 worktree 不重跑", async () => {
  const claude = `while IFS= read -r line; do
  case $line in
    *'Review the current worktree diff'*) : ;;
    *'final comment sweep'*) : ;;
    *'commit message'*) printf '%b\\n' 'feat: 实现工单\\n\\nRefs #7' >"$PWD/.agent-commit-message" ;;
    *) printf 'implemented\\n' >"$PWD/allowed.txt" ;;
  esac
  printf '%s\\n' '${RESULT_EVENT}'
done`;
  const make = `dir="$PWD"
while [ $# -gt 0 ]; do [ "$1" = "-C" ] && { dir="$2"; break; }; shift; done
printf '%s\\n' "$dir" >>"$AGENT_TEST_CAPTURE.make-cwds"
exit 0`;
  const sandbox = await makeSandbox(claude, make);
  await withEnv({ ...sandboxEnv(sandbox), AGENT_REVIEW_ENABLED: "1" }, async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const cwds = (await readFile(`${sandbox.dir}/gh-calls.make-cwds`, "utf8")).trim().split("\n");
  assert.equal(cwds.length, 1);
  assert.ok(cwds[0]?.includes("check-snapshot"));
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("pr create"));
});

test("review 改码:快照 check 作废,主 worktree 重跑", async () => {
  const claude = `while IFS= read -r line; do
  case $line in
    *'Review the current worktree diff'*) printf 'review-fix\\n' >>"$PWD/allowed.txt" ;;
    *'final comment sweep'*) : ;;
    *'commit message'*) printf '%b\\n' 'feat: 实现工单\\n\\nRefs #7' >"$PWD/.agent-commit-message" ;;
    *) printf 'implemented\\n' >"$PWD/allowed.txt" ;;
  esac
  printf '%s\\n' '${RESULT_EVENT}'
done`;
  const make = `dir="$PWD"
while [ $# -gt 0 ]; do [ "$1" = "-C" ] && { dir="$2"; break; }; shift; done
printf '%s\\n' "$dir" >>"$AGENT_TEST_CAPTURE.make-cwds"
exit 0`;
  const sandbox = await makeSandbox(claude, make);
  await withEnv({ ...sandboxEnv(sandbox), AGENT_REVIEW_ENABLED: "1" }, async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const cwds = (await readFile(`${sandbox.dir}/gh-calls.make-cwds`, "utf8")).trim().split("\n");
  assert.equal(cwds.length, 2);
  assert.ok(cwds[0]?.includes("check-snapshot"));
  assert.equal(cwds[1], sandbox.repo);
});

test("worker 拒绝模型提交的 git 历史改动(fatal→blocked)", async () => {
  const claude = `while IFS= read -r line; do
  printf 'implemented\\n' >"$PWD/allowed.txt"
  git add allowed.txt
  git -c user.name=x -c user.email=x@x commit -qm hijack
  printf '%s\\n' '${RESULT_EVENT}'
done`;
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
  });
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("--add-label agent:blocked"));
  assert.ok(!calls.includes("--add-label agent:queued"));
});

test("人工关单后失败静默死亡:不重排队、不贴标签、不评论", async () => {
  const sandbox = await makeSandbox(CLAUDE_HAPPY, "exit 1");
  await writeShim(
    sandbox.bin,
    "gh",
    `capture="$AGENT_TEST_CAPTURE"
printf '%s\\n' "$*" >>"$capture"
case "$*" in
  'issue view 7 --json number,title,body,comments,labels')
    cat <<'JSON'
{"number":7,"title":"Test task","body":${JSON.stringify(ISSUE_BODY)},"comments":[],"labels":[{"name":"agent:task"}]}
JSON
    ;;
  'issue view 7 --json state --jq .state') printf 'CLOSED\\n' ;;
  'issue view 7 --json comments --jq .comments') printf '[]\\n' ;;
esac
exit 0`,
  );
  await withEnv({ ...sandboxEnv(sandbox), AGENT_FIX_MAX_ROUNDS: "1" }, async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
  });
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(!calls.includes("issue comment"));
  assert.ok(!calls.includes("--add-label"));
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

test("pause_turn 自动续跑:executor 注 Continue.,run 等真完成", async () => {
  const claude = `while IFS= read -r line; do
  printf '%s\\n' "$line" >>"$AGENT_TEST_CLAUDE_STDIN"
  case $line in
    *'final comment sweep'*)
      printf '%s\\n' '${RESULT_EVENT}' ;;
    *Continue.*)
      printf 'implemented\\n' >"$PWD/allowed.txt"
      printf '%s\\n' '${RESULT_EVENT}' ;;
    *)
      printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"stop_reason":"pause_turn","result":""}' ;;
  esac
done`;
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const captured = await readFile(join(sandbox.dir, "claude-stdin"), "utf8");
  assert.ok(captured.includes("Continue."));
  const events = await readFile(join(sandbox.worktrees, "issue-7.events.jsonl"), "utf8");
  assert.ok(events.includes('"subtype":"pause-continue"'));
  assert.equal(
    await git(sandbox.origin, ["log", "-1", "--format=%s", "codex/issue-7"]),
    "chore: Test task",
  );
});

test("fix 轮复用 implementation 会话(warm 短 prompt)", async () => {
  const make = `if [ -f "$AGENT_TEST_CAPTURE.make-failed" ]; then exit 0
else touch "$AGENT_TEST_CAPTURE.make-failed"; exit 1
fi`;
  const sandbox = await makeSandbox(CLAUDE_HAPPY, make);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const captured = await readFile(join(sandbox.dir, "claude-stdin"), "utf8");
  const lines = captured.split("\n").filter(Boolean);
  assert.equal(lines.filter((l) => l.includes("Implement the issue")).length, 1);
  assert.ok(captured.includes("`make check` failed. Fix"));
  assert.ok(captured.includes("failed_check_log"));
});

test("implementation 会话死亡 → fix 轮以 --resume 续跑同会话", async () => {
  const claude = `printf '%s\\n' "$*" >>"$AGENT_TEST_CLAUDE_ARGS"
while IFS= read -r line; do
  printf '%s\\n' "$line" >>"$AGENT_TEST_CLAUDE_STDIN"
  printf '%s\\n' '{"type":"system","subtype":"init","session_id":"sess-7"}'
  case $line in
    *'final comment sweep'*) : ;;
    *) printf 'implemented\\n' >"$PWD/allowed.txt" ;;
  esac
  printf '%s\\n' '${RESULT_EVENT}'
  case $line in
    *'Implement the issue'*) exit 0 ;;
  esac
done`;
  const make = `if [ -f "$AGENT_TEST_CAPTURE.make-failed" ]; then exit 0
else touch "$AGENT_TEST_CAPTURE.make-failed"; exit 1
fi`;
  const sandbox = await makeSandbox(claude, make);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const args = await readFile(join(sandbox.dir, "claude-args"), "utf8");
  assert.ok(args.includes("--resume sess-7"));
  const captured = await readFile(join(sandbox.dir, "claude-stdin"), "utf8");
  assert.ok(captured.includes("interrupted by a transport failure"));
  assert.equal(captured.split("\n").filter((l) => l.includes("Implement the issue")).length, 1);
});

test("会话未 init 即死(无 session_id)→ 完整 prompt 冷启动,无 --resume", async () => {
  const claude = `printf '%s\\n' "$*" >>"$AGENT_TEST_CLAUDE_ARGS"
n=$(cat "$AGENT_TEST_CAPTURE.n" 2>/dev/null || echo 0)
n=$((n+1))
printf '%s\\n' "$n" >"$AGENT_TEST_CAPTURE.n"
if [ $n -eq 1 ]; then exit 1; fi
while IFS= read -r line; do
  printf '%s\\n' "$line" >>"$AGENT_TEST_CLAUDE_STDIN"
  printf '%s\\n' '{"type":"system","subtype":"init","session_id":"sess-8"}'
  case $line in
    *'final comment sweep'*) : ;;
    *) printf 'implemented\\n' >"$PWD/allowed.txt" ;;
  esac
  printf '%s\\n' '${RESULT_EVENT}'
done`;
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const args = await readFile(join(sandbox.dir, "claude-args"), "utf8");
  assert.ok(!args.includes("--resume"));
});

test("stall 后 nudge 软干预恢复,pipeline 照常完成", async () => {
  const claude = `while IFS= read -r line; do
  case $line in
    *'Implement the issue'*) sleep 3 ;;
  esac
  printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write"}]},"num_turns":1}'
  case $line in
    *'final comment sweep'*) : ;;
    *) printf 'implemented\\n' >"$PWD/allowed.txt" ;;
  esac
  printf '%s\\n' '${RESULT_EVENT}'
done`;
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv(
    {
      ...sandboxEnv(sandbox),
      AGENT_NUDGE_AFTER_SECONDS: "1",
      AGENT_NUDGE_GRACE_SECONDS: "4",
      AGENT_NUDGE_WATCHDOG_SECONDS: "1",
    },
    async () => {
      assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
      assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
    },
  );
  const events = await readFile(join(sandbox.worktrees, "issue-7.events.jsonl"), "utf8");
  assert.ok(events.includes('"subtype":"nudge"'));
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("pr create"));
});

test("nudge 宽限耗尽 → stall abort → process 级失败自动重排队", async () => {
  const claude = "while IFS= read -r line; do :; done";
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv(
    {
      ...sandboxEnv(sandbox),
      AGENT_NUDGE_AFTER_SECONDS: "1",
      AGENT_NUDGE_GRACE_SECONDS: "2",
      AGENT_NUDGE_WATCHDOG_SECONDS: "1",
    },
    async () => {
      assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
      assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
    },
  );
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("agent-requeue:1"));
  assert.ok(calls.includes("--add-label agent:queued"));
  const events = await readFile(join(sandbox.worktrees, "issue-7.events.jsonl"), "utf8");
  assert.ok(events.includes('"subtype":"nudge"'));
});

test("零产出 fatal → blocked 评论带上模型的 blocker 说明", async () => {
  const claude = `while IFS= read -r line; do
  printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"result":"BLOCKED: touch-set 与 AC 互斥,需要改票"}'
done`;
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
  });
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("--add-label agent:blocked"));
  assert.ok(calls.includes("BLOCKED: touch-set 与 AC 互斥"));
  assert.ok(!calls.includes("--add-label agent:queued"));
});

test("touch-set 越界不再 fatal:放行并在发布评论列出越界文件", async () => {
  const claude = `while IFS= read -r line; do
  case $line in
    *'final comment sweep'*) : ;;
    *) printf 'implemented\\n' >"$PWD/allowed.txt"; printf 'ripple\\n' >"$PWD/disallowed.txt" ;;
  esac
  printf '%s\\n' '${RESULT_EVENT}'
done`;
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("pr create"));
  assert.ok(calls.includes("outside the declared touch-set"));
  assert.ok(calls.includes("disallowed.txt"));
});

test("success+is_error 矛盾结果按 transient 同会话重试,不消耗重排队", async () => {
  const claude = `count=0
while IFS= read -r line; do
  count=$((count+1))
  if [ $count -eq 1 ]; then
    printf '%s\\n' '{"type":"result","subtype":"success","is_error":true,"num_turns":1}'
    continue
  fi
  case $line in
    *'final comment sweep'*) : ;;
    *) printf 'implemented\\n' >"$PWD/allowed.txt" ;;
  esac
  printf '%s\\n' '${RESULT_EVENT}'
done`;
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv({ ...sandboxEnv(sandbox), AGENT_EXECUTOR_RETRY_DELAY: "1" }, async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("pr create"));
  assert.ok(!calls.includes("agent-requeue"));
});

test("claude 启动即死:stdin EPIPE 不崩溃,transient 打满后按进程级失败重排队", async () => {
  // 进程不写任何事件直接退出;写入死管道触发异步 EPIPE(Linux CI 实测崩溃过)。
  const claude = "exit 1";
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv(
    { ...sandboxEnv(sandbox), AGENT_EXECUTOR_ATTEMPTS: "2", AGENT_EXECUTOR_RETRY_DELAY: "1" },
    async () => {
      assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
      assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
    },
  );
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("agent-requeue:1"));
  assert.ok(calls.includes("--add-label agent:queued"));
});

test("sweep 每轮都改动也不死循环:达到上限在 check 绿态收束发布", async () => {
  const claude = `while IFS= read -r line; do
  printf '%s\\n' "$line" >>"$AGENT_TEST_CLAUDE_STDIN"
  case $line in
    *'final comment sweep'*) printf 'sweep\\n' >>"$PWD/allowed.txt" ;;
    *'commit message'*) printf '%b\\n' 'feat: 实现工单\\n\\nRefs #7' >"$PWD/.agent-commit-message" ;;
    *) printf 'implemented\\n' >"$PWD/allowed.txt" ;;
  esac
  printf '%s\\n' '${RESULT_EVENT}'
done`;
  const sandbox = await makeSandbox(claude, MAKE_OK);
  await withEnv({ ...sandboxEnv(sandbox), AGENT_SWEEP_MAX_ROUNDS: "2" }, async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const captured = await readFile(join(sandbox.dir, "claude-stdin"), "utf8");
  assert.equal(captured.split("\n").filter((l) => l.includes("final comment sweep")).length, 2);
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("pr create"));
});

test("发布前 claim 丢失 → process 失败,自动重排队一次", async () => {
  const sandbox = await makeSandbox(CLAUDE_HAPPY, MAKE_OK);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    await git(sandbox.origin, ["update-ref", "-d", claimRefOf(7)]);
    await git(sandbox.origin, ["update-ref", "-d", "refs/heads/agent-slots/1"]);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
  });
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("agent-requeue:1"));
  assert.ok(calls.includes("--add-label agent:queued"));
});

test("publish 相 push 失败保留本地 commit,重领取跳过实现直接从 publish 续跑", async () => {
  const sandbox = await makeSandbox(
    CLAUDE_HAPPY,
    `printf 'ran\\n' >>"$AGENT_TEST_CAPTURE.make-runs"
exit 0`,
  );
  // claim/fence 的 --atomic push 也经此 shim,case 不能误拦。
  const realGit = (await run("which", ["git"])).stdout.trim();
  await writeShim(
    sandbox.bin,
    "git",
    `case "$*" in
  *'push --set-upstream --force-with-lease origin HEAD'*)
    if [ ! -f "$AGENT_TEST_CAPTURE.push-failed" ]; then
      touch "$AGENT_TEST_CAPTURE.push-failed"
      echo 'simulated push outage' >&2
      exit 1
    fi
    ;;
esac
exec "${realGit}" "$@"`,
  );
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
  });
  const publishSha = await git(sandbox.repo, ["rev-parse", "HEAD"]);
  assert.equal(await git(sandbox.repo, ["log", "-1", "--format=%s"]), "feat: 实现工单");
  assert.equal(await git(sandbox.repo, ["rev-list", "--count", "origin/main..HEAD"]), "1");
  assert.equal(
    await git(sandbox.repo, ["ls-files", "--modified", "--others", "--exclude-standard"]),
    "",
  );
  assert.equal(
    (await readFile(join(sandbox.worktrees, "issue-7.publish-pending"), "utf8")).trim(),
    publishSha,
  );
  const calls1 = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls1.includes("agent-requeue:1"));
  assert.ok(!(await git(sandbox.origin, ["branch", "--list"])).includes("codex/issue-7"));

  await rm(join(sandbox.dir, "claude-stdin"), { force: true });
  await rm(join(sandbox.dir, "gh-calls.make-runs"), { force: true });
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  assert.equal(await git(sandbox.repo, ["rev-parse", "HEAD"]), publishSha);
  await assert.rejects(readFile(join(sandbox.dir, "claude-stdin"), "utf8"));
  await assert.rejects(readFile(join(sandbox.dir, "gh-calls.make-runs"), "utf8"));
  const calls2 = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls2.includes("pr create"));
  await assert.rejects(readFile(join(sandbox.worktrees, "issue-7.publish-pending"), "utf8"));
  assert.equal(await git(sandbox.origin, ["rev-list", "--count", "main..codex/issue-7"]), "1");
  assert.equal(
    await git(sandbox.origin, ["log", "-1", "--format=%s", "codex/issue-7"]),
    "feat: 实现工单",
  );
});

test("非 publish 相失败仍 reset 到 startHead 并清残留", async () => {
  const sandbox = await makeSandbox(CLAUDE_HAPPY, "exit 1");
  await withEnv({ ...sandboxEnv(sandbox), AGENT_FIX_MAX_ROUNDS: "1" }, async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
  });
  assert.equal(
    await git(sandbox.repo, ["rev-parse", "HEAD"]),
    await git(sandbox.repo, ["rev-parse", "origin/main"]),
  );
  assert.equal(
    await git(sandbox.repo, ["ls-files", "--modified", "--others", "--exclude-standard"]),
    "",
  );
  await assert.rejects(readFile(join(sandbox.worktrees, "issue-7.publish-pending"), "utf8"));
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("--add-label agent:blocked"));
});

test("publish-pending 标记与 HEAD 不符则忽略,全量重跑并清掉旧标记", async () => {
  const sandbox = await makeSandbox(CLAUDE_HAPPY, MAKE_OK);
  await writeFile(join(sandbox.worktrees, "issue-7.publish-pending"), `${"0".repeat(40)}\n`);
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const captured = await readFile(join(sandbox.dir, "claude-stdin"), "utf8");
  assert.ok(captured.includes("Implement the issue"));
  assert.equal(await git(sandbox.origin, ["rev-list", "--count", "main..codex/issue-7"]), "1");
  await assert.rejects(readFile(join(sandbox.worktrees, "issue-7.publish-pending"), "utf8"));
});
