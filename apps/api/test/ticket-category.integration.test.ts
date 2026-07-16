import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission } from "@insuredesk/shared";
import type { PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/services/auth.service";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 客诉类别目录 acceptance tests at the public tRPC seam (issue #68). A real
 * Postgres backs them because name uniqueness and the ticket-reference
 * deletion guard are database invariants; the router supplies the RBAC
 * boundary, and the ticket procedures prove the reference semantics
 * (rename propagation, 停用 rules) end to end.
 */
describe("TicketCategory catalog (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let seedData: typeof import("../prisma/seed-data");
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

    const [{ prisma: appPrisma }, seedModule, routers] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
      import("../src/routers/index"),
    ]);
    prisma = appPrisma;
    seedData = seedModule;
    appRouter = routers.appRouter;
    seeded = await seedData.seedFactoryRolesAndDemoUsers(prisma);
    await seedData.seedSlaPolicies(prisma);
    await seedData.seedTicketCategories(prisma);
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
      traceId: "ticket-category-test",
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
      "ticket.edit",
      "ticket.delete",
    ] as Permission[]);
  const frontline = () => callerWith(seeded.users.cs1, ["ticket.view"] as Permission[]);

  it("seeds the 17 factory categories once and never restores later deletions or edits", async () => {
    const names = (await manager().ticketCategory.list()).map((category) => category.name);
    expect(names).toHaveLength(17);
    expect(names[0]).toBe("监管投诉-引导性");
    expect(names[16]).toBe("其他");

    // Operator deletes one and renames another; a startup re-seed must keep hands off.
    const victim = await prisma.ticketCategory.findUniqueOrThrow({ where: { name: "回访问题" } });
    await manager().ticketCategory.delete({ id: victim.id });
    const renamed = await prisma.ticketCategory.findUniqueOrThrow({ where: { name: "产品咨询" } });
    await manager().ticketCategory.update({
      id: renamed.id,
      name: "产品与条款咨询",
      displayOrder: renamed.displayOrder,
    });

    await seedData.seedTicketCategories(prisma);
    const after = (await manager().ticketCategory.list()).map((category) => category.name);
    expect(after).toHaveLength(16);
    expect(after).not.toContain("回访问题");
    expect(after).toContain("产品与条款咨询");
  });

  it("creates with a trimmed unique name and rejects blank, duplicate, and overlong names", async () => {
    const created = await manager().ticketCategory.create({
      name: "  测试新增类别  ",
      displayOrder: 90,
    });
    expect(created).toMatchObject({ name: "测试新增类别", displayOrder: 90, active: true });

    await expect(
      manager().ticketCategory.create({ name: "   ", displayOrder: 91 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      manager().ticketCategory.create({ name: "测试新增类别", displayOrder: 92 }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "类别名称已存在" });
    await expect(
      manager().ticketCategory.create({ name: "类".repeat(51), displayOrder: 93 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("renames and reorders; the options feed lists active categories in display order", async () => {
    const created = await manager().ticketCategory.create({ name: "排序甲", displayOrder: 201 });
    await manager().ticketCategory.create({ name: "排序乙", displayOrder: 202 });

    await manager().ticketCategory.update({ id: created.id, name: "排序丙", displayOrder: 203 });

    const options = await frontline().ticketCategory.options();
    const tail = options.slice(-2).map((option) => option.name);
    expect(tail).toEqual(["排序乙", "排序丙"]);

    const existing = await prisma.ticketCategory.findUniqueOrThrow({ where: { name: "排序乙" } });
    await expect(
      manager().ticketCategory.update({ id: existing.id, name: "排序丙", displayOrder: 202 }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "类别名称已存在" });
  });

  it("停用 removes a category from options but keeps it listed for managers", async () => {
    const created = await manager().ticketCategory.create({ name: "将停用", displayOrder: 210 });
    await manager().ticketCategory.setActive({ id: created.id, active: false });

    const optionNames = (await frontline().ticketCategory.options()).map((o) => o.name);
    expect(optionNames).not.toContain("将停用");

    const listed = (await manager().ticketCategory.list()).find((c) => c.id === created.id);
    expect(listed).toMatchObject({ name: "将停用", active: false });

    await manager().ticketCategory.setActive({ id: created.id, active: true });
    expect((await frontline().ticketCategory.options()).map((o) => o.name)).toContain("将停用");
  });

  it("deletes a zero-reference category and refuses a referenced one with the ticket count", async () => {
    const unused = await manager().ticketCategory.create({ name: "零引用", displayOrder: 220 });
    await expect(manager().ticketCategory.delete({ id: unused.id })).resolves.toEqual({
      id: unused.id,
    });

    const referenced = await manager().ticketCategory.create({ name: "被引用", displayOrder: 221 });
    const first = await manager().ticket.create({
      ...blankTicketInput(),
      categoryId: referenced.id,
    });
    const second = await manager().ticket.create({
      ...blankTicketInput(),
      categoryId: referenced.id,
    });
    // Soft-deleted tickets keep their reference and still block deletion.
    await manager().ticket.delete({ ticketId: second.id });

    await expect(manager().ticketCategory.delete({ id: referenced.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该类别已被 2 张工单使用，无法删除，可改为停用",
    });
    const kept = await prisma.ticket.findUniqueOrThrow({ where: { id: first.id } });
    expect(kept.categoryId).toBe(referenced.id);
  });

  it("ticket creation requires an existing, active category; rename shows through everywhere", async () => {
    const category = await manager().ticketCategory.create({ name: "创建用", displayOrder: 230 });

    await expect(
      manager().ticket.create({ ...blankTicketInput(), categoryId: "no-such-id" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选客诉类别不存在" });

    const disabled = await manager().ticketCategory.create({ name: "停用中", displayOrder: 231 });
    await manager().ticketCategory.setActive({ id: disabled.id, active: false });
    await expect(
      manager().ticket.create({ ...blankTicketInput(), categoryId: disabled.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选客诉类别已停用" });

    const ticket = await manager().ticket.create({
      ...blankTicketInput(),
      categoryId: category.id,
    });

    await manager().ticketCategory.update({
      id: category.id,
      name: "创建用（新名）",
      displayOrder: 230,
    });
    const detail = await manager().ticket.detail({ id: ticket.id });
    expect(detail.category).toMatchObject({
      id: category.id,
      name: "创建用（新名）",
      active: true,
    });
    const listed = await manager().ticket.list({ search: ticket.workOrderNumber });
    expect(listed.items[0]?.category).toBe("创建用（新名）");

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
      { format: "csv", search: ticket.workOrderNumber, sortBy: "createdAt", sortOrder: "desc" },
    );
    expect(file.body.toString("utf8")).toContain("创建用（新名）");
  });

  it("editing keeps a disabled category, forbids newly selecting one, and snapshots names in the log", async () => {
    const oldCategory = await manager().ticketCategory.create({
      name: "旧类别",
      displayOrder: 240,
    });
    const newCategory = await manager().ticketCategory.create({
      name: "新类别",
      displayOrder: 241,
    });
    const ticket = await manager().ticket.create({
      ...blankTicketInput(),
      categoryId: oldCategory.id,
    });
    await manager().ticketCategory.setActive({ id: oldCategory.id, active: false });

    // Keeping the (now disabled) original value is a no-op edit for the field.
    const kept = await manager().ticket.edit({
      ...blankTicketInput(),
      ticketId: ticket.id,
      categoryId: oldCategory.id,
      customerName: "改个名字",
    });
    expect(kept.changedFields).toEqual(["customerName"]);

    // Newly selecting a different disabled category is rejected.
    const otherDisabled = await manager().ticketCategory.create({
      name: "另一停用",
      displayOrder: 242,
    });
    await manager().ticketCategory.setActive({ id: otherDisabled.id, active: false });
    await expect(
      manager().ticket.edit({
        ...blankTicketInput(),
        ticketId: ticket.id,
        categoryId: otherDisabled.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选客诉类别已停用" });

    // Switching to an active category logs literal name snapshots …
    await manager().ticket.edit({
      ...blankTicketInput(),
      ticketId: ticket.id,
      categoryId: newCategory.id,
    });
    // … that survive later renames (处理记录保留操作当时的字面快照).
    await manager().ticketCategory.update({
      id: newCategory.id,
      name: "新类别改名",
      displayOrder: 241,
    });
    const detail = await manager().ticket.detail({ id: ticket.id });
    const editLogs = detail.processLogs.filter((log) => log.action === "edit");
    const categoryEdit = editLogs.at(-1);
    expect(categoryEdit?.remark).toContain("客诉类别: 旧类别→新类别");
    expect(detail.category?.name).toBe("新类别改名");

    // Clearing back to 未填写 stays allowed.
    const cleared = await manager().ticket.edit({
      ...blankTicketInput(),
      ticketId: ticket.id,
      categoryId: null,
    });
    expect(cleared.changedFields).toContain("categoryId");
  });

  it("gates every catalog mutation and the manager list behind dictionary.manage", async () => {
    await expect(frontline().ticketCategory.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      frontline().ticketCategory.create({ name: "越权", displayOrder: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      frontline().ticketCategory.update({ id: "unknown", name: "越权", displayOrder: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      frontline().ticketCategory.setActive({ id: "unknown", active: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(frontline().ticketCategory.delete({ id: "unknown" })).rejects.toMatchObject({
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
