import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { claimIssue } from "./claim.ts";
import { runWorker } from "./worker.ts";
import {
  CLAUDE_HAPPY,
  cleanupSandboxes,
  ISSUE_BODY,
  MAKE_OK,
  makeSandbox,
  RESULT_EVENT,
  sandboxEnv,
  withEnv,
  writeShim,
} from "./worker-test-helpers.ts";

after(cleanupSandboxes);

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
