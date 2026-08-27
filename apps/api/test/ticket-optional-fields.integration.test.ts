import {
  type Permission,
  TICKET_CREATE_FIELD_KEYS,
  TICKET_SOURCES,
  type TicketCreateInput,
  type TicketEditInput,
} from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/routers/index.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

const HOUR_MS = 60 * 60 * 1000;

describe("optional business fields (Testcontainers)", () => {
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

  function callerFor(user: User, role: Role) {
    return appRouter.createCaller({
      traceId: "optional-fields-test",
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
        isExternal: false,
      },
      sessionToken: null,
    });
  }

  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);

  const DETAIL_COLUMNS = TICKET_CREATE_FIELD_KEYS.filter(
    (key) => key !== "contactPhone" && key !== "slaPolicyId",
  );
  const CORE_COLUMNS = ["contactPhone", "slaPolicyId"] as const;
  const NULLABLE_COLUMNS = TICKET_CREATE_FIELD_KEYS;

  function blankEditInput(ticketId: string, overrides: Partial<TicketEditInput> = {}) {
    const blank = Object.fromEntries(NULLABLE_COLUMNS.map((column) => [column, null]));
    return { ...blank, ticketId, ...overrides } as TicketEditInput;
  }

  describe("完全空白提交", () => {
    it("creates from an empty payload: nulls persisted, system fields generated, no SLA stamps", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);
      expect(created.workOrderNumber).toMatch(/^WO\d{6,}$/);

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
      const detail = await prisma.ticketComplaintDetail.findUniqueOrThrow({
        where: { ticketId: created.id },
      });
      for (const column of DETAIL_COLUMNS) {
        if (column === "policyNumbers") {
          // 多值字段没有 null 态：未填写＝空数组
          expect(detail[column], column).toEqual([]);
        } else {
          expect(detail[column], column).toBeNull();
        }
      }
      for (const column of CORE_COLUMNS) {
        expect(row[column], column).toBeNull();
      }
      expect(row.source).toBe("manual");
      expect(row.creatorId).toBe(seeded.users.manager.id);
      expect(row.status).toBe("unassigned");
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.dueAt).toBeNull();
      expect(row.followUpFrequency).toBeNull();
      expect(row.firstResponseRequirement).toBeNull();
      const logs = await prisma.processLog.findMany({ where: { ticketId: created.id } });
      expect(logs.map((log) => log.action)).toEqual(["create"]);
    });

    it('empty strings and whitespace normalize to NULL, never persist as ""', async () => {
      const created = await manager().ticket.create({
        feedbackTime: "",
        channelId: "",
        project: "   ",
        customerName: "",
        priority: "",
      } as TicketCreateInput);

      const detail = await prisma.ticketComplaintDetail.findUniqueOrThrow({
        where: { ticketId: created.id },
      });
      expect(detail.feedbackTime).toBeNull();
      expect(detail.channelId).toBeNull();
      expect(detail.project).toBeNull();
      expect(detail.customerName).toBeNull();
      expect(detail.priority).toBeNull();
    });

    it("hasContacted unfilled is unknown (null), explicitly false stays false", async () => {
      const unknown = await manager().ticket.create({} as TicketCreateInput);
      const explicit = await manager().ticket.create({ hasContacted: false } as TicketCreateInput);

      const unknownRow = await prisma.ticketComplaintDetail.findUniqueOrThrow({
        where: { ticketId: unknown.id },
      });
      const explicitRow = await prisma.ticketComplaintDetail.findUniqueOrThrow({
        where: { ticketId: explicit.id },
      });
      expect(unknownRow.hasContacted).toBeNull();
      expect(explicitRow.hasContacted).toBe(false);
    });
  });

  describe("未定级工单的 SLA 与告警", () => {
    it("未指定时效策略 → no dueAt, no requirement strings, and no SLA time alerts in 我的待办 beyond 待首响", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);
      await manager().ticket.assign({ ticketId: created.id, assigneeId: seeded.users.cs1.id });
      // Backdate far past every level's thresholds: were any SLA rule active,
      // it would fire — a 未定级 ticket must raise none of them.
      await prisma.ticket.update({
        where: { id: created.id },
        data: { createdAt: new Date(Date.now() - 100 * HOUR_MS) },
      });

      const { listMyTodos } = await import("../src/services/todo.service.ts");
      const todos = await listMyTodos(
        { prisma, clock: { now: () => new Date() } },
        {
          id: seeded.users.cs1.id,
          username: seeded.users.cs1.username,
          name: seeded.users.cs1.name,
          email: seeded.users.cs1.email,
          team: seeded.users.cs1.team,
          roleId: seeded.roles.frontline.id,
          roleName: seeded.roles.frontline.name,
          permissions: seeded.roles.frontline.permissions as Permission[],
          requiredTicketFields: [],
          isExternal: false,
        },
      );
      const entry = todos.items.find((item) => item.ticketId === created.id);
      // 待首响 is policy-free and keeps working; without a level's red line it
      // can never escalate past warning, and no checkpoint/rolling/due alert
      // exists to accompany it.
      expect(entry).toBeDefined();
      expect(entry?.alerts.map((alert) => alert.type)).toEqual(["awaiting_first_response"]);
      expect(entry?.severity).toBe("warning");
    });

    it("a later 时效策略 edit computes SLA off the ORIGINAL createdAt", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);
      const createdAt = new Date(Date.now() - 70 * HOUR_MS);
      await prisma.ticket.update({
        where: { id: created.id },
        data: { createdAt, slaAnchorAt: createdAt },
      });

      await manager().ticket.editComplaint(
        blankEditInput(created.id, { slaPolicyId: harness.slaPolicyId("一般投诉") }),
      );

      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.dueAt).toBe(new Date(createdAt.getTime() + 48 * HOUR_MS).toISOString());
      expect(detail.displayStatus).toBe("overdue");
      expect(detail.firstResponseRequirement).toBe("120分钟内完成首次响应");
    });

    it("clearing the 策略引用 clears the SLA stamps again", async () => {
      const created = await manager().ticket.create({
        slaPolicyId: harness.slaPolicyId("一般投诉"),
      } as TicketCreateInput);
      expect((await manager().ticket.detail({ id: created.id })).dueAt).not.toBeNull();

      await manager().ticket.editComplaint(blankEditInput(created.id));

      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.slaPolicyId).toBeNull();
      expect(detail.dueAt).toBeNull();
      expect(detail.followUpFrequency).toBeNull();
      expect(detail.firstResponseRequirement).toBeNull();
    });
  });

  describe("逐步补齐", () => {
    it("edits one field at a time without demanding the other blanks", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);

      const first = await manager().ticket.editComplaint(
        blankEditInput(created.id, { customerName: "陈晓" }),
      );
      expect(first.changedFields).toEqual(["customerName"]);

      const second = await manager().ticket.editComplaint(
        blankEditInput(created.id, { customerName: "陈晓", phone: "13800001234" }),
      );
      expect(second.changedFields).toEqual(["phone"]);

      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.customerName).toBe("陈晓");
      expect(detail.phone).toBe("13800001234");
      expect(detail.channel).toBeNull();
    });
  });

  describe("分配", () => {
    it("manual assignment works with no channel", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);

      const result = await manager().ticket.assign({
        ticketId: created.id,
        assigneeId: seeded.users.cs1.id,
      });
      expect(result.status).toBe("assigned");
    });
  });

  describe("列表 / 详情 / 导出安全读取空值", () => {
    it("list and detail serialize a blank ticket with nulls, not crashes", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);

      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail).toMatchObject({
        channel: null,
        customerName: null,
        slaPolicyId: null,
        hasContacted: null,
        feedbackTime: null,
        dueAt: null,
        followUpFrequency: null,
        firstResponseRequirement: null,
      });

      const { items } = await manager().ticket.list({ search: created.workOrderNumber });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        customerName: null,
        policyNumbers: [],
        channel: null,
        slaPolicyId: null,
        dueAt: null,
      });
    });

    it("export renders unfilled fields as empty cells", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);

      const { exportTickets } = await import("../src/services/ticket-export.service.ts");
      const complaintKindId = (
        await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } })
      ).id;
      const file = await exportTickets(
        { prisma, clock: { now: () => new Date() } },
        {
          id: seeded.users.manager.id,
          username: seeded.users.manager.username,
          name: seeded.users.manager.name,
          email: seeded.users.manager.email,
          team: seeded.users.manager.team,
          roleId: seeded.roles.csManager.id,
          roleName: seeded.roles.csManager.name,
          permissions: seeded.roles.csManager.permissions as Permission[],
          requiredTicketFields: [],
          isExternal: false,
        },
        {
          format: "csv",
          kindId: [complaintKindId],
          source: [...TICKET_SOURCES],
          search: created.workOrderNumber,
          sortBy: "createdAt",
          sortOrder: "desc",
        },
      );
      const body = file.body.toString("utf8");
      const lines = body.replace(/^﻿/, "").trimEnd().split("\r\n");
      expect(lines).toHaveLength(2);
      expect(lines[1]?.startsWith(created.workOrderNumber)).toBe(true);
      expect(body).not.toContain("null");
    });
  });
});
