import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission } from "@insuredesk/shared";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client";
import type { AuthenticatedUser } from "../src/services/auth.service";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * CompletionStatus catalog smoke tests (issue #93). Full lifecycle coverage now lives
 * in dictionary-catalog.integration.test.ts; this suite verifies completion-status
 * specific behaviors: migration-seeded rows, 引用必填 (required at resolve), and
 * no edit path (status is assigned at resolve, not create/edit).
 */
describe("CompletionStatus catalog smoke (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let seeded: {
    roles: { admin: Role; csManager: Role; frontline: Role; readOnly: Role };
    users: { admin: User; manager: User; cs1: User; observer: User };
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = container.getConnectionUri();

    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    process.env.DATABASE_URL = databaseUrl;

    const [{ prisma: appPrisma }, seedData, routers] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
      import("../src/routers/index"),
    ]);
    prisma = appPrisma;
    appRouter = routers.appRouter;
    seeded = await seedData.seedFactoryRolesAndDemoUsers(prisma);
    await seedData.seedSlaPolicies(prisma);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  function callerWith(user: User, permissions: Permission[]) {
    const identity: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      roleId: "role-under-test",
      roleName: "目录管理员",
      permissions,
      requiredTicketFields: [],
    };
    return appRouter.createCaller({
      traceId: "completion-status-smoke",
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
      "ticket.delete",
      "ticket.export",
    ] as Permission[]);

  /** A fresh ticket assigned to the manager, ready to resolve. */
  async function createResolvableTicket() {
    const created = await manager().ticket.create(blankTicketInput());
    await manager().ticket.assign({ ticketId: created.id, assigneeId: seeded.users.manager.id });
    return created.id;
  }

  it("the migration populates the 12 historical values in enum order — no app-layer seed", async () => {
    const statuses = await manager().completionStatus.list();
    expect(statuses.map((status) => status.name)).toEqual([
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
    ]);
    expect(statuses.every((status) => status.active)).toBe(true);
  });

  it("creates a new status", async () => {
    const created = await manager().completionStatus.create({
      name: "测试新增状态",
      displayOrder: 90,
    });
    expect(created).toMatchObject({ name: "测试新增状态", displayOrder: 90, active: true });
  });

  it("renames a status", async () => {
    const created = await manager().completionStatus.create({
      name: "待重命名状态",
      displayOrder: 100,
    });
    const updated = await manager().completionStatus.update({
      id: created.id,
      name: "已重命名状态",
      displayOrder: 100,
    });
    expect(updated.name).toBe("已重命名状态");
  });

  it("disables a status", async () => {
    const created = await manager().completionStatus.create({
      name: "待停用状态",
      displayOrder: 110,
    });
    await manager().completionStatus.setActive({ id: created.id, active: false });
    const statuses = await manager().completionStatus.list();
    const disabled = statuses.find((s) => s.id === created.id);
    expect(disabled?.active).toBe(false);
  });

  it("rejects deletion of a referenced status", async () => {
    const status = await manager().completionStatus.create({
      name: "被引用状态",
      displayOrder: 120,
    });
    const ticketId = await createResolvableTicket();
    await manager().ticket.resolve({
      ticketId,
      completionStatusId: status.id,
      remark: "完结测试",
    });

    await expect(manager().completionStatus.delete({ id: status.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该完结状态已被 1 张工单使用，无法删除，可改为停用",
    });
  });

  // Completion-status specific behaviors below

  it("引用必填：resolving requires an existing, active status", async () => {
    const status = await manager().completionStatus.create({
      name: "完结用",
      displayOrder: 230,
    });

    const ticketId = await createResolvableTicket();
    await expect(
      manager().ticket.resolve({
        ticketId,
        completionStatusId: "no-such-id",
        remark: "引用不存在的状态",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选完结状态不存在" });

    const disabled = await manager().completionStatus.create({
      name: "停用中",
      displayOrder: 231,
    });
    await manager().completionStatus.setActive({ id: disabled.id, active: false });
    await expect(
      manager().ticket.resolve({
        ticketId,
        completionStatusId: disabled.id,
        remark: "引用停用的状态",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选完结状态已停用" });

    // The rejected resolves left no trace — the ticket is still in flight.
    const result = await manager().ticket.resolve({
      ticketId,
      completionStatusId: status.id,
      remark: "正常完结这一单",
    });
    expect(result).toMatchObject({ status: "completed", completionStatus: "完结用" });
  });

  it("无保留停用值的编辑路径：completion status is assigned at resolve, not create/edit", async () => {
    // Unlike channel/category which are set at ticket.create() and can be
    // edited via ticket.edit(), completionStatus is only assigned at
    // ticket.resolve() and never changed after that. There's no edit path
    // that would need to preserve a disabled value.
    const status = await manager().completionStatus.create({
      name: "完结后不可编辑",
      displayOrder: 240,
    });
    const ticketId = await createResolvableTicket();
    await manager().ticket.resolve({
      ticketId,
      completionStatusId: status.id,
      remark: "完结",
    });

    // Resolved tickets are immutable; the completionStatus field is never
    // touched again. This test documents that there's no edit path for it.
    const detail = await manager().ticket.detail({ id: ticketId });
    expect(detail.status).toBe("completed");
    expect(detail.completionStatus).toBe("完结后不可编辑");
  });

  it("目录行来自迁移：migration seeds 12 values, no app-layer seedCompletionStatuses", async () => {
    // The other two catalogs have seedChannels/seedTicketCategories;
    // completionStatus rows come from the migration itself (the historical
    // enum values), and there's no application-layer seed function.
    const statuses = await manager().completionStatus.list();
    expect(statuses.length).toBeGreaterThanOrEqual(12);
    expect(statuses.map((s) => s.name)).toContain("未取得有效联系");
    expect(statuses.map((s) => s.name)).toContain("正常完结");
  });

  /** A fully blank manual-ticket payload; tests override the fields they exercise. */
  function blankTicketInput() {
    return {
      feedbackTime: null,
      channelId: null,
      project: null,
      brokerageEntity: null,
      paymentChannel: null,
      internalOrderNumber: null,
      policyNumber: null,
      userComplaintChannel: null,
      customerName: null,
      phone: null,
      contactPhone: null,
      customerRequest: null,
      nuclearBodyStatus: null,
      hasContacted: null,
      contactId: null,
      categoryId: null,
      complaintLevel: null,
      priority: null,
    };
  }
});
