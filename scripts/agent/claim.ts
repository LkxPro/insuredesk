import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { netCall, netCallFast } from "./net.ts";

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
  return netCall("git", ["-C", root, ...args]);
}

async function lsRemoteSha(root: string, ref: string, fast = false): Promise<string> {
  const call = fast ? netCallFast : netCall;
  const out = await call("git", ["-C", root, "ls-remote", "origin", ref]);
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
  const args = ["-C", root, "push", "--atomic"];
  for (const [ref, expected] of leases) args.push(`--force-with-lease=${ref}:${expected}`);
  args.push("origin", ...refspecs);
  try {
    await netCall("git", args);
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
  if (!ok) throw new Error(`release claim failed for #${issue}`);
  await rm(claimFile, { force: true });
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

// 返回 stale claim 的 sha；未过期或不存在返回 null。
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
  const [current, slotCurrent] = await Promise.all([
    lsRemoteSha(root, claimRef, true),
    lsRemoteSha(root, slotRef, true),
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

// 发布前把 claim 推进一格"publish"提交，标记发布窗口；lease 被拒即抛错重试。
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

// worker 侧发布前校验：claim 文件还在且远端 sha 与本地一致。
// 两次 ls-remote 之间 heartbeat 可能推进 sha 造成假丢失，退避复查再定性。
export async function claimOwned(worktree: string, claimFile: string): Promise<boolean> {
  const claim = await readClaimFile(claimFile);
  if (claim === null) return false;
  const max = Number.parseInt(process.env.AGENT_CLAIM_VERIFY_ATTEMPTS ?? "3", 10) || 3;
  const delaySeconds = Number.parseInt(process.env.AGENT_CLAIM_VERIFY_DELAY ?? "2", 10) || 2;
  for (let attempt = 1; ; attempt += 1) {
    const [current, slotCurrent] = await Promise.all([
      lsRemoteSha(worktree, claim.claimRef, true),
      lsRemoteSha(worktree, claim.slotRef, true),
    ]);
    if (claim.sha && current === claim.sha && slotCurrent === claim.sha) return true;
    if (attempt >= max) return false;
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }
}
