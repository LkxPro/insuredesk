import { describe, expect, it } from "vitest";
import { DEFAULT_SLA_POLICIES } from "../sla";
import { deriveDueAt } from "./derive";
import {
  describeReminderRule,
  formatDuration,
  formatFirstResponseRequirement,
  formatFollowUpFrequency,
} from "./describe";
import { evaluateTicketSla } from "./evaluate";
import { type ReminderRule, normalizeReminderRules } from "./policy";
import {
  SLA_POLICY_VALIDATION_MESSAGES as MSG,
  type SlaPolicyDraft,
  validateSlaPolicy,
} from "./validate";

/**
 * Table-driven tests over the rule-engine's public interface (issue #47),
 * locking the boundary behavior the integration suites established: explicit
 * `now`/`createdAt`/comment summaries in, observable derivations, alerts, and
 * copy out — no database, no system clock.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const createdAt = new Date("2026-07-09T02:00:00.000Z");
const at = (offsetMs: number) => new Date(createdAt.getTime() + offsetMs);

/** 一般投诉-shaped policy: 红线 120min, checkpoints {24h,1,提前60m} {48h,2,提前180m}. */
const generalPolicy = DEFAULT_SLA_POLICIES.一般投诉;
/** 特急投诉-shaped policy: rolling every 12h, no deadline. */
const urgentPolicy = DEFAULT_SLA_POLICIES.特急投诉;

const openTicket = {
  status: "assigned" as const,
  createdAt,
  dueAt: deriveDueAt(createdAt, generalPolicy.overdueHours),
  commentCount: 0,
  lastCommentAt: null,
};

describe("deriveDueAt (PRD §9.2 THE dueAt formula)", () => {
  it.each([
    { overdueHours: 48, expected: at(48 * HOUR) },
    { overdueHours: 72, expected: at(72 * HOUR) },
    { overdueHours: null, expected: null },
  ])("createdAt + $overdueHours h → $expected", ({ overdueHours, expected }) => {
    expect(deriveDueAt(createdAt, overdueHours)).toEqual(expected);
  });
});

describe("evaluateTicketSla / 待首响 (常驻 + 染红阈值)", () => {
  it.each([
    { name: "presence needs no threshold", offset: MINUTE, severity: "warning" },
    {
      name: "exactly on the red line stays warning (超过 is strict)",
      offset: 120 * MINUTE,
      severity: "warning",
    },
    {
      name: "1ms past the red line turns critical",
      offset: 120 * MINUTE + 1,
      severity: "critical",
    },
  ])("$name", ({ offset, severity }) => {
    const alerts = evaluateTicketSla(generalPolicy, openTicket, at(offset));
    expect(alerts[0]).toMatchObject({ type: "awaiting_first_response", severity });
  });

  it("drops out at the first comment", () => {
    const alerts = evaluateTicketSla(
      generalPolicy,
      { ...openTicket, commentCount: 1, lastCommentAt: at(10 * MINUTE) },
      at(130 * MINUTE),
    );
    expect(alerts.map((a) => a.type)).not.toContain("awaiting_first_response");
  });

  it("degrades without a policy (未定级/missing row): present but never critical", () => {
    const alerts = evaluateTicketSla(null, { ...openTicket, dueAt: null }, at(1000 * HOUR));
    expect(alerts).toMatchObject([{ type: "awaiting_first_response", severity: "warning" }]);
  });

  it("reports the waited duration in the message", () => {
    const alerts = evaluateTicketSla(generalPolicy, openTicket, at(35 * HOUR + 20 * MINUTE));
    expect(alerts[0]?.message).toBe("尚未首次跟进，已等待 35 小时 20 分钟");
  });
});

describe("evaluateTicketSla / follow_up_checkpoint (窗口两端 + 累计口径)", () => {
  const typesAt = (offset: number, commentCount = 0) =>
    evaluateTicketSla(
      generalPolicy,
      { ...openTicket, commentCount, lastCommentAt: commentCount > 0 ? at(MINUTE) : null },
      at(offset),
    ).map((a) => a.type);

  it.each([
    { name: "before the window opens", offset: 23 * HOUR - 1, inWindow: false },
    { name: "window start is inclusive (checkpoint − advance)", offset: 23 * HOUR, inWindow: true },
    { name: "last instant inside the window", offset: 24 * HOUR - 1, inWindow: true },
    {
      name: "checkpoint instant is exclusive — a passed window never matches again",
      offset: 24 * HOUR,
      inWindow: false,
    },
  ])("$name", ({ offset, inWindow }) => {
    expect(typesAt(offset).includes("follow_up_checkpoint")).toBe(inWindow);
  });

  it("a met cumulative count silences the checkpoint", () => {
    expect(typesAt(23.5 * HOUR, 1)).not.toContain("follow_up_checkpoint");
  });

  it("later checkpoints judge the cumulative tally with their own requiredCount", () => {
    const alerts = evaluateTicketSla(
      generalPolicy,
      { ...openTicket, commentCount: 1, lastCommentAt: at(MINUTE) },
      at(45 * HOUR),
    );
    expect(alerts).toMatchObject([
      {
        type: "follow_up_checkpoint",
        severity: "warning",
        message: "48 小时检查点将至：已跟进 1/2 次",
      },
    ]);
  });
});

describe("evaluateTicketSla / rolling_follow_up (以上一条 comment 为基准)", () => {
  const urgentTicket = { ...openTicket, dueAt: null };
  const lastCommentAt = at(2 * HOUR);
  const commented = { ...urgentTicket, commentCount: 1, lastCommentAt };

  it("never rolls before the first comment — 待首响 already covers the ticket", () => {
    const alerts = evaluateTicketSla(urgentPolicy, urgentTicket, at(13 * HOUR));
    expect(alerts.map((a) => a.type)).toEqual(["awaiting_first_response"]);
  });

  it.each([
    { name: "1ms short of the interval", gap: 12 * HOUR - 1, fires: false },
    { name: "满 intervalHours is inclusive", gap: 12 * HOUR, fires: true },
  ])("$name", ({ gap, fires }) => {
    const alerts = evaluateTicketSla(
      urgentPolicy,
      commented,
      new Date(lastCommentAt.getTime() + gap),
    );
    expect(alerts.some((a) => a.type === "rolling_follow_up")).toBe(fires);
  });

  it("fires critical with the gap and cadence in the message", () => {
    const alerts = evaluateTicketSla(
      urgentPolicy,
      commented,
      new Date(lastCommentAt.getTime() + 13 * HOUR),
    );
    expect(alerts).toMatchObject([
      {
        type: "rolling_follow_up",
        severity: "critical",
        message: "距上次跟进已 13 小时，要求每 12 小时跟进",
      },
    ]);
  });
});

describe("evaluateTicketSla / due_soon & overdue (严格边界, ADR 0001 单一真源)", () => {
  // Two comments satisfy 待首响 and both 一般投诉 checkpoints, isolating the
  // deadline predicates — mirroring the todo integration test's setup.
  const quietTicket = { ...openTicket, commentCount: 2, lastCommentAt: at(MINUTE) };
  const typesAt = (offset: number) =>
    evaluateTicketSla(generalPolicy, quietTicket, at(offset)).map((a) => a.type);

  it.each([
    { name: "exactly 2h remaining is not 不足", offset: 46 * HOUR, expected: [] },
    { name: "1ms into the 2h window", offset: 46 * HOUR + 1, expected: ["due_soon"] },
    {
      name: "the dueAt instant itself is still due_soon",
      offset: 48 * HOUR,
      expected: ["due_soon"],
    },
    { name: "strictly past dueAt is overdue", offset: 48 * HOUR + 1, expected: ["overdue"] },
  ])("$name", ({ offset, expected }) => {
    expect(typesAt(offset)).toEqual(expected);
  });

  it("overdue is critical and reports how far past the deadline", () => {
    const alerts = evaluateTicketSla(generalPolicy, quietTicket, at(50 * HOUR));
    expect(alerts).toMatchObject([
      { type: "overdue", severity: "critical", message: "已超过处理时限 2 小时" },
    ]);
  });

  it("due_soon is a warning with the fixed-window message", () => {
    const alerts = evaluateTicketSla(generalPolicy, quietTicket, at(47 * HOUR));
    expect(alerts).toMatchObject([
      { type: "due_soon", severity: "warning", message: "距处理时限不足 2 小时" },
    ]);
  });

  it("a null dueAt never computes due_soon/overdue, however far time goes", () => {
    const alerts = evaluateTicketSla(
      urgentPolicy,
      { ...quietTicket, commentCount: 4, dueAt: null },
      at(1000 * HOUR),
    );
    expect(alerts.map((a) => a.type)).toEqual(["rolling_follow_up"]);
  });

  it("keeps working off the stored dueAt when the policy is missing (degraded path)", () => {
    const alerts = evaluateTicketSla(null, quietTicket, at(49 * HOUR));
    expect(alerts.map((a) => a.type)).toEqual(["overdue"]);
  });

  it("completed stops every alert type", () => {
    const overdueButDone = { ...openTicket, status: "completed" as const };
    expect(evaluateTicketSla(generalPolicy, overdueButDone, at(1000 * HOUR))).toEqual([]);
  });
});

describe("evaluateTicketSla / alert order is stable", () => {
  it("待首响 first, then rules in policy order, then the deadline alert", () => {
    // 47h30m into a 一般投诉 ticket with no comments: red-line passed, the
    // 48h checkpoint window is open, and the 2h due window has started.
    const alerts = evaluateTicketSla(generalPolicy, openTicket, at(47 * HOUR + 30 * MINUTE));
    expect(alerts.map((a) => a.type)).toEqual([
      "awaiting_first_response",
      "follow_up_checkpoint",
      "due_soon",
    ]);
  });
});

describe("validateSlaPolicy (the one canonical implementation)", () => {
  const checkpoint = (patch: Partial<ReminderRule & { type: "follow_up_checkpoint" }> = {}) => ({
    type: "follow_up_checkpoint" as const,
    checkpointHours: 24,
    requiredCount: 1,
    advanceMinutes: 60,
    ...patch,
  });
  const base: SlaPolicyDraft = {
    firstResponseMinutes: 120,
    overdueHours: 48,
    reminderRules: [],
  };

  it("accepts every seed default policy", () => {
    for (const policy of Object.values(DEFAULT_SLA_POLICIES)) {
      expect(validateSlaPolicy(policy)).toEqual([]);
    }
  });

  it.each([
    {
      name: "firstResponseMinutes must be a positive integer",
      draft: { ...base, firstResponseMinutes: 0 },
      path: ["firstResponseMinutes"],
      message: MSG.firstResponseMinutes,
    },
    {
      name: "a NaN field (form parse failure) lands in the same positivity issue",
      draft: { ...base, firstResponseMinutes: Number.NaN },
      path: ["firstResponseMinutes"],
      message: MSG.firstResponseMinutes,
    },
    {
      name: "overdueHours rejects non-positive when set",
      draft: { ...base, overdueHours: 0 },
      path: ["overdueHours"],
      message: MSG.overdueHours,
    },
    {
      name: "checkpointHours must be a positive integer",
      draft: { ...base, reminderRules: [checkpoint({ checkpointHours: 0 })] },
      path: ["reminderRules", 0, "checkpointHours"],
      message: MSG.checkpointHours,
    },
    {
      name: "requiredCount must be a positive integer",
      draft: { ...base, reminderRules: [checkpoint({ requiredCount: 1.5 })] },
      path: ["reminderRules", 0, "requiredCount"],
      message: MSG.requiredCount,
    },
    {
      name: "advanceMinutes = 0 is a dead rule (empty alert window)",
      draft: { ...base, reminderRules: [checkpoint({ advanceMinutes: 0 })] },
      path: ["reminderRules", 0, "advanceMinutes"],
      message: MSG.advanceMinutes,
    },
    {
      name: "advance at the checkpoint itself is rejected",
      draft: {
        ...base,
        reminderRules: [checkpoint({ checkpointHours: 1, advanceMinutes: 60 })],
      },
      path: ["reminderRules", 0, "advanceMinutes"],
      message: MSG.advanceBelowCheckpoint,
    },
    {
      name: "equal checkpoint hours are duplicates, not a sort",
      draft: { ...base, reminderRules: [checkpoint(), checkpoint()] },
      path: ["reminderRules", 1, "checkpointHours"],
      message: MSG.checkpointOrder,
    },
    {
      name: "checkpoints must be strictly ascending in list order",
      draft: {
        ...base,
        reminderRules: [checkpoint({ checkpointHours: 48 }), checkpoint({ checkpointHours: 24 })],
      },
      path: ["reminderRules", 1, "checkpointHours"],
      message: MSG.checkpointOrder,
    },
    {
      name: "cumulative counts must not shrink across checkpoints",
      draft: {
        ...base,
        reminderRules: [
          checkpoint({ requiredCount: 2 }),
          checkpoint({ checkpointHours: 48, requiredCount: 1 }),
        ],
      },
      path: ["reminderRules", 1, "requiredCount"],
      message: MSG.cumulativeCount,
    },
    {
      name: "rolling follow-up is a singleton",
      draft: {
        ...base,
        reminderRules: [
          { type: "rolling_follow_up" as const, intervalHours: 12 },
          { type: "rolling_follow_up" as const, intervalHours: 6 },
        ],
      },
      path: ["reminderRules", 1, "intervalHours"],
      message: MSG.singletonRolling,
    },
    {
      name: "rolling intervalHours must be a positive integer",
      draft: {
        ...base,
        reminderRules: [{ type: "rolling_follow_up" as const, intervalHours: 0 }],
      },
      path: ["reminderRules", 0, "intervalHours"],
      message: MSG.intervalHours,
    },
    {
      name: "unknown rule types are rejected, never skipped",
      draft: { ...base, reminderRules: [{ type: "escalate_to_supervisor" }] },
      path: ["reminderRules", 0, "type"],
      message: MSG.unknownRuleType,
    },
  ])("$name", ({ draft, path, message }) => {
    expect(validateSlaPolicy(draft)).toContainEqual({ path, message });
  });

  it("accepts advance one minute below the checkpoint and equal cumulative counts", () => {
    expect(
      validateSlaPolicy({
        ...base,
        reminderRules: [
          checkpoint({ checkpointHours: 1, advanceMinutes: 59 }),
          checkpoint({ checkpointHours: 2, requiredCount: 1, advanceMinutes: 30 }),
        ],
      }),
    ).toEqual([]);
  });

  it("accepts a null overdueHours (不设超时)", () => {
    expect(validateSlaPolicy({ ...base, overdueHours: null })).toEqual([]);
  });
});

describe("normalizeReminderRules (storage boundary)", () => {
  it("round-trips the canonical shape", () => {
    expect(normalizeReminderRules(urgentPolicy.reminderRules)).toEqual(urgentPolicy.reminderRules);
  });

  it("throws on unknown rule types — old code must not misread new configs", () => {
    expect(() => normalizeReminderRules([{ type: "escalate", hours: 1 }])).toThrow();
  });
});

describe("descriptions (single source of SLA copy)", () => {
  it("formats the ticket-stamped requirement strings", () => {
    expect(formatFirstResponseRequirement(120)).toBe("120分钟内完成首次响应");
    expect(formatFollowUpFrequency(generalPolicy.reminderRules)).toBe(
      "24小时内累计跟进1次；48小时内累计跟进2次",
    );
    expect(formatFollowUpFrequency(urgentPolicy.reminderRules)).toBe(
      "24小时内累计跟进2次；48小时内累计跟进4次；每12小时至少跟进1次直至完结",
    );
  });

  it("describes single rules for the admin page", () => {
    expect(describeReminderRule(generalPolicy.reminderRules[0] as ReminderRule)).toBe(
      "24 小时内累计跟进 1 次，提前 60 分钟提醒",
    );
    expect(describeReminderRule({ type: "rolling_follow_up", intervalHours: 12 })).toBe(
      "距上次跟进每满 12 小时提醒，直至完结",
    );
  });

  it.each([
    { ms: 30_000, expected: "不足 1 分钟" },
    { ms: 59 * MINUTE, expected: "59 分钟" },
    { ms: 2 * HOUR, expected: "2 小时" },
    { ms: 35 * HOUR + 20 * MINUTE + 30_000, expected: "35 小时 20 分钟" },
  ])("formatDuration($ms) → $expected", ({ ms, expected }) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
