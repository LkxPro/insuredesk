import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { claimIssue } from "./claim.ts";
import { runWorker } from "./worker.ts";
import {
  cleanupSandboxes,
  MAKE_OK,
  makeSandbox,
  RESULT_EVENT,
  sandboxEnv,
  withEnv,
} from "./worker-test-helpers.ts";

after(cleanupSandboxes);

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
