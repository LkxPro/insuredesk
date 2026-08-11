import { type Permission, USER_PERMISSIONS } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedExternalUserRole } from "../prisma/seed-data";
import type { PrismaClient, Role } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import { PasswordAuthProvider, SessionService } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * 外部账号管理 against a real Postgres: every operation answers to the single
 * external_account.manage point (no user.* needed, and user.* alone opens
 * nothing), and each door is fenced to 外部账号 so the point never reaches
 * internal accounts. 建号不选角色 — the sole 外部角色 is looked up server-side.
 */
describe("外部账号管理 × external_account.manage (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let externalRole: Role;
  let channelId: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "channels"],
      traceId: "external-account-test",
    });
    prisma = harness.prisma;
    seeded = harness.seeded;
    externalRole = await seedExternalUserRole(prisma);
    channelId = harness.channelId("保司");
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const callerWith = (permissions: Permission[]) =>
    harness.callerWith(seeded.users.manager, seeded.roles.csManager, permissions);
  // 只持 external_account.manage,一个 user.* 点都没有 — the issue's core claim.
  const manager = () => callerWith(["external_account.manage"]);

  let seq = 0;
  function accountArgs(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return {
      username: `ext-account-${seq}`,
      password: "initial-pass-1",
      name: `外部成员${seq}`,
      email: null,
      ...overrides,
    };
  }

  function updateArgs(id: string, overrides: Record<string, unknown> = {}) {
    seq += 1;
    return {
      id,
      username: `ext-account-upd-${seq}`,
      name: `改名成员${seq}`,
      email: null,
      password: "",
      ...overrides,
    };
  }

  async function createInternalUser() {
    seq += 1;
    return prisma.user.create({
      data: {
        username: `internal-${seq}`,
        name: `内部成员${seq}`,
        passwordHash: "dummy",
        roleId: seeded.roles.frontline.id,
        active: true,
      },
    });
  }

  async function seedSession(userId: string) {
    return prisma.session.create({
      data: {
        token: `session-${userId}-${++seq}`,
        userId,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
  }

  const sessionCount = (userId: string) => prisma.session.count({ where: { userId } });

  describe("权限执法", () => {
    it("external_account.manage 独点走完账号全生命周期", async () => {
      const created = await manager().externalAccount.create(accountArgs());

      let rows = await manager().externalAccount.list();
      expect(rows.find((row) => row.id === created.id)).toMatchObject({ active: true });

      await manager().externalAccount.update(updateArgs(created.id, { name: "生命周期改名" }));
      await manager().externalAccount.setActive({ id: created.id, active: false });
      await manager().externalAccount.setActive({ id: created.id, active: true });

      rows = await manager().externalAccount.list();
      expect(rows.find((row) => row.id === created.id)).toMatchObject({
        name: "生命周期改名",
        active: true,
      });
    });

    it("全套 user.* 点也开不了任何一扇门", async () => {
      const userAdmin = callerWith([...USER_PERMISSIONS]);
      const forbidden = { code: "FORBIDDEN" };

      await expect(userAdmin.externalAccount.list()).rejects.toMatchObject(forbidden);
      await expect(userAdmin.externalAccount.create(accountArgs())).rejects.toMatchObject(
        forbidden,
      );
      await expect(userAdmin.externalAccount.update(updateArgs("any"))).rejects.toMatchObject(
        forbidden,
      );
      await expect(
        userAdmin.externalAccount.setActive({ id: "any", active: false }),
      ).rejects.toMatchObject(forbidden);
    });
  });

  describe("新建外部账号", () => {
    it("自动挂唯一外部角色,团队恒空,预填与白名单落库", async () => {
      const created = await manager().externalAccount.create(
        accountArgs({
          prefill: {
            channelId,
            project: "融盛",
            brokerageEntity: "东方大地",
            paymentChannel: "连连",
            userComplaintChannel: "400热线",
            complaintReceiveChannel: "客服群",
          },
        }),
      );

      const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({
        roleId: externalRole.id,
        team: null,
        prefillChannelId: channelId,
        prefillProject: "融盛",
        prefillBrokerageEntity: "东方大地",
        prefillPaymentChannel: "连连",
        prefillUserComplaintChannel: "400热线",
        prefillComplaintReceiveChannel: "客服群",
      });

      const listed = (await manager().externalAccount.list()).find((r) => r.id === created.id);
      expect(listed).toMatchObject({
        ticketCount: 0,
      });
      expect(listed?.prefill).toMatchObject({ channelId, channelName: "保司", project: "融盛" });
    });

    it("预填全空 → 六列皆 null", async () => {
      const created = await manager().externalAccount.create(accountArgs());

      const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({
        prefillChannelId: null,
        prefillProject: null,
        prefillBrokerageEntity: null,
        prefillPaymentChannel: null,
        prefillUserComplaintChannel: null,
        prefillComplaintReceiveChannel: null,
      });
    });

    it("预填引用的渠道不存在 → BAD_REQUEST", async () => {
      await expect(
        manager().externalAccount.create(
          accountArgs({ prefill: { channelId: "no-such-channel" } }),
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选反馈渠道不存在" });
    });

    it("预填可引用停用渠道 — 只校存在性,停用渠道照常盖章", async () => {
      const disabled = await prisma.channel.create({
        data: { name: "停用仍可选渠道", active: false, displayOrder: 900 },
      });
      const created = await manager().externalAccount.create(
        accountArgs({ prefill: { channelId: disabled.id } }),
      );
      const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.prefillChannelId).toBe(disabled.id);
    });

    it("外部角色不止一个 → PRECONDITION_FAILED, nothing written", async () => {
      const extra = await prisma.role.create({
        data: { name: "外部只读", permissions: ["ticket.process_external"] },
      });
      const args = accountArgs();
      try {
        await expect(manager().externalAccount.create(args)).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: "外部角色应恰好有 1 个，当前 2 个，无法创建外部账号",
        });
        expect(await prisma.user.findUnique({ where: { username: args.username } })).toBeNull();
      } finally {
        await prisma.role.delete({ where: { id: extra.id } });
      }
    });

    it("外部角色为零 → PRECONDITION_FAILED", async () => {
      const kept = externalRole.permissions;
      await prisma.role.update({ where: { id: externalRole.id }, data: { permissions: [] } });
      try {
        await expect(manager().externalAccount.create(accountArgs())).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: "外部角色应恰好有 1 个，当前 0 个，无法创建外部账号",
        });
      } finally {
        await prisma.role.update({
          where: { id: externalRole.id },
          data: { permissions: kept },
        });
      }
    });

    it("重复用户名 → CONFLICT", async () => {
      const args = accountArgs();
      await manager().externalAccount.create(args);
      await expect(
        manager().externalAccount.create(accountArgs({ username: args.username })),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("账号列表", () => {
    it("只列外部账号,内部账号不出现;提交工单数随单增长", async () => {
      const created = await manager().externalAccount.create(accountArgs());
      await createInternalUser();

      let rows = await manager().externalAccount.list();
      expect(rows.some((row) => row.id === created.id)).toBe(true);
      expect(rows.every((row) => !row.username.startsWith("internal-"))).toBe(true);

      const asAccount = harness.callerFor(
        await prisma.user.findUniqueOrThrow({ where: { id: created.id } }),
        externalRole,
      );
      await asAccount.externalTicket.submit({ submissionText: "计数用一单" });

      rows = await manager().externalAccount.list();
      expect(rows.find((row) => row.id === created.id)?.ticketCount).toBe(1);
    });
  });

  describe("编辑外部账号", () => {
    it("预填与白名单整体替换;不给则不动;空块即清空", async () => {
      const created = await manager().externalAccount.create(
        accountArgs({
          prefill: { project: "旧项目", paymentChannel: "旧支付" },
        }),
      );

      // 不给 prefill → 原值不动
      await manager().externalAccount.update(updateArgs(created.id));
      let row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({ prefillProject: "旧项目", prefillPaymentChannel: "旧支付" });

      // 整块替换
      await manager().externalAccount.update(
        updateArgs(created.id, {
          prefill: { channelId, project: "新项目" },
        }),
      );
      row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({
        prefillChannelId: channelId,
        prefillProject: "新项目",
        prefillPaymentChannel: null,
      });

      // 空块 → 归一 null(未配置)
      await manager().externalAccount.update(updateArgs(created.id, { prefill: {} }));
      row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({ prefillChannelId: null, prefillProject: null });
    });

    it("内部账号不是这扇门的对象", async () => {
      const internal = await createInternalUser();
      await expect(manager().externalAccount.update(updateArgs(internal.id))).rejects.toMatchObject(
        { code: "BAD_REQUEST", message: "该用户不是外部账号" },
      );
    });

    it("未知账号 → NOT_FOUND", async () => {
      await expect(
        manager().externalAccount.update(updateArgs("no-such-id")),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "用户不存在" });
    });

    it("重复用户名 → CONFLICT", async () => {
      const args = accountArgs();
      await manager().externalAccount.create(args);
      const other = await manager().externalAccount.create(accountArgs());

      await expect(
        manager().externalAccount.update(updateArgs(other.id, { username: args.username })),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("重置密码即刻踢掉在线会话", async () => {
      const created = await manager().externalAccount.create(accountArgs());
      const bystander = await manager().externalAccount.create(accountArgs());
      await seedSession(created.id);
      await seedSession(bystander.id);

      await manager().externalAccount.update(
        updateArgs(created.id, { password: "rotated-pass-1" }),
      );

      expect(await sessionCount(created.id)).toBe(0);
      expect(await sessionCount(bystander.id)).toBe(1);
    });
  });

  describe("禁用/启用", () => {
    it("禁用即刻踢掉在线会话,可再启用", async () => {
      const created = await manager().externalAccount.create(accountArgs());
      await seedSession(created.id);

      await manager().externalAccount.setActive({ id: created.id, active: false });
      expect(await sessionCount(created.id)).toBe(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).active).toBe(
        false,
      );

      await manager().externalAccount.setActive({ id: created.id, active: true });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).active).toBe(
        true,
      );
    });

    it("内部账号不是这扇门的对象", async () => {
      const internal = await createInternalUser();
      await expect(
        manager().externalAccount.setActive({ id: internal.id, active: false }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "该用户不是外部账号" });
    });

    it("禁用自己 → BAD_REQUEST", async () => {
      const created = await manager().externalAccount.create(accountArgs());
      const asSelf = harness.callerWith(
        await prisma.user.findUniqueOrThrow({ where: { id: created.id } }),
        externalRole,
        ["external_account.manage"],
      );
      await expect(
        asSelf.externalAccount.setActive({ id: created.id, active: false }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "不能禁用自己的账号" });
    });
  });

  describe("建出来的账号自带外部能力", () => {
    it("按初始密码登录,提交外部工单并自动盖上预填", async () => {
      const args = accountArgs({
        prefill: { channelId, project: "盖章项目" },
      });
      await manager().externalAccount.create(args);

      const userId = await new PasswordAuthProvider(prisma).authenticate({
        username: args.username,
        password: args.password,
      });
      expect(userId).not.toBeNull();

      const sessions = new SessionService(prisma, 3600);
      const identity = await sessions.validateSession(await sessions.createSession(userId ?? ""));
      // 权限与内外部判定走登录展开,而非测试自选的权限集 — 这正是"建号即可用"的验收点
      const asAccount = appRouter.createCaller({
        traceId: "external-account-test",
        user: identity,
        sessionToken: null,
      });

      const ticket = await asAccount.externalTicket.submit({ submissionText: "外部侧反馈一条" });
      await asAccount.externalTicket.addNote({ ticketId: ticket.id, content: "补充说明" });

      const detail = await asAccount.externalTicket.detail({ ticketId: ticket.id });
      expect(detail.ticket.workOrderNumber).toBe(ticket.workOrderNumber);
      expect(detail.processLogs.some((log) => log.remark === "补充说明")).toBe(true);

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(row).toMatchObject({ channelId, project: "盖章项目" });
    });
  });
});
