import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callGit } from "./net.ts";

const FAST_PROBE = { attempts: 2, timeoutSeconds: 15 };

const CLAIM_AUTHOR = [
  "-c",
  "user.name=insuredesk-agent-claim",
  "-c",
  "user.email=insuredesk-agent-claim@users.noreply.github.com",
];

export function claimRefOf(issue: number): string {
  return `refs/heads/agent-claims/issue-${issue}`;
}

function slotRefOf(slot: number): string {
  return `refs/heads/agent-slots/${slot}`;
}

export function claimFileOf(worktrees: string, issue: number): string {
  return join(worktrees, `issue-${issue}.claim`);
}

interface ClaimFile {
  claimRef: string;
  slotRef: string;
  sha: string;
}

async function readClaimFile(path: string): Promise<ClaimFile | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const [claimRef, slotRef, sha] = text.split("\n");
  if (!claimRef || !slotRef || !sha) return null;
  return { claimRef, slotRef, sha };
}

async function writeClaimFile(path: string, claim: ClaimFile): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${claim.claimRef}\n${claim.slotRef}\n${claim.sha}\n`);
  await rename(tmp, path);
}

function git(root: string, args: string[]): Promise<string> {
  return callGit(root, args);
}

async function lsRemoteSha(root: string, ref: string, fast = false): Promise<string> {
  const out = await callGit(root, ["ls-remote", "origin", ref], fast ? FAST_PROBE : {});
  return out.split(/\s+/)[0] ?? "";
}

async function claimCommit(root: string, parent: string, message: string): Promise<string> {
  const out = await git(root, [
    ...CLAIM_AUTHOR,
    "commit-tree",
    `${parent}^{tree}`,
    "-p",
    parent,
    "-m",
    message,
  ]);
  return out.trim();
}

async function pushAtomic(
  root: string,
  refspecs: string[],
  leases: Array<[ref: string, expected: string]> = [],
): Promise<boolean> {
  const args = ["push", "--atomic"];
  for (const [ref, expected] of leases) args.push(`--force-with-lease=${ref}:${expected}`);
  args.push("origin", ...refspecs);
  try {
    await callGit(root, args);
    return true;
  } catch {
    return false;
  }
}

function validateClaimFile(issue: number, claim: ClaimFile): number {
  if (claim.claimRef !== claimRefOf(issue))
    throw new Error(`refusing unexpected claim ref: ${claim.claimRef}`);
  const slot = Number.parseInt(claim.slotRef.replace("refs/heads/agent-slots/", ""), 10);
  if (!Number.isInteger(slot) || slot < 1)
    throw new Error(`refusing unexpected slot ref: ${claim.slotRef}`);
  if (!/^[0-9a-f]+$/.test(claim.sha)) throw new Error(`bad claim sha: ${claim.sha}`);
  return slot;
}

export async function claimIssue(
  root: string,
  worktrees: string,
  issue: number,
  maxParallel: number,
): Promise<boolean> {
  const claimFile = claimFileOf(worktrees, issue);
  if ((await readClaimFile(claimFile)) !== null) return false;
  const claimSha = (await git(root, ["rev-parse", "origin/main"])).trim();
  for (let slot = 1; slot <= maxParallel; slot += 1) {
    const commit = await claimCommit(
      root,
      claimSha,
      `claim issue ${issue} slot ${slot} by ${process.pid}`,
    );
    const claim: ClaimFile = {
      claimRef: claimRefOf(issue),
      slotRef: slotRefOf(slot),
      sha: commit,
    };
    await writeClaimFile(claimFile, claim);
    if (await pushAtomic(root, [`${commit}:${claim.claimRef}`, `${commit}:${claim.slotRef}`]))
      return true;
  }
  await rm(claimFile, { force: true });
  return false;
}

export async function releaseClaim(root: string, worktrees: string, issue: number): Promise<void> {
  const claimFile = claimFileOf(worktrees, issue);
  // 退出路径上与在途心跳有一次性竞态:心跳落地会推进远端 sha,先读到的 sha 即 stale。
  // 文件 sha 只被自己的心跳改写,重读重试安全;若远端已被他人接管,CAS 永远失败,自然放弃。
  for (let attempt = 1; ; attempt += 1) {
    const claim = await readClaimFile(claimFile);
    if (claim === null) return;
    validateClaimFile(issue, claim);
    const ok = await pushAtomic(
      root,
      [`:${claim.claimRef}`, `:${claim.slotRef}`],
      [
        [claim.claimRef, claim.sha],
        [claim.slotRef, claim.sha],
      ],
    );
    if (ok) {
      await rm(claimFile, { force: true });
      return;
    }
    if (attempt >= 3) throw new Error(`release claim failed for #${issue}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export async function releaseRemoteClaim(
  root: string,
  issue: number,
  expectedSha = "",
): Promise<boolean> {
  const claimRef = claimRefOf(issue);
  const claimSha = await lsRemoteSha(root, claimRef, true);
  if (!claimSha) return true;
  if (expectedSha && claimSha !== expectedSha) return false;
  await git(root, ["fetch", "-q", "origin", claimRef]);
  const message = await git(root, ["log", "-1", "--format=%B", "FETCH_HEAD"]);
  const slot = Number.parseInt(
    message.match(/^claim issue [0-9]+ slot ([0-9]+) by /m)?.[1] ?? "",
    10,
  );
  if (!Number.isInteger(slot) || slot < 1) throw new Error(`cannot verify remote claim #${issue}`);
  const slotRef = slotRefOf(slot);
  const slotSha = await lsRemoteSha(root, slotRef, true);
  if (slotSha !== claimSha) throw new Error(`claim/slot owner mismatch for #${issue}`);
  await pushAtomic(
    root,
    [`:${claimRef}`, `:${slotRef}`],
    [
      [claimRef, claimSha],
      [slotRef, claimSha],
    ],
  );
  return true;
}

export async function remoteClaimStaleSha(root: string, issue: number): Promise<string | null> {
  const staleSeconds = Number.parseInt(process.env.AGENT_CLAIM_STALE_SECONDS ?? "300", 10) || 300;
  const claimRef = claimRefOf(issue);
  try {
    await git(root, ["fetch", "-q", "origin", claimRef]);
  } catch {
    return null;
  }
  const claimedAt = Number.parseInt(
    await git(root, ["log", "-1", "--format=%ct", "FETCH_HEAD"]),
    10,
  );
  const now = Math.floor(Date.now() / 1000);
  if (now - claimedAt < staleSeconds) return null;
  return (await git(root, ["rev-parse", "FETCH_HEAD"])).trim();
}

export async function heartbeatClaim(
  root: string,
  worktrees: string,
  issue: number,
): Promise<boolean> {
  const claimFile = claimFileOf(worktrees, issue);
  const claim = await readClaimFile(claimFile);
  if (claim === null) return false;
  const { claimRef, slotRef, sha: expected } = claim;
  // 心跳误判的代价是杀掉健康 worker:ls-remote 走全重试路径,
  // false 必须意味着真丢租约或持续多分钟的中断,而不是半分钟抖动。
  const [current, slotCurrent] = await Promise.all([
    lsRemoteSha(root, claimRef),
    lsRemoteSha(root, slotRef),
  ]);
  if (!current || current !== slotCurrent || current !== expected) return false;
  const slot = validateClaimFile(issue, claim);
  const heartbeat = await claimCommit(
    root,
    current,
    `claim issue ${issue} slot ${slot} by ${process.pid}`,
  );
  const ok = await pushAtomic(
    root,
    [`${heartbeat}:${claimRef}`, `${heartbeat}:${slotRef}`],
    [
      [claimRef, current],
      [slotRef, current],
    ],
  );
  if (!ok) return false;
  await writeClaimFile(claimFile, { claimRef, slotRef, sha: heartbeat });
  return true;
}

export async function fenceClaim(
  root: string,
  worktrees: string,
  issue: number,
  publishMarkerFile?: string,
): Promise<void> {
  if (publishMarkerFile) await writeFile(publishMarkerFile, "");
  const claimFile = claimFileOf(worktrees, issue);
  const claim = await readClaimFile(claimFile);
  if (claim === null) throw new Error(`no claim file for #${issue}`);
  const fenced = await claimCommit(root, claim.sha, `publish issue ${issue} by ${process.pid}`);
  const ok = await pushAtomic(
    root,
    [`${fenced}:${claim.claimRef}`, `${fenced}:${claim.slotRef}`],
    [
      [claim.claimRef, claim.sha],
      [claim.slotRef, claim.sha],
    ],
  );
  if (!ok) throw new Error(`fence claim failed for #${issue}`);
  await writeClaimFile(claimFile, { ...claim, sha: fenced });
}

// 两次 ls-remote 之间 heartbeat 可能推进 sha 造成假丢失，退避复查再定性。
// 传输层故障证明不了丢租约（此时真丢了也会被 fence CAS 拦住），同样退避复查；
// 不走 fast 路径：发布窗口要的是扛住分钟级网络风暴，不是省几秒。
export async function claimOwned(worktree: string, claimFile: string): Promise<boolean> {
  const claim = await readClaimFile(claimFile);
  if (claim === null) return false;
  const max = Number.parseInt(process.env.AGENT_CLAIM_VERIFY_ATTEMPTS ?? "3", 10) || 3;
  const delaySeconds = Number.parseInt(process.env.AGENT_CLAIM_VERIFY_DELAY ?? "2", 10) || 2;
  for (let attempt = 1; ; attempt += 1) {
    let current = "";
    let slotCurrent = "";
    try {
      [current, slotCurrent] = await Promise.all([
        lsRemoteSha(worktree, claim.claimRef),
        lsRemoteSha(worktree, claim.slotRef),
      ]);
    } catch {}
    if (claim.sha && current === claim.sha && slotCurrent === claim.sha) return true;
    if (attempt >= max) return false;
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }
}

// 本地 claim 文件残留但远端 ref 已无主(释放竞态/崩溃窗口留下的分裂态):
// 远端活着就轮到 stale 流程,不动;远端没了,本地文件只是死掉的残留,摘掉。
// 返回 true = 摘了文件,可以重领。
export async function dropLocalClaimIfRemoteGone(
  root: string,
  worktrees: string,
  issue: number,
): Promise<boolean> {
  const claimFile = claimFileOf(worktrees, issue);
  if ((await readClaimFile(claimFile)) === null) return false;
  if (await lsRemoteSha(root, claimRefOf(issue), true)) return false;
  await rm(claimFile, { force: true });
  return true;
}

// pid 已死且 issue 非 running 时的兜底清理。常规 CAS 失败说明本地 sha 已过期
// (崩溃发生在心跳 push 与文件落盘之间);远端无主则摘本地文件,远端 stale
// 则强释放远端后摘文件。心跳死透是前置条件,远端推进只可能来自他人新 claim,
// 此时 stale 判定不过,什么都不动。返回 true = 本地文件已清,可重领/回队。
export async function forceReleaseDeadLocalClaim(
  root: string,
  worktrees: string,
  issue: number,
): Promise<boolean> {
  const claimFile = claimFileOf(worktrees, issue);
  if ((await readClaimFile(claimFile)) === null) return true;
  await releaseClaim(root, worktrees, issue).catch(() => {});
  if ((await readClaimFile(claimFile)) === null) return true;
  if (await dropLocalClaimIfRemoteGone(root, worktrees, issue)) return true;
  const staleSha = await remoteClaimStaleSha(root, issue);
  if (staleSha && (await releaseRemoteClaim(root, issue, staleSha))) {
    await rm(claimFile, { force: true });
    return true;
  }
  return false;
}
