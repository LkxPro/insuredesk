import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { claimIssue } from "./claim.ts";
import { runWorker } from "./worker.ts";
import {
  CLAUDE_HAPPY,
  cleanupSandboxes,
  git,
  MAKE_OK,
  makeSandbox,
  RESULT_EVENT,
  sandboxEnv,
  withEnv,
} from "./worker-test-helpers.ts";

after(cleanupSandboxes);

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
  await withEnv({ ...sandboxEnv(sandbox), AGENT_EXECUTOR_RETRY_DELAY: "1" }, async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  const args = await readFile(join(sandbox.dir, "claude-args"), "utf8");
  assert.ok(!args.includes("--resume"));
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
