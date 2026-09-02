import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { claimIssue, claimRefOf } from "./claim.ts";
import { readStatus } from "./status.ts";
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
