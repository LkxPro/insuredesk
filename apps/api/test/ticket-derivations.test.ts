import {
  DEFAULT_SLA_POLICIES,
  deriveDisplayStatus,
  formatFirstResponseRequirement,
  formatFollowUpFrequency,
} from "@insuredesk/shared";
import { describe, expect, it } from "vitest";

/**
 * Pure derivation helpers behind ticket creation and the detail read
 * (issue #22): SLA-config → human-readable requirement strings, and the
 * read-time display status (PRD §3.1.6). No database needed.
 */

describe("formatFirstResponseRequirement", () => {
  it("renders the level's red-line minutes", () => {
    expect(formatFirstResponseRequirement(120)).toBe("120分钟内完成首次响应");
    expect(formatFirstResponseRequirement(30)).toBe("30分钟内完成首次响应");
  });
});

describe("formatFollowUpFrequency", () => {
  it("renders checkpoint rules cumulatively, joined with ；", () => {
    expect(formatFollowUpFrequency(DEFAULT_SLA_POLICIES.一般投诉.reminderRules)).toBe(
      "24小时内累计跟进1次；48小时内累计跟进2次",
    );
  });

  it("renders the 特急 rolling rule after its checkpoints", () => {
    expect(formatFollowUpFrequency(DEFAULT_SLA_POLICIES.特急投诉.reminderRules)).toBe(
      "24小时内累计跟进2次；48小时内累计跟进4次；每12小时至少跟进1次直至完结",
    );
  });
});

describe("deriveDisplayStatus (PRD §3.1.6 computed statuses)", () => {
  const dueAt = new Date("2026-07-11T10:00:00Z");
  const msBeforeDue = (ms: number) => new Date(dueAt.getTime() - ms);
  const HOUR = 60 * 60 * 1000;

  it("keeps the stored status while 2h or more remain (exactly 2h is not 不足)", () => {
    expect(deriveDisplayStatus("unassigned", dueAt, msBeforeDue(3 * HOUR))).toBe("unassigned");
    expect(deriveDisplayStatus("processing", dueAt, msBeforeDue(2 * HOUR))).toBe("processing");
  });

  it("shows pending_timeout when less than 2h remain, up to and including the dueAt instant", () => {
    expect(deriveDisplayStatus("assigned", dueAt, msBeforeDue(2 * HOUR - 1))).toBe(
      "pending_timeout",
    );
    expect(deriveDisplayStatus("unassigned", dueAt, msBeforeDue(1))).toBe("pending_timeout");
    // 已超过 means strictly past: at dueAt itself the ticket is not overdue yet
    expect(deriveDisplayStatus("unassigned", dueAt, dueAt)).toBe("pending_timeout");
  });

  it("shows overdue strictly past dueAt — unassigned tickets are on the clock too (ADR 0002)", () => {
    expect(deriveDisplayStatus("unassigned", dueAt, msBeforeDue(-1))).toBe("overdue");
    expect(deriveDisplayStatus("processing", dueAt, msBeforeDue(-HOUR))).toBe("overdue");
  });

  it("never overrides completed, and never computes without a dueAt (特急)", () => {
    expect(deriveDisplayStatus("completed", dueAt, msBeforeDue(-HOUR))).toBe("completed");
    expect(deriveDisplayStatus("processing", null, msBeforeDue(-HOUR))).toBe("processing");
  });
});
