import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import {
  claimFileOf,
  claimIssue,
  claimOwned,
  claimRefOf,
  dropLocalClaimIfRemoteGone,
  fenceClaim,
  forceReleaseDeadLocalClaim,
  heartbeatClaim,
  releaseClaim,
  releaseRemoteClaim,
  remoteClaimStaleSha,
} from "./claim.ts";

const run = promisify(execFile);

let base: string;
let origin: string;
let root: string;
let worktrees: string;
let savedDelayEnv: Record<string, string | undefined> = {};

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const { stdout } = await run("git", ["-C", cwd, ...args], {
    env: { ...process.env, ...env },
  });
  return stdout.trim();
}

async function remoteSha(ref: string): Promise<string> {
  return git(origin, ["rev-parse", ref]).catch(() => "");
}

before(async () => {
  // 失配/释放重试的真实等待只验证"发生了重试",间隔时长对断言无意义,压到最小。
  savedDelayEnv = {
    AGENT_CLAIM_VERIFY_DELAY: process.env.AGENT_CLAIM_VERIFY_DELAY,
    AGENT_CLAIM_RELEASE_RETRY_DELAY: process.env.AGENT_CLAIM_RELEASE_RETRY_DELAY,
  };
  process.env.AGENT_CLAIM_VERIFY_DELAY = "1";
  process.env.AGENT_CLAIM_RELEASE_RETRY_DELAY = "0.1";
  base = await mkdtemp(join(tmpdir(), "claim-test-"));
  origin = join(base, "origin.git");
  root = join(base, "repo");
  worktrees = join(base, "worktrees");
  await mkdir(worktrees, { recursive: true });
  await run("git", ["init", "--bare", "-q", origin]);
  await run("git", ["init", "-q", root]);
  await git(root, ["config", "user.name", "test"]);
  await git(root, ["config", "user.email", "test@test"]);
  await writeFile(join(root, "f"), "1");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "init"]);
  await git(root, ["branch", "-M", "main"]);
  await git(root, ["remote", "add", "origin", origin]);
  await git(root, ["push", "-q", "-u", "origin", "main"]);
});

after(async () => {
  for (const [key, value] of Object.entries(savedDelayEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(base, { recursive: true, force: true });
});

test("claim 占槽 → heartbeat 推进 → fence → release 全清", async () => {
  const issue = 101;
  assert.equal(await claimIssue(root, worktrees, issue, 2), true);
  const sha1 = await remoteSha(claimRefOf(issue));
  assert.match(sha1, /^[0-9a-f]{40}$/);
  assert.equal(await remoteSha("refs/heads/agent-slots/1"), sha1);

  assert.equal(await heartbeatClaim(root, worktrees, issue), true);
  const sha2 = await remoteSha(claimRefOf(issue));
  assert.notEqual(sha2, sha1);

  await fenceClaim(root, worktrees, issue);
  const sha3 = await remoteSha(claimRefOf(issue));
  assert.notEqual(sha3, sha2);

  await releaseClaim(root, worktrees, issue);
  assert.equal(await remoteSha(claimRefOf(issue)), "");
  assert.equal(await remoteSha("refs/heads/agent-slots/1"), "");
});

test("同 issue 重复 claim 被拒；槽位被占时落到下一槽", async () => {
  assert.equal(await claimIssue(root, worktrees, 102, 2), true);
  assert.equal(await claimIssue(root, worktrees, 102, 2), false);
  assert.equal(await claimIssue(root, worktrees, 103, 2), true);
  assert.equal(await remoteSha(claimRefOf(103)), await remoteSha("refs/heads/agent-slots/2"));
  await releaseClaim(root, worktrees, 102);
  await releaseClaim(root, worktrees, 103);
});

test("remote stale 判定：老 claim 报 stale 并释放，新 claim 不动", async () => {
  const issue = 104;
  await claimIssue(root, worktrees, issue, 1);
  assert.match(await remoteSha(claimRefOf(issue)), /^[0-9a-f]{40}$/);
  assert.equal(await remoteClaimStaleSha(root, issue), null);

  // 把远端 claim 强制换成一个 1 小时前的提交，模拟另一克隆的失联 claim。
  const old = await git(
    root,
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit-tree",
      "HEAD^{tree}",
      "-p",
      "HEAD",
      "-m",
      `claim issue ${issue} slot 1 by 999`,
    ],
    { GIT_COMMITTER_DATE: "@0 +0000" },
  );
  await git(root, [
    "push",
    "-q",
    "--force",
    "origin",
    `${old}:${claimRefOf(issue)}`,
    `${old}:refs/heads/agent-slots/1`,
  ]);
  const staleSha = await remoteClaimStaleSha(root, issue);
  assert.equal(staleSha, old);
  assert.ok(staleSha !== null);
  assert.equal(await releaseRemoteClaim(root, issue, staleSha), true);
  assert.equal(await remoteSha(claimRefOf(issue)), "");
  // 本地 claim 文件里的 sha 已和远端不符，owner 校验必须失败。
  assert.equal(await claimOwned(root, claimFileOf(worktrees, issue)), false);
});

test("claimOwned 在 heartbeat 推进后认新 sha", async () => {
  const issue = 105;
  await claimIssue(root, worktrees, issue, 1);
  assert.equal(await claimOwned(root, claimFileOf(worktrees, issue)), true);
  await heartbeatClaim(root, worktrees, issue);
  assert.equal(await claimOwned(root, claimFileOf(worktrees, issue)), true);
  await releaseClaim(root, worktrees, issue);
});

test("releaseClaim 本地 sha 已过期且无人刷新时,重试耗尽也不删他人 ref", async () => {
  const issue = 106;
  await claimIssue(root, worktrees, issue, 2);
  // 远端被"他人"推进(等价于在途心跳晚于 release 读取落地,但无人再刷新本地文件)。
  const current = await remoteSha(claimRefOf(issue));
  const foreign = await git(root, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit-tree",
    `${current}^{tree}`,
    "-p",
    current,
    "-m",
    `claim issue ${issue} slot 1 by foreign`,
  ]);
  await git(root, [
    "push",
    "-q",
    "--force",
    "origin",
    `${foreign}:${claimRefOf(issue)}`,
    `${foreign}:refs/heads/agent-slots/1`,
  ]);
  await assert.rejects(releaseClaim(root, worktrees, issue));
  assert.equal(await remoteSha(claimRefOf(issue)), foreign);
  assert.equal(await remoteSha("refs/heads/agent-slots/1"), foreign);
  await rm(claimFileOf(worktrees, issue), { force: true });
  // 共享 origin:占用的 slot 要还,否则后续测试领不到槽。
  await git(root, [
    "push",
    "-q",
    "--delete",
    "origin",
    claimRefOf(issue),
    "refs/heads/agent-slots/1",
  ]);
});

test("forceReleaseDeadLocalClaim: 崩溃窗口分裂态(远端推进/文件未更新)收敛清理", async () => {
  const issue = 107;
  await claimIssue(root, worktrees, issue, 1);
  // 远端被推进成旧时间戳提交(等同 stale),本地文件保持原 sha——崩溃窗口的定格。
  const current = await remoteSha(claimRefOf(issue));
  const moved = await git(
    root,
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit-tree",
      `${current}^{tree}`,
      "-p",
      current,
      "-m",
      `claim issue ${issue} slot 1 by crashed`,
    ],
    { GIT_COMMITTER_DATE: "@0 +0000" },
  );
  await git(root, [
    "push",
    "-q",
    "--force",
    "origin",
    `${moved}:${claimRefOf(issue)}`,
    `${moved}:refs/heads/agent-slots/1`,
  ]);
  assert.equal(await forceReleaseDeadLocalClaim(root, worktrees, issue), true);
  assert.equal(await remoteSha(claimRefOf(issue)), "");
  assert.equal(await remoteSha("refs/heads/agent-slots/1"), "");
  assert.equal(await claimIssue(root, worktrees, issue, 1), true);
  await releaseClaim(root, worktrees, issue);
});

test("dropLocalClaimIfRemoteGone: 远端活着不动,远端没了摘本地文件", async () => {
  const issue = 108;
  await claimIssue(root, worktrees, issue, 1);
  assert.equal(await dropLocalClaimIfRemoteGone(root, worktrees, issue), false);
  await git(root, [
    "push",
    "-q",
    "--delete",
    "origin",
    claimRefOf(issue),
    "refs/heads/agent-slots/1",
  ]);
  assert.equal(await dropLocalClaimIfRemoteGone(root, worktrees, issue), true);
  // 文件已摘,可立即重领。
  assert.equal(await claimIssue(root, worktrees, issue, 1), true);
  await releaseClaim(root, worktrees, issue);
});

async function withStormEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = {
    AGENT_CLAIM_VERIFY_STORM_CAP_SECONDS: process.env.AGENT_CLAIM_VERIFY_STORM_CAP_SECONDS,
    AGENT_NET_CALL_ATTEMPTS: process.env.AGENT_NET_CALL_ATTEMPTS,
    AGENT_NET_CALL_TIMEOUT_SECONDS: process.env.AGENT_NET_CALL_TIMEOUT_SECONDS,
  };
  process.env.AGENT_NET_CALL_ATTEMPTS = "1";
  process.env.AGENT_NET_CALL_TIMEOUT_SECONDS = "3";
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("claimOwned 全程传输故障:不计失配,退避到 storm cap 后放行", async () => {
  const issue = 109;
  await claimIssue(root, worktrees, issue, 1);
  const goodUrl = await git(root, ["remote", "get-url", "origin"]);
  await git(root, ["remote", "set-url", "origin", join(base, "gone.git")]);
  try {
    await withStormEnv(async () => {
      process.env.AGENT_CLAIM_VERIFY_STORM_CAP_SECONDS = "1";
      // 旧逻辑 3 次计次后判丢;新逻辑到顶放行,让 fence CAS 做终极裁决。
      assert.equal(await claimOwned(root, claimFileOf(worktrees, issue)), true);
    });
  } finally {
    await git(root, ["remote", "set-url", "origin", goodUrl]);
  }
  await releaseClaim(root, worktrees, issue);
});

test("claimOwned 传输恢复后认回租约:故障轮不消耗失配计次", async () => {
  const issue = 110;
  await claimIssue(root, worktrees, issue, 1);
  const goodUrl = await git(root, ["remote", "get-url", "origin"]);
  await git(root, ["remote", "set-url", "origin", join(base, "gone.git")]);
  const restore = setTimeout(() => {
    void git(root, ["remote", "set-url", "origin", goodUrl]).catch(() => {});
  }, 1000);
  try {
    await withStormEnv(async () => {
      process.env.AGENT_CLAIM_VERIFY_STORM_CAP_SECONDS = "30";
      process.env.AGENT_CLAIM_VERIFY_ATTEMPTS = "1";
      assert.equal(await claimOwned(root, claimFileOf(worktrees, issue)), true);
    });
  } finally {
    clearTimeout(restore);
    await git(root, ["remote", "set-url", "origin", goodUrl]);
  }
  await releaseClaim(root, worktrees, issue);
});
