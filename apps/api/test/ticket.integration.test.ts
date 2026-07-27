import {
  COMPLAINT_LEVELS,
  DEFAULT_SLA_POLICIES,
  type Permission,
  type TicketCreateInput,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Acceptance tests against a real Postgres: work-order sequence
 * (incl. concurrency), dueAt fixed from the SLA config at creation, the
 * `create` ProcessLog, the SLAPolicy seed, RBAC rejection, and the
 * data-scoped detail read. Runs through appRouter.createCaller — the same
 * procedure pipeline (permission middleware included) the HTTP adapter uses.
 */
describe("ticket creation + detail (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    prisma = harness.prisma;
    seeded = harness.seeded;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  /** Caller with the given user identity and an explicit permission set. */
  function callerWith(user: User, roleName: string, permissions: Permission[]) {
    return appRouter.createCaller({
      traceId: "ticket-test",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        team: user.team,
        roleId: "role-under-test",
        roleName,
        permissions,
        requiredTicketFields: [],
      },
      sessionToken: null,
    });
  }

  /** Caller with the given seeded user's identity, permissions from their role. */
  function callerFor(user: User, role: Role) {
    return appRouter.createCaller({
      traceId: "ticket-test",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        team: user.team,
        roleId: role.id,
        roleName: role.name,
        permissions: role.permissions as Permission[],
        requiredTicketFields: [],
      },
      sessionToken: null,
    });
  }

  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);
  const frontline = () => callerFor(seeded.users.cs1, seeded.roles.frontline);
  const observer = () => callerFor(seeded.users.observer, seeded.roles.readOnly);

  const baseInput = {
    feedbackTime: "2026-07-09T02:00:00.000Z",
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    policyNumbers: ["P2026070900123"],
    userComplaintChannel: "400热线",
    customerName: "王小明",
    phone: "13800000000",
    customerRequest: "对保费收取金额有异议，要求核实并回复",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    complaintLevel: "一般投诉",
  } satisfies TicketCreateInput;

  it("seeds exactly one SLAPolicy per complaint level with the expected defaults", async () => {
    const policies = await prisma.slaPolicy.findMany();
    expect(policies).toHaveLength(COMPLAINT_LEVELS.length);

    for (const level of COMPLAINT_LEVELS) {
      const expected = DEFAULT_SLA_POLICIES[level];
      const policy = policies.find((p) => p.complaintLevel === level);
      expect(policy, level).toBeDefined();
      expect(policy?.firstResponseMinutes).toBe(expected.firstResponseMinutes);
      expect(policy?.overdueHours).toBe(expected.overdueHours);
      expect(policy?.reminderRules).toEqual(expected.reminderRules);
    }
  });

  describe("create (一般投诉)", () => {
    it("generates WO+sequence number, fixes dueAt = createdAt + 48h, stamps SLA texts, writes the create log", async () => {
      const created = await manager().ticket.create({
        ...baseInput,
        contactTime: "2026-07-08T13:15:00.000Z",
        complaintReceiveChannel: "监管转办",
      });
      expect(created.workOrderNumber).toMatch(/^WO\d{6,}$/);

      const detail = await manager().ticket.detail({ id: created.id });

      // Base state of a fresh manual ticket
      expect(detail.status).toBe("unassigned");
      expect(detail.displayStatus).toBe("unassigned");
      expect(detail.source).toBe("manual");
      expect(detail.assigneeId).toBeNull();
      expect(detail.contactCount).toBe(0);
      expect(detail.processingResult).toBe("");
      expect(detail.priority).toBeNull(); // free label defaults to empty
      expect(detail.feedbackTime).toBe(baseInput.feedbackTime);
      expect(detail.contactTime).toBe("2026-07-08T13:15:00.000Z");
      expect(detail.complaintReceiveChannel).toBe("监管转办");
      expect("deletedAt" in detail).toBe(false); // soft-delete marker never leaves the API

      // dueAt fixed at creation from the SLA config: exactly createdAt + 48h
      expect(detail.dueAt).not.toBeNull();
      const dueMs = new Date(detail.dueAt as string).getTime();
      const createdMs = new Date(detail.createdAt).getTime();
      expect(dueMs - createdMs).toBe(48 * HOUR_MS);

      // 跟进频次/首响要求 stamped from the level's SLA config, not hardcoded
      expect(detail.firstResponseRequirement).toBe("120分钟内完成首次响应");
      expect(detail.followUpFrequency).toBe("24小时内累计跟进1次；48小时内累计跟进2次");

      // creatorId recorded for source=manual
      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.creatorId).toBe(seeded.users.manager.id);

      // The timeline root: one `create` ProcessLog with an operator-name
      // snapshot, at the same instant as createdAt
      expect(detail.processLogs).toHaveLength(1);
      const log = detail.processLogs[0];
      expect(log?.action).toBe("create");
      expect(log?.operatorId).toBe(seeded.users.manager.id);
      expect(log?.operatorName).toBe(seeded.users.manager.name);
      expect(log?.remark).toBeTruthy();
      expect(log?.at).toBe(detail.createdAt);
    });

    it("derives 由谁创建 from the creator's CURRENT name, while the log keeps the snapshot", async () => {
      const created = await manager().ticket.create(baseInput);

      const originalName = seeded.users.manager.name;
      await prisma.user.update({
        where: { id: seeded.users.manager.id },
        data: { name: "李主管（改名后）" },
      });
      try {
        const detail = await manager().ticket.detail({ id: created.id });
        expect(detail.createdBy).toBe("李主管（改名后）"); // derived at read time
        expect(detail.processLogs[0]?.operatorName).toBe(originalName); // snapshot untouched
      } finally {
        await prisma.user.update({
          where: { id: seeded.users.manager.id },
          data: { name: originalName },
        });
      }
    });
  });

  describe("policyNumbers 多值契约（trim/去空/去重与上限）", () => {
    it("persists multiple values; items are trimmed, blanks dropped, duplicates deduped case-sensitively", async () => {
      const created = await manager().ticket.create({
        ...baseInput,
        policyNumbers: ["  P-001  ", "P-002", "P-001", " ", "p-001"],
      });
      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.policyNumbers).toEqual(["P-001", "P-002", "p-001"]);

      const listed = await manager().ticket.list({ search: created.workOrderNumber });
      expect(listed.items[0]?.policyNumbers).toEqual(["P-001", "P-002", "p-001"]);
    });

    it("empty array and absent field both persist as [] (未填写)", async () => {
      const explicit = await manager().ticket.create({ ...baseInput, policyNumbers: [] });
      expect((await manager().ticket.detail({ id: explicit.id })).policyNumbers).toEqual([]);

      const { policyNumbers: _omitted, ...withoutField } = baseInput;
      const absent = await manager().ticket.create(withoutField);
      expect((await manager().ticket.detail({ id: absent.id })).policyNumbers).toEqual([]);
    });

    it("rejects a single value over 100 chars and more than 50 deduped values", async () => {
      await expect(
        manager().ticket.create({ ...baseInput, policyNumbers: ["P".repeat(101)] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      await expect(
        manager().ticket.create({
          ...baseInput,
          policyNumbers: Array.from({ length: 51 }, (_, i) => `P-${i}`),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      // 上限按去重后计数：50 个不同值加上重复项照常放行
      const fifty = Array.from({ length: 50 }, (_, i) => `P-${i}`);
      const created = await manager().ticket.create({
        ...baseInput,
        policyNumbers: [...fifty, "P-0"],
      });
      expect((await manager().ticket.detail({ id: created.id })).policyNumbers).toEqual(fifty);
    });
  });

  describe("dueAt per complaint level", () => {
    it("加急投诉 → createdAt + 72h", async () => {
      const created = await manager().ticket.create({ ...baseInput, complaintLevel: "加急投诉" });
      const detail = await manager().ticket.detail({ id: created.id });
      const delta =
        new Date(detail.dueAt as string).getTime() - new Date(detail.createdAt).getTime();
      expect(delta).toBe(72 * HOUR_MS);
      expect(detail.firstResponseRequirement).toBe("60分钟内完成首次响应");
    });

    it("特急投诉 → no dueAt at all (never overdue, rolling follow-up drives it)", async () => {
      const created = await manager().ticket.create({ ...baseInput, complaintLevel: "特急投诉" });
      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.dueAt).toBeNull();
      expect(detail.displayStatus).toBe("unassigned"); // no dueAt → nothing to compute
      expect(detail.followUpFrequency).toContain("每12小时至少跟进1次");
    });
  });

  it("concurrent creations never collide on workOrderNumber", async () => {
    const created = await Promise.all(
      Array.from({ length: 10 }, () => manager().ticket.create(baseInput)),
    );
    const numbers = created.map((t) => t.workOrderNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) {
      expect(n).toMatch(/^WO\d{6,}$/);
    }
  });

  it("keeps full digits past sequence value 999999 (no lpad truncation)", async () => {
    // Jump the global sequence to the 6→7 digit boundary; gaps are allowed,
    // so later tests are unaffected.
    await prisma.$executeRaw`SELECT setval('work_order_number_seq', 999999)`;

    const first = await manager().ticket.create(baseInput);
    const second = await manager().ticket.create(baseInput);
    expect(first.workOrderNumber).toBe("WO1000000");
    expect(second.workOrderNumber).toBe("WO1000001");
  });

  describe("RBAC", () => {
    it("rejects create without ticket.create (一线客服, 只读观察)", async () => {
      for (const caller of [frontline(), observer()]) {
        const attempt = caller.ticket.create(baseInput);
        await expect(attempt).rejects.toThrowError(TRPCError);
        await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });

    it("data scope hides other people's tickets from users without ticket.view_all", async () => {
      const created = await manager().ticket.create(baseInput);

      // cs1 holds ticket.view but not ticket.view_all, and the ticket is not
      // assigned to them → invisible, surfaced as NOT_FOUND (no existence leak)
      await expect(frontline().ticket.detail({ id: created.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      // the read-only observer holds ticket.view_all → full detail visible
      const detail = await observer().ticket.detail({ id: created.id });
      expect(detail.workOrderNumber).toBe(created.workOrderNumber);
    });

    it("data scope keeps a creator without ticket.view_all on their manual ticket — unassigned and after handoff", async () => {
      const creator = () =>
        callerWith(seeded.users.cs1, "受限创建人", ["ticket.view", "ticket.create"]);
      const created = await creator().ticket.create(baseInput);

      // Visible to the creator the moment it exists, before any assignment
      const fresh = await creator().ticket.detail({ id: created.id });
      expect(fresh.workOrderNumber).toBe(created.workOrderNumber);
      expect(fresh.assigneeId).toBeNull();

      // Still visible after the ticket is assigned to someone else
      await manager().ticket.assign({ ticketId: created.id, assigneeId: seeded.users.manager.id });
      const handedOff = await creator().ticket.detail({ id: created.id });
      expect(handedOff.assigneeId).toBe(seeded.users.manager.id);

      // A user who is neither creator nor assignee, without ticket.view_all,
      // still gets NOT_FOUND — the scope covers assignee and creator only
      const thirdParty = () => callerWith(seeded.users.observer, "受限第三者", ["ticket.view"]);
      await expect(thirdParty().ticket.detail({ id: created.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
