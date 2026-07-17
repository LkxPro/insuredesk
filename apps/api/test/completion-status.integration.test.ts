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
 * 完结状态目录 acceptance tests at the public tRPC seam (issue #86). The
 * lifecycle mirrors the 渠道/类别 catalogs; the catalog is populated by the
 * migration itself (12 historical enum values, no application-layer seed).
 * On top of it the resolve dialog feed lists active rows only, resolving
 * validates the reference, and the ticket list filters by catalog reference
 * (disabled rows included).
 */
describe("Completion status catalog (Testcontainers)", () => {
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
      traceId: "completion-status-test",
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
  const frontline = () => callerWith(seeded.users.cs1, ["ticket.view"] as Permission[]);

  /** A fresh ticket assigned to the manager, ready to resolve. */
  async function createResolvableTicket() {
    const created = await manager().ticket.create(blankTicketInput());
    await manager().ticket.assign({ ticketId: created.id, assigneeId: seeded.users.manager.id });
    return created.id;
  }

  async function statusIdByName(name: string) {
    const row = await prisma.completionStatus.findUniqueOrThrow({ where: { name } });
    return row.id;
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

  it("creates with a trimmed unique name and rejects blank, duplicate, and overlong names", async () => {
    const created = await manager().completionStatus.create({
      name: "  测试新增状态  ",
      displayOrder: 90,
    });
    expect(created).toMatchObject({ name: "测试新增状态", displayOrder: 90, active: true });

    await expect(
      manager().completionStatus.create({ name: "   ", displayOrder: 91 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      manager().completionStatus.create({ name: "测试新增状态", displayOrder: 92 }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "状态名称已存在" });
    await expect(
      manager().completionStatus.create({ name: "状".repeat(51), displayOrder: 93 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("停用 removes a status from the resolve options but keeps it in the filter feed", async () => {
    const created = await manager().completionStatus.create({
      name: "将停用",
      displayOrder: 210,
    });
    await manager().completionStatus.setActive({ id: created.id, active: false });

    const optionNames = (await frontline().completionStatus.options()).map((o) => o.name);
    expect(optionNames).not.toContain("将停用");

    const filterOption = (await frontline().completionStatus.filterOptions()).find(
      (option) => option.id === created.id,
    );
    expect(filterOption).toEqual({ id: created.id, name: "将停用", active: false });

    await manager().completionStatus.setActive({ id: created.id, active: true });
    expect((await frontline().completionStatus.options()).map((o) => o.name)).toContain("将停用");
  });

  it("deletes a zero-reference status and refuses a referenced one with the ticket count", async () => {
    const unused = await manager().completionStatus.create({
      name: "零引用",
      displayOrder: 220,
    });
    await expect(manager().completionStatus.delete({ id: unused.id })).resolves.toEqual({
      id: unused.id,
    });

    const referenced = await manager().completionStatus.create({
      name: "被引用",
      displayOrder: 221,
    });
    const first = await createResolvableTicket();
    await manager().ticket.resolve({
      ticketId: first,
      completionStatusId: referenced.id,
      remark: "第一单完结",
    });
    const second = await createResolvableTicket();
    await manager().ticket.resolve({
      ticketId: second,
      completionStatusId: referenced.id,
      remark: "第二单完结",
    });
    // Soft-deleted tickets keep their reference and still block deletion.
    await manager().ticket.delete({ ticketId: second });

    await expect(manager().completionStatus.delete({ id: referenced.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该完结状态已被 2 张工单使用，无法删除，可改为停用",
    });
    const kept = await prisma.ticket.findUniqueOrThrow({ where: { id: first } });
    expect(kept.completionStatusId).toBe(referenced.id);
  });

  it("resolving requires an existing, active status; rename shows through detail, list, and export", async () => {
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

    await manager().completionStatus.update({
      id: status.id,
      name: "完结用（新名）",
      displayOrder: 230,
    });
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
        roleId: "role-under-test",
        roleName: "目录管理员",
        permissions: ["ticket.view", "ticket.view_all", "ticket.export"],
        requiredTicketFields: [],
      },
      { format: "csv", search: detail.workOrderNumber, sortBy: "createdAt", sortOrder: "desc" },
    );
    expect(file.body.toString("utf8")).toContain("完结用（新名）");
  });

  it("filtering the ticket list by a disabled status still returns its 存量工单", async () => {
    const status = await manager().completionStatus.create({
      name: "停用后筛选",
      displayOrder: 235,
    });
    const ticketId = await createResolvableTicket();
    await manager().ticket.resolve({
      ticketId,
      completionStatusId: status.id,
      remark: "完结后停用其状态",
    });
    await manager().completionStatus.setActive({ id: status.id, active: false });

    const listed = await manager().ticket.list({ completionStatusId: status.id });
    expect(listed.items.map((item) => item.id)).toEqual([ticketId]);

    const other = await statusIdByName("正常完结");
    const none = await manager().ticket.list({
      completionStatusId: other,
      search: (await manager().ticket.detail({ id: ticketId })).workOrderNumber,
    });
    expect(none.items).toEqual([]);
  });

  it("gates every catalog mutation and the manager list behind dictionary.manage", async () => {
    await expect(frontline().completionStatus.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      frontline().completionStatus.create({ name: "越权", displayOrder: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      frontline().completionStatus.update({ id: "unknown", name: "越权", displayOrder: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      frontline().completionStatus.setActive({ id: "unknown", active: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(frontline().completionStatus.delete({ id: "unknown" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
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
