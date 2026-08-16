import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Phase =
  | "implementation"
  | "review"
  | "check"
  | "fix"
  | "sweep"
  | "message"
  | "publish"
  | "done"
  | "failed";

export interface LastEvent {
  ts: number;
  kind: string;
  summary: string;
}

export interface WorkerStatus {
  issue: number;
  pid: number;
  phase: Phase;
  phaseSince: number;
  turns: number;
  lastEvent: LastEvent | null;
  nudgedAt?: number;
  updatedAt: number;
}

// claude 相内 10 分钟无事件 = 空转；check 相（确定性命令）给 30 分钟。
const CLAUDE_STALL_SECONDS =
  Number.parseInt(process.env.AGENT_STALL_CLAUDE_SECONDS ?? "600", 10) || 600;
const CHECK_STALL_SECONDS =
  Number.parseInt(process.env.AGENT_STALL_CHECK_SECONDS ?? "1800", 10) || 1800;
const PUBLISH_STALL_SECONDS =
  Number.parseInt(process.env.AGENT_STALL_PUBLISH_SECONDS ?? "600", 10) || 600;

export function statusFileOf(worktrees: string, issue: number): string {
  return join(worktrees, `issue-${issue}.status.json`);
}

export function eventsFileOf(worktrees: string, issue: number): string {
  return join(worktrees, `issue-${issue}.events.jsonl`);
}

export async function readStatus(worktrees: string, issue: number): Promise<WorkerStatus | null> {
  try {
    return JSON.parse(await readFile(statusFileOf(worktrees, issue), "utf8")) as WorkerStatus;
  } catch {
    return null;
  }
}

async function writeStatus(worktrees: string, status: WorkerStatus): Promise<void> {
  const file = statusFileOf(worktrees, status.issue);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(status)}\n`);
  await rename(tmp, file);
}

// worker 与 executor 两个写者各写各的字段：先读后改再原子替换。
export async function patchStatus(
  worktrees: string,
  issue: number,
  patch: Partial<Omit<WorkerStatus, "issue" | "updatedAt" | "nudgedAt">> & {
    nudgedAt?: number | null;
  },
): Promise<void> {
  const current = await readStatus(worktrees, issue);
  const next: WorkerStatus = {
    issue,
    pid: patch.pid ?? current?.pid ?? process.pid,
    phase: patch.phase ?? current?.phase ?? "implementation",
    phaseSince: patch.phase !== undefined || current === null ? Date.now() : current.phaseSince,
    turns: patch.turns ?? current?.turns ?? 0,
    lastEvent: patch.lastEvent !== undefined ? patch.lastEvent : (current?.lastEvent ?? null),
    updatedAt: Date.now(),
  };
  const nudgedAt = patch.nudgedAt === undefined ? current?.nudgedAt : (patch.nudgedAt ?? undefined);
  if (nudgedAt !== undefined) next.nudgedAt = nudgedAt;
  await writeStatus(worktrees, next);
}

export async function appendEvent(
  worktrees: string,
  issue: number,
  event: Record<string, unknown>,
): Promise<void> {
  await appendFile(eventsFileOf(worktrees, issue), `${JSON.stringify(event)}\n`);
}

export interface Health {
  stuck: boolean;
  reason: string;
}

export function nudgeWindowSeconds(): { after: number; grace: number } {
  const read = (key: string, fallback: number) => {
    const value = Number.parseInt(process.env[key] ?? "", 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  return {
    after: read("AGENT_NUDGE_AFTER_SECONDS", 600),
    grace: read("AGENT_NUDGE_GRACE_SECONDS", 600),
  };
}

export function evaluateHealth(status: WorkerStatus, now = Date.now()): Health {
  if (status.phase === "done" || status.phase === "failed") return { stuck: false, reason: "" };
  const ageSeconds = (ts: number) => Math.floor((now - ts) / 1000);
  if (status.phase === "check") {
    if (ageSeconds(status.phaseSince) > CHECK_STALL_SECONDS)
      return {
        stuck: true,
        reason: `check phase for ${Math.floor(ageSeconds(status.phaseSince) / 60)}min without completion`,
      };
    return { stuck: false, reason: "" };
  }
  if (status.phase === "publish") {
    if (ageSeconds(status.phaseSince) > PUBLISH_STALL_SECONDS)
      return {
        stuck: true,
        reason: `publish phase for ${Math.floor(ageSeconds(status.phaseSince) / 60)}min`,
      };
    return { stuck: false, reason: "" };
  }
  const lastTs = status.lastEvent?.ts ?? status.phaseSince;
  if (ageSeconds(lastTs) > CLAUDE_STALL_SECONDS)
    return {
      stuck: true,
      reason: `${status.phase}: no executor event for ${Math.floor(ageSeconds(lastTs) / 60)}min`,
    };
  return { stuck: false, reason: "" };
}

// daemon 硬杀让出 [after, after+grace] 窗口给 worker 内 watchdog 软干预;
// 窗口耗尽仍 stuck 说明 worker watchdog 也死了,才归 daemon 收割。
export function daemonShouldKill(status: WorkerStatus, now = Date.now()): boolean {
  if (!evaluateHealth(status, now).stuck) return false;
  if (status.phase === "check" || status.phase === "publish") return true;
  const { after, grace } = nudgeWindowSeconds();
  const lastTs = status.lastEvent?.ts ?? status.phaseSince;
  return Math.floor((now - lastTs) / 1000) > after + grace;
}

function age(now: number, ts: number): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

export function renderStatusRow(status: WorkerStatus, now = Date.now()): string {
  const health = evaluateHealth(status, now);
  const last = status.lastEvent
    ? `${status.lastEvent.summary || status.lastEvent.kind} ${age(now, status.lastEvent.ts)} ago`
    : "-";
  const flag = health.stuck ? `STUCK(${health.reason})` : "ok";
  const nudged = status.nudgedAt !== undefined ? "+nudged" : "";
  return `#${status.issue}\t${status.phase}\t${last}\tturns=${status.turns}\t${flag}${nudged}`;
}

export async function renderAll(worktrees: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  let files: string[] = [];
  try {
    files = await readdir(worktrees);
  } catch {
    return "(no worktrees dir)\n";
  }
  const rows: string[] = [];
  const now = Date.now();
  for (const file of files.filter((f) => /^issue-[0-9]+\.status\.json$/.test(f)).sort()) {
    const issue = Number.parseInt(file.match(/issue-([0-9]+)/)?.[1] ?? "", 10);
    if (!Number.isInteger(issue)) continue;
    const status = await readStatus(worktrees, issue);
    if (status) rows.push(renderStatusRow(status, now));
  }
  return rows.length ? `${rows.join("\n")}\n` : "(no worker status files)\n";
}

export async function ensureStatusDir(worktrees: string): Promise<void> {
  await mkdir(worktrees, { recursive: true });
}
