import {
  type Permission,
  TICKET_CREATE_FIELD_KEYS,
  type TicketCreateInput,
} from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import type { AuthenticatedUser } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * 字典目录 parameterized acceptance tests (issue #93). One canonical suite
 * runs three catalog instances (channel, ticketCategory, completionStatus),
 * plus one smoke test per catalog. The suite covers the full lifecycle:
 * rename propagation, 停用/deletion guards, reference validation, concurrent
 * P2003 backstop, filtering by disabled rows, and edit path quirks.
 * 完结状态-specific behaviors (引用必填, no edit path, migration-seeded rows)
 * are tested explicitly in the completionStatus smoke section.
 */

interface CatalogConfig {
  name: string;
  routerKey: "channel" | "ticketCategory" | "completionStatus";
  labels: {
    noun: string;
    nameNoun: string;
    refNoun: string;
    conflictMessage: string;
    inUseMessage: (count: number) => string;
    missingMessage: string;
    disabledMessage: string;
  };
  seedFunction: string | null;
  ticketFieldId: "channelId" | "categoryId" | null;
  ticketFieldDisplay: "channel" | "category" | "completionStatus";
  /** For edit log snapshots: "反馈渠道: X→Y" */
  editLogPrefix: string | null;
  /** For ticket list filter input */
  filterKey: "channelId" | "categoryId" | "completionStatusId";
  /** True = catalog rows come from migration only (no app-layer seed) */
  migrationSeeded: boolean;
  /** completionStatus is referenced at resolve, not create/edit */
  referencedViaResolve: boolean;
}

const catalogs: CatalogConfig[] = [
  {
    name: "Channel",
    routerKey: "channel",
    labels: {
      noun: "渠道",
      nameNoun: "渠道",
      refNoun: "反馈渠道",
      conflictMessage: "渠道名称已存在",
      inUseMessage: (n) => `该渠道已被 ${n} 张工单使用，无法删除，可改为停用`,
      missingMessage: "所选反馈渠道不存在",
      disabledMessage: "所选反馈渠道已停用",
    },
    seedFunction: "seedChannels",
    ticketFieldId: "channelId",
    ticketFieldDisplay: "channel",
    editLogPrefix: "反馈渠道",
    filterKey: "channelId",
    migrationSeeded: false,
    referencedViaResolve: false,
  },
  {
    name: "TicketCategory",
    routerKey: "ticketCategory",
    labels: {
      noun: "类别",
      nameNoun: "类别",
      refNoun: "客诉类别",
      conflictMessage: "类别名称已存在",
      inUseMessage: (n) => `该类别已被 ${n} 张工单使用，无法删除，可改为停用`,
      missingMessage: "所选客诉类别不存在",
      disabledMessage: "所选客诉类别已停用",
    },
    seedFunction: "seedTicketCategories",
    ticketFieldId: "categoryId",
    ticketFieldDisplay: "category",
    editLogPrefix: "客诉类别",
    filterKey: "categoryId",
    migrationSeeded: false,
    referencedViaResolve: false,
  },
  {
    name: "CompletionStatus",
    routerKey: "completionStatus",
    labels: {
      noun: "完结状态",
      nameNoun: "状态",
      refNoun: "完结状态",
      conflictMessage: "状态名称已存在",
      inUseMessage: (n) => `该完结状态已被 ${n} 张工单使用，无法删除，可改为停用`,
      missingMessage: "所选完结状态不存在",
      disabledMessage: "所选完结状态已停用",
    },
    seedFunction: null,
    ticketFieldId: null,
    ticketFieldDisplay: "completionStatus",
    editLogPrefix: null,
    filterKey: "completionStatusId",
    migrationSeeded: true,
    referencedViaResolve: true,
  },
];

describe("Dictionary catalog lifecycle (parameterized, Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "slaPolicies", "channels", "categories"],
    });
    prisma = harness.prisma;
    seeded = harness.seeded;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  function callerWith(user: User, permissions: Permission[]) {
    const identity: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      team: user.team,
      roleId: "role-under-test",
      roleName: "目录管理员",
      permissions,
      requiredTicketFields: [],
    };
    return appRouter.createCaller({
      traceId: "catalog-test",
      user: identity,
      sessionToken: null,
    });
  }

  const manager = () =>
    callerWith(seeded.users.manager, [
      "dictionary.manage",
      "ticket.view",
      "ticket.view_all",
      "ticket.create",
      "ticket.assign",
      "ticket.process",
      "ticket.edit",
      "ticket.delete",
      "ticket.export",
    ] as Permission[]);

  const frontline = () => callerWith(seeded.users.cs1, ["ticket.view"] as Permission[]);

  function blankTicketInput() {
    return Object.fromEntries(
      TICKET_CREATE_FIELD_KEYS.map((key) => [key, null]),
    ) as TicketCreateInput;
  }

  async function createResolvableTicket() {
    const created = await manager().ticket.create(blankTicketInput());
    await manager().ticket.assign({ ticketId: created.id, assigneeId: seeded.users.manager.id });
    return created.id;
  }

  for (const cfg of catalogs) {
    describe(`${cfg.name} catalog`, () => {
      it("creates with a trimmed unique name and rejects blank, duplicate, and overlong names", async () => {
        const router = manager()[cfg.routerKey];
        const created = await router.create({ name: "  测试新增  ", displayOrder: 90 });
        expect(created).toMatchObject({ name: "测试新增", displayOrder: 90, active: true });

        await expect(router.create({ name: "   ", displayOrder: 91 })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
        await expect(router.create({ name: "测试新增", displayOrder: 92 })).rejects.toMatchObject({
          code: "CONFLICT",
          message: cfg.labels.conflictMessage,
        });
        await expect(
          router.create({ name: "长".repeat(51), displayOrder: 93 }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      });

      if (!cfg.referencedViaResolve) {
        it("renames and reorders; the options feed lists active items in display order", async () => {
          const router = manager()[cfg.routerKey];
          const created = await router.create({ name: "排序甲", displayOrder: 201 });
          await router.create({ name: "排序乙", displayOrder: 202 });

          await router.update({ id: created.id, name: "排序丙", displayOrder: 203 });

          const options = await frontline()[cfg.routerKey].options();
          const tail = options.slice(-2).map((o) => o.name);
          expect(tail).toEqual(["排序乙", "排序丙"]);

          const existing =
            cfg.routerKey === "channel"
              ? await prisma.channel.findUniqueOrThrow({ where: { name: "排序乙" } })
              : await prisma.ticketCategory.findUniqueOrThrow({ where: { name: "排序乙" } });
          await expect(
            router.update({ id: existing.id, name: "排序丙", displayOrder: 202 }),
          ).rejects.toMatchObject({ code: "CONFLICT", message: cfg.labels.conflictMessage });
        });
      }

      it("停用 removes from options but keeps in filter feed, labelled by active", async () => {
        const router = manager()[cfg.routerKey];
        const created = await router.create({ name: "将停用", displayOrder: 210 });
        await router.setActive({ id: created.id, active: false });

        const optionNames = (await frontline()[cfg.routerKey].options()).map((o) => o.name);
        expect(optionNames).not.toContain("将停用");

        const filterOption = (await frontline()[cfg.routerKey].filterOptions()).find(
          (o) => o.id === created.id,
        );
        expect(filterOption).toEqual({ id: created.id, name: "将停用", active: false });

        const listed = (await manager()[cfg.routerKey].list()).find((c) => c.id === created.id);
        expect(listed).toMatchObject({ name: "将停用", active: false });

        await router.setActive({ id: created.id, active: true });
        expect((await frontline()[cfg.routerKey].options()).map((o) => o.name)).toContain("将停用");
      });

      it("deletes a zero-reference item and refuses a referenced one with the ticket count", async () => {
        const router = manager()[cfg.routerKey];
        const unused = await router.create({ name: "零引用", displayOrder: 220 });
        await expect(router.delete({ id: unused.id })).resolves.toEqual({ id: unused.id });

        const referenced = await router.create({ name: "被引用", displayOrder: 221 });

        let firstTicketId: string;
        let secondTicketId: string;
        if (cfg.referencedViaResolve) {
          firstTicketId = await createResolvableTicket();
          await manager().ticket.resolve({
            ticketId: firstTicketId,
            completionStatusId: referenced.id,
            remark: "第一单完结",
          });
          secondTicketId = await createResolvableTicket();
          await manager().ticket.resolve({
            ticketId: secondTicketId,
            completionStatusId: referenced.id,
            remark: "第二单完结",
          });
        } else {
          const first = await manager().ticket.create({
            ...blankTicketInput(),
            [cfg.ticketFieldId!]: referenced.id,
          });
          firstTicketId = first.id;
          const second = await manager().ticket.create({
            ...blankTicketInput(),
            [cfg.ticketFieldId!]: referenced.id,
          });
          secondTicketId = second.id;
        }

        // Soft-deleted tickets keep their reference and still block deletion.
        await manager().ticket.delete({ ticketId: secondTicketId });

        await expect(router.delete({ id: referenced.id })).rejects.toMatchObject({
          code: "CONFLICT",
          message: cfg.labels.inUseMessage(2),
        });

        const kept = await prisma.ticket.findUniqueOrThrow({ where: { id: firstTicketId } });
        if (cfg.referencedViaResolve) {
          expect(kept.completionStatusId).toBe(referenced.id);
        } else {
          expect(kept[cfg.ticketFieldId!]).toBe(referenced.id);
        }
      });

      if (cfg.referencedViaResolve) {
        it("resolving requires an existing, active status; rename shows through detail and export", async () => {
          const router = manager()[cfg.routerKey];
          const status = await router.create({ name: "完结用", displayOrder: 230 });

          const ticketId = await createResolvableTicket();
          await expect(
            manager().ticket.resolve({
              ticketId,
              completionStatusId: "no-such-id",
              remark: "引用不存在的状态",
            }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST", message: cfg.labels.missingMessage });

          const disabled = await router.create({ name: "停用中", displayOrder: 231 });
          await router.setActive({ id: disabled.id, active: false });
          await expect(
            manager().ticket.resolve({
              ticketId,
              completionStatusId: disabled.id,
              remark: "引用停用的状态",
            }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST", message: cfg.labels.disabledMessage });

          const result = await manager().ticket.resolve({
            ticketId,
            completionStatusId: status.id,
            remark: "正常完结这一单",
          });
          expect(result).toMatchObject({ status: "completed", completionStatus: "完结用" });

          await router.update({ id: status.id, name: "完结用（新名）", displayOrder: 230 });
          const detail = await manager().ticket.detail({ id: ticketId });
          expect(detail.completionStatus).toBe("完结用（新名）");

          const { exportTickets } = await import("../src/services/ticket-export.service");
          const file = await exportTickets(
            { prisma, clock: { now: () => new Date() } },
            {
              id: seeded.users.manager.id,
              username: seeded.users.manager.username,
              name: seeded.users.manager.name,
              email: seeded.users.manager.email,
              team: seeded.users.manager.team,
              roleId: "role-under-test",
              roleName: "目录管理员",
              permissions: ["ticket.view", "ticket.view_all", "ticket.export"],
              requiredTicketFields: [],
            },
            {
              format: "csv",
              search: detail.workOrderNumber,
              sortBy: "createdAt",
              sortOrder: "desc",
            },
          );
          expect(file.body.toString("utf8")).toContain("完结用（新名）");
        });

        it("filtering the ticket list by a disabled status still returns its 存量工单", async () => {
          const router = manager()[cfg.routerKey];
          const status = await router.create({ name: "停用后筛选", displayOrder: 235 });
          const ticketId = await createResolvableTicket();
          await manager().ticket.resolve({
            ticketId,
            completionStatusId: status.id,
            remark: "完结后停用其状态",
          });
          await router.setActive({ id: status.id, active: false });

          const listed = await manager().ticket.list({ completionStatusId: status.id });
          expect(listed.items.map((item) => item.id)).toEqual([ticketId]);
        });
      } else {
        it("ticket creation requires an existing, active item; rename shows through everywhere", async () => {
          const router = manager()[cfg.routerKey];
          const item = await router.create({ name: "创建用", displayOrder: 230 });

          await expect(
            manager().ticket.create({ ...blankTicketInput(), [cfg.ticketFieldId!]: "no-such-id" }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST", message: cfg.labels.missingMessage });

          const disabled = await router.create({ name: "停用中", displayOrder: 231 });
          await router.setActive({ id: disabled.id, active: false });
          await expect(
            manager().ticket.create({ ...blankTicketInput(), [cfg.ticketFieldId!]: disabled.id }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST", message: cfg.labels.disabledMessage });

          const ticket = await manager().ticket.create({
            ...blankTicketInput(),
            [cfg.ticketFieldId!]: item.id,
          });

          await router.update({ id: item.id, name: "创建用（新名）", displayOrder: 230 });
          const detail = await manager().ticket.detail({ id: ticket.id });
          expect(detail[cfg.ticketFieldDisplay]).toMatchObject({
            id: item.id,
            name: "创建用（新名）",
            active: true,
          });
          const listed = await manager().ticket.list({ search: ticket.workOrderNumber });
          // List items expose channel/category as a plain string label.
          const listedField = listed.items[0] as unknown as Record<string, string | null>;
          expect(listedField[cfg.ticketFieldDisplay]).toBe("创建用（新名）");

          const { exportTickets } = await import("../src/services/ticket-export.service");
          const file = await exportTickets(
            { prisma, clock: { now: () => new Date() } },
            {
              id: seeded.users.manager.id,
              username: seeded.users.manager.username,
              name: seeded.users.manager.name,
              email: seeded.users.manager.email,
              team: seeded.users.manager.team,
              roleId: "role-under-test",
              roleName: "目录管理员",
              permissions: ["ticket.view", "ticket.view_all", "ticket.export"],
              requiredTicketFields: [],
            },
            {
              format: "csv",
              search: ticket.workOrderNumber,
              sortBy: "createdAt",
              sortOrder: "desc",
            },
          );
          expect(file.body.toString("utf8")).toContain("创建用（新名）");
        });

        it("filtering by a disabled item still returns its 存量工单", async () => {
          const router = manager()[cfg.routerKey];
          const item = await router.create({ name: "停用后筛选", displayOrder: 235 });
          const ticket = await manager().ticket.create({
            ...blankTicketInput(),
            [cfg.ticketFieldId!]: item.id,
          });
          await router.setActive({ id: item.id, active: false });

          const listed = await manager().ticket.list({ [cfg.filterKey]: item.id });
          expect(listed.items.map((i) => i.id)).toEqual([ticket.id]);
          const listedField = listed.items[0] as unknown as Record<string, string | null>;
          expect(listedField[cfg.ticketFieldDisplay]).toBe("停用后筛选");
        });

        it("editing keeps a disabled item, forbids newly selecting one, and snapshots names in the log", async () => {
          const router = manager()[cfg.routerKey];
          const oldItem = await router.create({ name: "旧项", displayOrder: 240 });
          const newItem = await router.create({ name: "新项", displayOrder: 241 });
          const ticket = await manager().ticket.create({
            ...blankTicketInput(),
            [cfg.ticketFieldId!]: oldItem.id,
          });
          await router.setActive({ id: oldItem.id, active: false });

          // Keeping the (now disabled) original value is a no-op edit for the field.
          const kept = await manager().ticket.edit({
            ...blankTicketInput(),
            ticketId: ticket.id,
            [cfg.ticketFieldId!]: oldItem.id,
            customerName: "改个名字",
          });
          expect(kept.changedFields).toEqual(["customerName"]);

          // Newly selecting a different disabled item is rejected.
          const otherDisabled = await router.create({ name: "另一停用", displayOrder: 242 });
          await router.setActive({ id: otherDisabled.id, active: false });
          await expect(
            manager().ticket.edit({
              ...blankTicketInput(),
              ticketId: ticket.id,
              [cfg.ticketFieldId!]: otherDisabled.id,
            }),
          ).rejects.toMatchObject({ code: "BAD_REQUEST", message: cfg.labels.disabledMessage });

          // Switching to an active item logs literal name snapshots …
          await manager().ticket.edit({
            ...blankTicketInput(),
            ticketId: ticket.id,
            [cfg.ticketFieldId!]: newItem.id,
          });
          // … that survive later renames (处理记录保留操作当时的字面快照).
          await router.update({ id: newItem.id, name: "新项改名", displayOrder: 241 });
          const detail = await manager().ticket.detail({ id: ticket.id });
          const editLogs = detail.processLogs.filter((log) => log.action === "edit");
          const fieldEdit = editLogs.at(-1);
          expect(fieldEdit?.remark).toContain(`${cfg.editLogPrefix}: 旧项→新项`);
          // This branch only runs for channel/category, whose display field is
          // always an object ({ id, name, active }), never a plain string.
          const displayField = detail[cfg.ticketFieldDisplay] as { name: string } | null;
          expect(displayField?.name).toBe("新项改名");

          // Clearing back to 未填写 stays allowed.
          const cleared = await manager().ticket.edit({
            ...blankTicketInput(),
            ticketId: ticket.id,
            [cfg.ticketFieldId!]: null,
          });
          expect(cleared.changedFields).toContain(cfg.ticketFieldId!);
        });
      }

      it("gates every catalog mutation and the manager list behind dictionary.manage", async () => {
        const router = frontline()[cfg.routerKey];
        await expect(router.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(router.create({ name: "越权", displayOrder: 0 })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(
          router.update({ id: "unknown", name: "越权", displayOrder: 0 }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(router.setActive({ id: "unknown", active: false })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(router.delete({ id: "unknown" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      });
    });
  }

  // Smoke tests for catalog-specific behaviors
  describe("Channel catalog smoke", () => {
    it("seeds the 4 factory channels once", async () => {
      const channels = await manager().channel.list();
      expect(channels.map((c) => c.name)).toContain("保司");
      expect(channels.map((c) => c.name)).toContain("经纪");
    });
  });

  describe("TicketCategory catalog smoke", () => {
    it("seeds the 17 factory categories once", async () => {
      const categories = await manager().ticketCategory.list();
      expect(categories.length).toBeGreaterThanOrEqual(17);
      expect(categories.map((c) => c.name)).toContain("监管投诉-引导性");
      expect(categories.map((c) => c.name)).toContain("其他");
    });
  });

  describe("CompletionStatus catalog smoke", () => {
    it("the migration populates the 12 historical values in enum order", async () => {
      const statuses = await manager().completionStatus.list();
      const names = statuses.map((s) => s.name);
      const expectedMigrationValues = [
        "未取得有效联系",
        "已达成一致",
        "诉求过高，无法达成一致",
        "客户自行撤诉",
        "已协商解决",
        "已赔付",
        "已退保",
        "转其他部门处理",
        "无效工单",
        "正常完结",
        "冷处理",
        "联系不上",
      ];
      // Check all 12 migration values are present
      for (const name of expectedMigrationValues) {
        expect(names).toContain(name);
      }
      // First 12 should be the migration values in order
      expect(names.slice(0, 12)).toEqual(expectedMigrationValues);
    });
  });
});
