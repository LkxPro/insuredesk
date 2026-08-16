import assert from "node:assert/strict";
import { test } from "node:test";
import { daemonShouldKill, renderStatusRow, type WorkerStatus } from "./status.ts";

const base = (over: Partial<WorkerStatus>): WorkerStatus => ({
  issue: 7,
  pid: 1,
  phase: "implementation",
  phaseSince: 0,
  turns: 0,
  lastEvent: null,
  updatedAt: 0,
  ...over,
});

// 默认窗口:stall 600s(=AGENT_NUDGE_AFTER),daemon 杀边界 = 600+600=1200s。
test("daemonShouldKill: claude 相在软干预窗口内不杀,窗口耗尽才杀", () => {
  const now = 100_000_000;
  const inWindow = base({ lastEvent: { ts: now - 610_000, kind: "Bash", summary: "" } });
  assert.equal(daemonShouldKill(inWindow, now), false);
  const expired = base({ lastEvent: { ts: now - 1210_000, kind: "Bash", summary: "" } });
  assert.equal(daemonShouldKill(expired, now), true);
});

test("daemonShouldKill: check/publish 相不让窗,卡即杀", () => {
  const now = 100_000_000;
  const check = base({ phase: "check", phaseSince: now - 1900_000 });
  assert.equal(daemonShouldKill(check, now), true);
  const publish = base({ phase: "publish", phaseSince: now - 700_000 });
  assert.equal(daemonShouldKill(publish, now), true);
});

test("daemonShouldKill: 无 stall 或已终态不杀", () => {
  const now = 100_000_000;
  assert.equal(
    daemonShouldKill(base({ lastEvent: { ts: now - 5_000, kind: "Bash", summary: "" } }), now),
    false,
  );
  assert.equal(daemonShouldKill(base({ phase: "done", phaseSince: now - 9_000_000 }), now), false);
});

test("renderStatusRow: 有 summary 时显示工具操作对象,没有回退 kind", () => {
  const now = 100_000_000;
  const withSummary = renderStatusRow(
    base({ lastEvent: { ts: now - 5_000, kind: "Bash", summary: "Bash(pnpm test)" } }),
    now,
  );
  assert.ok(withSummary.includes("Bash(pnpm test)"));
  const withoutSummary = renderStatusRow(
    base({ lastEvent: { ts: now - 5_000, kind: "thinking", summary: "" } }),
    now,
  );
  assert.ok(withoutSummary.includes("thinking"));
});
