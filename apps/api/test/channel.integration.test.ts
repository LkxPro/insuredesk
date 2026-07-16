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
 * 反馈渠道目录 acceptance tests at the public tRPC seam (issue #69). The
 * lifecycle mirrors the 客诉类别 catalog; on top of it the ticket list filters
 * by catalog reference (disabled rows included), and the filter feed lists
 * the whole catalog.
 */
describe("Channel catalog (Testcontainers)", () => {
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
    await seedData.seedChannels(prisma);
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
      traceId: "channel-test",
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

  it("seeds the 4 factory channels once and never restores later deletions or edits", async () => {
    const channels = await manager().channel.list();
    expect(channels.map((channel) => channel.name)).toEqual(["保司", "经纪", "支付", "监管"]);

    // Operator deletes one and renames another; a startup re-seed must keep hands off.
    const victim = await prisma.channel.findUniqueOrThrow({ where: { name: "经纪" } });
    await manager().channel.delete({ id: victim.id });
    const renamed = await prisma.channel.findUniqueOrThrow({ where: { name: "支付" } });
    await manager().channel.update({
      id: renamed.id,
      name: "第三方支付",
      displayOrder: renamed.displayOrder,
    });

    await seedData.seedChannels(prisma);
    const after = (await manager().channel.list()).map((channel) => channel.name);
    expect(after).toHaveLength(3);
    expect(after).not.toContain("经纪");
    expect(after).toContain("第三方支付");
  });

  it("creates with a trimmed unique name and rejects blank, duplicate, and overlong names", async () => {
    const created = await manager().channel.create({
      name: "  测试新增渠道  ",
      displayOrder: 90,
    });
    expect(created).toMatchObject({
      name: "测试新增渠道",
      displayOrder: 90,
      active: true,
    });

    await expect(manager().channel.create({ name: "   ", displayOrder: 91 })).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
    await expect(
      manager().channel.create({ name: "测试新增渠道", displayOrder: 92 }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "渠道名称已存在" });
    await expect(
      manager().channel.create({ name: "渠".repeat(51), displayOrder: 93 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("renames and reorders; the options feed lists active channels in display order", async () => {
    const created = await manager().channel.create({
      name: "排序甲",
      displayOrder: 201,
    });
    await manager().channel.create({ name: "排序乙", displayOrder: 202 });

    await manager().channel.update({
      id: created.id,
      name: "排序丙",
      displayOrder: 203,
    });

    const options = await frontline().channel.options();
    const tail = options.slice(-2).map((option) => option.name);
    expect(tail).toEqual(["排序乙", "排序丙"]);

    const existing = await prisma.channel.findUniqueOrThrow({ where: { name: "排序乙" } });
    await expect(
      manager().channel.update({
        id: existing.id,
        name: "排序丙",
        displayOrder: 202,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "渠道名称已存在" });
  });

  it("停用 removes a channel from options but keeps it in the filter feed, labelled by active", async () => {
    const created = await manager().channel.create({
      name: "将停用",
      displayOrder: 210,
    });
    await manager().channel.setActive({ id: created.id, active: false });

    const optionNames = (await frontline().channel.options()).map((o) => o.name);
    expect(optionNames).not.toContain("将停用");

    // 筛选下拉全列目录项 — the disabled row rides along with its active flag.
    const filterOption = (await frontline().channel.filterOptions()).find(
      (option) => option.id === created.id,
    );
    expect(filterOption).toEqual({ id: created.id, name: "将停用", active: false });

    const listed = (await manager().channel.list()).find((c) => c.id === created.id);
    expect(listed).toMatchObject({ name: "将停用", active: false });

    await manager().channel.setActive({ id: created.id, active: true });
    expect((await frontline().channel.options()).map((o) => o.name)).toContain("将停用");
  });

  it("deletes a zero-reference channel and refuses a referenced one with the ticket count", async () => {
    const unused = await manager().channel.create({
      name: "零引用",
      displayOrder: 220,
    });
    await expect(manager().channel.delete({ id: unused.id })).resolves.toEqual({ id: unused.id });

    const referenced = await manager().channel.create({
      name: "被引用",
      displayOrder: 221,
    });
    const first = await manager().ticket.create({
      ...blankTicketInput(),
      channelId: referenced.id,
    });
    const second = await manager().ticket.create({
      ...blankTicketInput(),
      channelId: referenced.id,
    });
    // Soft-deleted tickets keep their reference and still block deletion.
    await manager().ticket.delete({ ticketId: second.id });

    await expect(manager().channel.delete({ id: referenced.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该渠道已被 2 张工单使用，无法删除，可改为停用",
    });
    const kept = await prisma.ticket.findUniqueOrThrow({ where: { id: first.id } });
    expect(kept.channelId).toBe(referenced.id);
  });

  it("ticket creation requires an existing, active channel; rename shows through everywhere", async () => {
    const channel = await manager().channel.create({
      name: "创建用",
      displayOrder: 230,
    });

    await expect(
      manager().ticket.create({ ...blankTicketInput(), channelId: "no-such-id" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选反馈渠道不存在" });

    const disabled = await manager().channel.create({
      name: "停用中",
      displayOrder: 231,
    });
    await manager().channel.setActive({ id: disabled.id, active: false });
    await expect(
      manager().ticket.create({ ...blankTicketInput(), channelId: disabled.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选反馈渠道已停用" });

    const ticket = await manager().ticket.create({
      ...blankTicketInput(),
      channelId: channel.id,
    });

    await manager().channel.update({
      id: channel.id,
      name: "创建用（新名）",
      displayOrder: 230,
    });
    const detail = await manager().ticket.detail({ id: ticket.id });
    expect(detail.channel).toMatchObject({
      id: channel.id,
      name: "创建用（新名）",
      active: true,
    });
    const listed = await manager().ticket.list({ search: ticket.workOrderNumber });
    expect(listed.items[0]?.channel).toBe("创建用（新名）");

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

  it("filtering by a disabled channel still returns its 存量工单", async () => {
    const channel = await manager().channel.create({
      name: "停用后筛选",
      displayOrder: 235,
    });
    const ticket = await manager().ticket.create({
      ...blankTicketInput(),
      channelId: channel.id,
    });
    await manager().channel.setActive({ id: channel.id, active: false });

    const listed = await manager().ticket.list({ channelId: channel.id });
    expect(listed.items.map((item) => item.id)).toEqual([ticket.id]);
    expect(listed.items[0]?.channel).toBe("停用后筛选");
  });

  it("editing keeps a disabled channel, forbids newly selecting one, and snapshots names in the log", async () => {
    const oldChannel = await manager().channel.create({
      name: "旧渠道",
      displayOrder: 240,
    });
    const newChannel = await manager().channel.create({
      name: "新渠道",
      displayOrder: 241,
    });
    const ticket = await manager().ticket.create({
      ...blankTicketInput(),
      channelId: oldChannel.id,
    });
    await manager().channel.setActive({ id: oldChannel.id, active: false });

    // Keeping the (now disabled) original value is a no-op edit for the field.
    const kept = await manager().ticket.edit({
      ...blankTicketInput(),
      ticketId: ticket.id,
      channelId: oldChannel.id,
      customerName: "改个名字",
    });
    expect(kept.changedFields).toEqual(["customerName"]);

    // Newly selecting a different disabled channel is rejected.
    const otherDisabled = await manager().channel.create({
      name: "另一停用",
      displayOrder: 242,
    });
    await manager().channel.setActive({ id: otherDisabled.id, active: false });
    await expect(
      manager().ticket.edit({
        ...blankTicketInput(),
        ticketId: ticket.id,
        channelId: otherDisabled.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选反馈渠道已停用" });

    // Switching to an active channel logs literal name snapshots …
    await manager().ticket.edit({
      ...blankTicketInput(),
      ticketId: ticket.id,
      channelId: newChannel.id,
    });
    // … that survive later renames (处理记录保留操作当时的字面快照).
    await manager().channel.update({
      id: newChannel.id,
      name: "新渠道改名",
      displayOrder: 241,
    });
    const detail = await manager().ticket.detail({ id: ticket.id });
    const editLogs = detail.processLogs.filter((log) => log.action === "edit");
    const channelEdit = editLogs.at(-1);
    expect(channelEdit?.remark).toContain("反馈渠道: 旧渠道→新渠道");
    expect(detail.channel?.name).toBe("新渠道改名");

    // Clearing back to 未填写 stays allowed.
    const cleared = await manager().ticket.edit({
      ...blankTicketInput(),
      ticketId: ticket.id,
      channelId: null,
    });
    expect(cleared.changedFields).toContain("channelId");
  });

  it("gates every catalog mutation and the manager list behind dictionary.manage", async () => {
    await expect(frontline().channel.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      frontline().channel.create({ name: "越权", displayOrder: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      frontline().channel.update({
        id: "unknown",
        name: "越权",
        displayOrder: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      frontline().channel.setActive({ id: "unknown", active: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(frontline().channel.delete({ id: "unknown" })).rejects.toMatchObject({
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
