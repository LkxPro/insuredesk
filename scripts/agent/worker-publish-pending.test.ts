import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { claimIssue, claimRefOf, dropLocalClaimIfRemoteGone } from "./claim.ts";
import { runWorker } from "./worker.ts";
import {
  CLAUDE_HAPPY,
  cleanupSandboxes,
  git,
  MAKE_OK,
  makeSandbox,
  sandboxEnv,
  withEnv,
  writeShim,
} from "./worker-test-helpers.ts";

const run = promisify(execFile);

after(cleanupSandboxes);

test("发布前 claim 丢失 → process 失败,自动重排队;commit 与 pending 标记保留,重领取续跑发布", async () => {
  const sandbox = await makeSandbox(CLAUDE_HAPPY, MAKE_OK);
  await withEnv({ ...sandboxEnv(sandbox), AGENT_CLAIM_VERIFY_DELAY: "1" }, async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    await git(sandbox.origin, ["update-ref", "-d", claimRefOf(7)]);
    await git(sandbox.origin, ["update-ref", "-d", "refs/heads/agent-slots/1"]);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 1);
  });
  const calls = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls.includes("agent-requeue:1"));
  assert.ok(calls.includes("--add-label agent:queued"));
  // commit 先于 claimOwned 落地:丢租约不再丢工作。
  const publishSha = await git(sandbox.repo, ["rev-parse", "HEAD"]);
  assert.equal(await git(sandbox.repo, ["log", "-1", "--format=%s"]), "feat: 实现工单");
  assert.equal(await git(sandbox.repo, ["rev-list", "--count", "origin/main..HEAD"]), "1");
  assert.equal(
    (await readFile(join(sandbox.worktrees, "issue-7.publish-pending"), "utf8")).trim(),
    publishSha,
  );

  // 远端 ref 已删,本地 claim 文件是残留;按 dispatcher 的恢复原语摘掉再重领。
  assert.equal(await dropLocalClaimIfRemoteGone(sandbox.repo, sandbox.worktrees, 7), true);
  await rm(join(sandbox.dir, "claude-stdin"), { force: true });
  await withEnv(sandboxEnv(sandbox), async () => {
    assert.equal(await claimIssue(sandbox.repo, sandbox.worktrees, 7, 1), true);
    assert.equal(await runWorker(sandbox.repo, sandbox.repo, 7), 0);
  });
  await assert.rejects(readFile(join(sandbox.dir, "claude-stdin"), "utf8"));
  const calls2 = await readFile(join(sandbox.dir, "gh-calls"), "utf8");
  assert.ok(calls2.includes("pr create"));
  await assert.rejects(readFile(join(sandbox.worktrees, "issue-7.publish-pending"), "utf8"));
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
