import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Phase =
  | "implementation"
  | "review"
  | "check-wait"
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
// 单个 Bash tool call 可合法跑数十分钟,与楔死无法靠静默区分。
const CLAUDE_BASH_STALL_SECONDS =
  Number.parseInt(process.env.AGENT_STALL_CLAUDE_BASH_SECONDS ?? "1800", 10) || 1800;
const CHECK_STALL_SECONDS =
  Number.parseInt(process.env.AGENT_STALL_CHECK_SECONDS ?? "1800", 10) || 1800;
// 等锁判死窗口 = (并发槽-1) × check 超时 + 余量:合法等锁最坏是排在全部其他槽之后。
const CHECK_WAIT_STALL_SECONDS =
  Number.parseInt(process.env.AGENT_STALL_CHECK_WAIT_SECONDS ?? "", 10) ||
  ((Number.parseInt(process.env.AGENT_LOOP_MAX_PARALLEL ?? "4", 10) || 4) - 1) *
    (Number.parseInt(process.env.AGENT_CHECK_TIMEOUT_SECONDS ?? "1800", 10) || 1800) +
    600;
// publish 是一串带退避重试的网络调用(claim 校验风暴帽 600s + fence/push/PR),
// 窗口必须盖住风暴期合法重试总预算,否则合法发布被杀成重排队循环。
const PUBLISH_STALL_SECONDS =
  Number.parseInt(process.env.AGENT_STALL_PUBLISH_SECONDS ?? "1800", 10) || 1800;

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

// 长票的原始流可达数十 MB(完整 assistant 文本):落盘字段截断,事后调试仍够用。
const truncateDeep = (value: unknown, depth: number): unknown => {
  if (typeof value === "string")
    return value.length > 2000
      ? `${value.slice(0, 2000)}…[truncated ${value.length - 2000} chars]`
      : value;
  if (depth <= 0 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => truncateDeep(item, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = truncateDeep(item, depth - 1);
  return out;
};

export async function appendEvent(
  worktrees: string,
  issue: number,
  event: Record<string, unknown>,
): Promise<void> {
  await appendFile(eventsFileOf(worktrees, issue), `${JSON.stringify(truncateDeep(event, 8))}\n`);
}

export interface Health {
  stuck: boolean;
  reason: string;
}

// 最后事件是 Bash 时放宽软干预起点:Bash 长跑期间没有中间事件,nudge 也只能等它结束。
export function nudgeWindowSeconds(lastEventKind?: string): { after: number; grace: number } {
  const read = (key: string, fallback: number) => {
    const value = Number.parseInt(process.env[key] ?? "", 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  const bash = (lastEventKind ?? "").split(",").includes("Bash");
  return {
    after: bash
      ? read("AGENT_NUDGE_BASH_AFTER_SECONDS", CLAUDE_BASH_STALL_SECONDS)
      : read("AGENT_NUDGE_AFTER_SECONDS", CLAUDE_STALL_SECONDS),
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
  if (status.phase === "check-wait") {
    if (ageSeconds(status.phaseSince) > CHECK_WAIT_STALL_SECONDS)
      return {
        stuck: true,
        reason: `waiting for check lock for ${Math.floor(ageSeconds(status.phaseSince) / 60)}min`,
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
  const { after } = nudgeWindowSeconds(status.lastEvent?.kind);
  if (ageSeconds(lastTs) > after)
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
  if (status.phase === "check" || status.phase === "check-wait" || status.phase === "publish")
    return true;
  const { after, grace } = nudgeWindowSeconds(status.lastEvent?.kind);
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
