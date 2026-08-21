import { describe, expect, it } from "vitest";
import { buildAssignedNotification } from "../src/services/notification.service.ts";

const now = new Date("2026-07-09T10:00:00Z");
const base = {
  workOrderNumber: "WO100001",
  operatorName: "李主管",
  now,
};

describe("buildAssignedNotification — 首次分配", () => {
  it("names the operator and the ticket, no remaining-time annotation", () => {
    const notification = buildAssignedNotification({
      ...base,
      isFirstAssignment: true,
      dueAt: new Date("2026-07-11T10:00:00Z"),
    });
    expect(notification).toEqual({
      title: "新工单分配",
      content: "李主管 将工单 WO100001 分配给你",
    });
  });
});

describe("buildAssignedNotification — 改派 (标注剩余时间)", () => {
  function reassigned(dueAt: Date | null) {
    return buildAssignedNotification({ ...base, isFirstAssignment: false, dueAt });
  }

  it("annotates hours + minutes until dueAt", () => {
    expect(reassigned(new Date("2026-07-10T21:20:00Z"))).toEqual({
      title: "工单改派",
      content: "李主管 将工单 WO100001 改派给你（剩余处理时间 35 小时 20 分钟）",
    });
  });

  it("omits the zero component: whole hours / under an hour", () => {
    expect(reassigned(new Date("2026-07-11T10:00:00Z")).content).toContain(
      "（剩余处理时间 48 小时）",
    );
    expect(reassigned(new Date("2026-07-09T10:45:00Z")).content).toContain(
      "（剩余处理时间 45 分钟）",
    );
  });

  it("floors to whole minutes and marks the sub-minute edge as 不足 1 分钟", () => {
    expect(reassigned(new Date("2026-07-09T10:45:30Z")).content).toContain(
      "（剩余处理时间 45 分钟）",
    );
    expect(reassigned(new Date("2026-07-09T10:00:59Z")).content).toContain(
      "（剩余处理时间不足 1 分钟）",
    );
  });

  it("states the overshoot for already-overdue tickets", () => {
    expect(reassigned(new Date("2026-07-09T07:55:00Z")).content).toContain(
      "（已超时 2 小时 5 分钟）",
    );
    expect(reassigned(now).content).toContain("（已超时不足 1 分钟）");
  });

  it("states 无处理时限 when the ticket has no deadline (特急)", () => {
    expect(reassigned(null).content).toBe("李主管 将工单 WO100001 改派给你（无处理时限）");
  });
});
