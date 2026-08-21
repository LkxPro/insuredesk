import { ALL_PERMISSIONS, DEFAULT_SLA_POLICIES, type TicketCreateInput } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/routers/index.ts";
import { type AuthenticatedUser, effectivePermissions } from "../src/services/auth.service.ts";
import { listMyTodos } from "../src/services/todo.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

const HOUR_MS = 60 * 60 * 1000;
const FACTORY_POLICY_NAMES = DEFAULT_SLA_POLICIES.map((policy) => policy.name);

function factoryDefaults(name: string) {
  const defaults = DEFAULT_SLA_POLICIES.find((policy) => policy.name === name);
  if (!defaults) {
    throw new Error(`出厂策略「${name}」不存在`);
  }
  return defaults;
}

/**
 * Acceptance tests against a real Postgres: the SLA 策略 editor is
 * admin-only (sla.view / sla.edit), a saved policy takes effect immediately —
 * the next created ticket stamps dueAt from the new overdueHours and the next
 * 待办 evaluation judges by the new rules — while existing tickets keep their
 * dueAt (re-stamped only on a 时效策略引用 edit), and the shared
 * Zod contract rejects malformed rules at the API boundary.
 */
describe("SLA 策略配置 (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let policyId: (name: string) => string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    prisma = harness.prisma;
    seeded = harness.seeded;
    policyId = harness.slaPolicyId;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  function identityOf(user: User, role: Role): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      team: user.team,
      roleId: role.id,
      roleName: role.name,
      permissions: effectivePermissions(role),
      requiredTicketFields: [],
      isExternal: false,
    };
  }

  /** Caller with the given seeded user's identity, permissions from their role. */
  function callerFor(user: User, role: Role) {
    return appRouter.createCaller({
      traceId: "sla-test",
      user: identityOf(user, role),
      sessionToken: null,
    });
  }

  const admin = () => callerFor(seeded.users.admin, seeded.roles.admin);
  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);
  const frontline = () => callerFor(seeded.users.cs1, seeded.roles.frontline);
  const observer = () => callerFor(seeded.users.observer, seeded.roles.readOnly);

  const baseInput = () =>
    ({
      feedbackTime: "2026-07-09T02:00:00.000Z",
      project: "融盛",
      brokerageEntity: "东方大地",
      paymentChannel: "连连支付",
      policyNumbers: ["SLA2026071000001"],
      userFeedbackChannelId: null,
      customerName: "王小明",
      phone: "13800000000",
      customerRequest: "对保费收取金额有异议，要求核实并回复",
      nuclearBodyStatus: "待核实",
      hasContacted: false,
      slaPolicyId: policyId("一般投诉"),
      allowDuplicate: true,
    }) satisfies TicketCreateInput & { allowDuplicate?: boolean };

  /** dueAt − createdAt of a detail read, in whole hours. */
  function dueOffsetHours(detail: { createdAt: string; dueAt: string | null }): number {
    expect(detail.dueAt).not.toBeNull();
    return (
      (new Date(detail.dueAt as string).getTime() - new Date(detail.createdAt).getTime()) / HOUR_MS
    );
  }

  it("registers sla.view / sla.edit and factory-grants them to 管理员 only", () => {
    // 管理员动态持有全量权限点,两个点进 ALL_PERMISSIONS 即归管理员
    expect(ALL_PERMISSIONS).toContain("sla.view");
    expect(ALL_PERMISSIONS).toContain("sla.edit");
    // 访问与编辑限管理员: no other factory role holds either
    for (const role of [seeded.roles.csManager, seeded.roles.frontline, seeded.roles.readOnly]) {
      expect(role.permissions).not.toContain("sla.view");
      expect(role.permissions).not.toContain("sla.edit");
    }
  });

  it("sla.list returns the four factory policies in 目录序 with the seeded defaults", async () => {
    const policies = await admin().sla.list();
    expect(policies.map((policy) => policy.name)).toEqual(FACTORY_POLICY_NAMES);
    for (const policy of policies) {
      const expected = factoryDefaults(policy.name);
      expect(policy.firstResponseMinutes).toBe(expected.firstResponseMinutes);
      expect(policy.overdueHours).toBe(expected.overdueHours);
      expect(policy.reminderRules).toEqual(expected.reminderRules);
    }
  });

  it("sla.list rows carry the 目录实体字段: sortOrder 出厂序, active=true, description", async () => {
    const policies = await admin().sla.list();
    expect(policies.map((policy) => policy.sortOrder)).toEqual([1, 2, 3, 4]);
    for (const policy of policies) {
      expect(policy.id).toBeTruthy();
      expect(policy.active).toBe(true);
      expect(policy.description).toBeTruthy();
    }
  });

  describe("RBAC", () => {
    it("sla.list requires sla.view — even 客服主管 is refused", async () => {
      await expect(manager().sla.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(frontline().sla.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(observer().sla.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("sla.update requires sla.edit — sla.view alone can read but never write", async () => {
      const viewerOnly = appRouter.createCaller({
        traceId: "sla-test",
        user: {
          ...identityOf(seeded.users.observer, seeded.roles.readOnly),
          permissions: ["sla.view"],
          requiredTicketFields: [],
          isExternal: false,
        },
        sessionToken: null,
      });
      const payload = { id: policyId("特急投诉"), firstResponseMinutes: 30 };
      await expect(viewerOnly.sla.list()).resolves.toHaveLength(FACTORY_POLICY_NAMES.length);
      await expect(viewerOnly.sla.update(payload)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(manager().sla.update(payload)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("改 overdueHours 即时生效 (acceptance: 新建单受影响, 存量工单不变)", () => {
    it("tickets created after the save stamp the new dueAt; existing tickets keep theirs", async () => {
      const existing = await manager().ticket.create(baseInput());
      const existingBefore = await manager().ticket.detail({ id: existing.id });
      expect(dueOffsetHours(existingBefore)).toBe(48);

      await admin().sla.update({
        id: policyId("一般投诉"),
        firstResponseMinutes: 90,
        overdueHours: 24,
        reminderRules: factoryDefaults("一般投诉").reminderRules,
      });

      // 存量工单 dueAt 不变 — dueAt 建单一次算定
      const existingAfter = await manager().ticket.detail({ id: existing.id });
      expect(existingAfter.dueAt).toBe(existingBefore.dueAt);

      // 此后新建单按新 overdueHours 计算, and stamps the new 首响要求 text
      const created = await manager().ticket.create(baseInput());
      const detail = await manager().ticket.detail({ id: created.id });
      expect(dueOffsetHours(detail)).toBe(24);
      expect(detail.firstResponseRequirement).toBe("90分钟内完成首次响应");
    });

    it("不设超时: saving overdueHours = null makes new tickets never overdue", async () => {
      await admin().sla.update({
        id: policyId("高级投诉"),
        firstResponseMinutes: 120,
        overdueHours: null,
        reminderRules: factoryDefaults("高级投诉").reminderRules,
      });

      const created = await manager().ticket.create({
        ...baseInput(),
        slaPolicyId: policyId("高级投诉"),
      });
      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.dueAt).toBeNull();
    });

    it("改时效策略重算 dueAt 时用的是当前策略，不是建单时的", async () => {
      await admin().sla.update({
        id: policyId("加急投诉"),
        firstResponseMinutes: 60,
        overdueHours: 100,
        reminderRules: factoryDefaults("加急投诉").reminderRules,
      });

      const created = await manager().ticket.create(baseInput());
      await manager().ticket.edit({
        ...baseInput(),
        ticketId: created.id,
        slaPolicyId: policyId("加急投诉"),
      });

      const detail = await manager().ticket.detail({ id: created.id });
      expect(dueOffsetHours(detail)).toBe(100);
    });
  });

  describe("读时告警按新规则判定 (存量工单在下一次轮询就换口径)", () => {
    it("shrinking 特急 rolling intervalHours flips an existing ticket's todo immediately", async () => {
      const created = await manager().ticket.create({
        ...baseInput(),
        slaPolicyId: policyId("特急投诉"),
      });
      await manager().ticket.assign({ ticketId: created.id, assigneeId: seeded.users.cs1.id });
      await frontline().ticket.addComment({ ticketId: created.id, remark: "已电话联系客户" });

      const comment = await prisma.processLog.findFirstOrThrow({
        where: { ticketId: created.id, action: "comment" },
        orderBy: { at: "desc" },
      });
      // One frozen instant 3h after the comment, evaluated before and after
      // the policy change — only the rule differs between the two reads.
      const clock = { now: () => new Date(comment.at.getTime() + 3 * HOUR_MS) };
      const viewer = identityOf(seeded.users.cs1, seeded.roles.frontline);

      const before = await listMyTodos({ prisma, clock }, viewer);
      const beforeAlerts = before.items.find((item) => item.ticketId === created.id)?.alerts ?? [];
      // Default rule is every 12h — a 3h gap alerts nobody
      expect(beforeAlerts.some((alert) => alert.type === "rolling_follow_up")).toBe(false);

      await admin().sla.update({
        id: policyId("特急投诉"),
        firstResponseMinutes: 30,
        overdueHours: null,
        reminderRules: [{ type: "rolling_follow_up", intervalHours: 2 }],
      });

      const after = await listMyTodos({ prisma, clock }, viewer);
      const afterAlerts = after.items.find((item) => item.ticketId === created.id)?.alerts ?? [];
      // Same ticket, same instant: the 2h rule now judges the 3h gap overdue
      expect(afterAlerts.some((alert) => alert.type === "rolling_follow_up")).toBe(true);
    });
  });

  describe("表单校验 (shared Zod contract at the API boundary)", () => {
    const base = () => ({
      id: policyId("一般投诉"),
      firstResponseMinutes: 120,
      overdueHours: 48,
    });
    const checkpoint = (
      patch: Partial<{ checkpointHours: number; requiredCount: number; advanceMinutes: number }>,
    ) => [
      {
        type: "follow_up_checkpoint" as const,
        checkpointHours: 24,
        requiredCount: 1,
        advanceMinutes: 60,
        ...patch,
      },
    ];

    it("rejects advanceMinutes at or above its own checkpoint", async () => {
      await expect(
        admin().sla.update({
          ...base(),
          reminderRules: checkpoint({ checkpointHours: 1, advanceMinutes: 60 }),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("accepts advanceMinutes one minute below the checkpoint", async () => {
      await expect(
        admin().sla.update({
          ...base(),
          reminderRules: checkpoint({ checkpointHours: 1, advanceMinutes: 59 }),
        }),
      ).resolves.toMatchObject({ id: policyId("一般投诉"), name: "一般投诉" });
    });

    it("rejects non-positive numbers everywhere", async () => {
      await expect(
        admin().sla.update({ ...base(), firstResponseMinutes: 0, reminderRules: [] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        admin().sla.update({ ...base(), overdueHours: 0, reminderRules: [] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        admin().sla.update({
          ...base(),
          reminderRules: [{ type: "rolling_follow_up", intervalHours: 0 }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      // advanceMinutes = 0 parses at the read boundary but is a dead rule the
      // editor contract refuses (empty alert window)
      await expect(
        admin().sla.update({ ...base(), reminderRules: checkpoint({ advanceMinutes: 0 }) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("旧 complaintLevel 整体替换轨已拆除：携带即明确报错", async () => {
      const legacyPayload = {
        complaintLevel: "一般投诉",
        firstResponseMinutes: 120,
        overdueHours: 48,
        reminderRules: factoryDefaults("一般投诉").reminderRules,
      };
      const error = await admin()
        .sla.update(legacyPayload as never)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        admin().sla.update({ id: policyId("一般投诉"), complaintLevel: "一般投诉" } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("时效策略目录 CRUD（实体化）", () => {
    const newPolicyInput = {
      name: "VIP专线",
      description: "大客户专线：24 小时处理时限，首响 30 分钟。",
      firstResponseMinutes: 30,
      overdueHours: 24,
      reminderRules: [
        {
          type: "follow_up_checkpoint" as const,
          checkpointHours: 12,
          requiredCount: 1,
          advanceMinutes: 60,
        },
      ],
    };

    it("create 追加新策略：sortOrder 落末尾、恒启用", async () => {
      const created = await admin().sla.create(newPolicyInput);
      expect(created).toMatchObject({
        name: "VIP专线",
        description: newPolicyInput.description,
        sortOrder: 5,
        active: true,
        firstResponseMinutes: 30,
        overdueHours: 24,
      });

      const listed = await admin().sla.list();
      expect(listed.map((policy) => policy.name)).toContain("VIP专线");
      expect(listed.at(-1)?.name).toBe("VIP专线");
    });

    it("create 名称全表唯一：撞启用行与撞停用行同报 CONFLICT", async () => {
      await expect(
        admin().sla.create({ ...newPolicyInput, name: "一般投诉" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const retired = await admin().sla.create({ ...newPolicyInput, name: "已退役策略" });
      await admin().sla.setActive({ id: retired.id, active: false });
      await expect(
        admin().sla.create({ ...newPolicyInput, name: "已退役策略" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      // 复活后撞名判定不变
      await admin().sla.setActive({ id: retired.id, active: true });
    });

    it("create 拒绝 trim 后为空的名称", async () => {
      await expect(admin().sla.create({ ...newPolicyInput, name: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("update 按 id 分项更新：改名/描述/规则；缺席字段保持原值", async () => {
      const created = await admin().sla.create({ ...newPolicyInput, name: "银卡专线" });
      const renamed = await admin().sla.update({ id: created.id, name: "金卡专线" });
      expect(renamed.name).toBe("金卡专线");
      // 缺席字段原样保留
      expect(renamed.firstResponseMinutes).toBe(30);
      expect(renamed.overdueHours).toBe(24);
      expect(renamed.description).toBe(newPolicyInput.description);

      const edited = await admin().sla.update({
        id: created.id,
        description: null,
        overdueHours: null,
        reminderRules: [{ type: "rolling_follow_up", intervalHours: 6 }],
      });
      expect(edited.description).toBeNull();
      expect(edited.overdueHours).toBeNull();
      expect(edited.reminderRules).toEqual([{ type: "rolling_follow_up", intervalHours: 6 }]);
    });

    it("update 改名撞任何行（含停用行）即 CONFLICT；未知 id NOT_FOUND", async () => {
      const retiring = await admin().sla.create({ ...newPolicyInput, name: "待停用策略" });
      await admin().sla.setActive({ id: retiring.id, active: false });
      const other = await admin().sla.create({ ...newPolicyInput, name: "另一专线" });
      await expect(admin().sla.update({ id: other.id, name: "待停用策略" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(
        admin().sla.update({ id: "no-such-id", name: "无的放矢" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("sort 整组重排：顺序即新 sortOrder，list/options 随之；清单须恰好全覆盖", async () => {
      const before = await admin().sla.list();
      const reversed = [...before].reverse();
      const sorted = await admin().sla.sort({ policyIds: reversed.map((policy) => policy.id) });
      expect(sorted.map((policy) => policy.id)).toEqual(reversed.map((policy) => policy.id));
      expect(sorted.map((policy) => policy.sortOrder)).toEqual(
        reversed.map((_, index) => index + 1),
      );

      const options = await frontline().sla.options();
      expect(options.map((option) => option.id)).toEqual(
        sorted.filter((policy) => policy.active).map((policy) => policy.id),
      );

      await expect(
        admin().sla.sort({ policyIds: before.slice(1).map((policy) => policy.id) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        admin().sla.sort({ policyIds: [...before.map((policy) => policy.id), "no-such-id"] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      // 全覆盖但含重复 id：集合判定之外还须拒绝，否则 sortOrder 出缺口
      await expect(
        admin().sla.sort({
          policyIds: [...before.map((policy) => policy.id), before[0]?.id ?? ""],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      // 还原出厂序，免得后续用例读到重排后的目录
      const isFactory = (policy: { name: string }) =>
        (FACTORY_POLICY_NAMES as readonly string[]).includes(policy.name);
      const factoryIds = [
        ...before
          .filter(isFactory)
          .sort(
            (a, b) => FACTORY_POLICY_NAMES.indexOf(a.name) - FACTORY_POLICY_NAMES.indexOf(b.name),
          )
          .map((policy) => policy.id),
        ...before.filter((policy) => !isFactory(policy)).map((policy) => policy.id),
      ];
      await admin().sla.sort({ policyIds: factoryIds });
    });

    it("setActive 停用即退出 options，复活即回归；重复表态幂等", async () => {
      const victimId = policyId("加急投诉");
      const deactivated = await admin().sla.setActive({ id: victimId, active: false });
      expect(deactivated.active).toBe(false);
      expect((await frontline().sla.options()).map((option) => option.id)).not.toContain(victimId);
      // 完整 list 仍含停用行
      expect((await admin().sla.list()).find((policy) => policy.id === victimId)?.active).toBe(
        false,
      );

      const revived = await admin().sla.setActive({ id: victimId, active: true });
      expect(revived.active).toBe(true);
      expect((await frontline().sla.options()).map((option) => option.id)).toContain(victimId);

      await expect(
        admin().sla.setActive({ id: "no-such-id", active: false }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("新 mutations 均需 sla.edit（客服主管/一线/只读一律 FORBIDDEN）", async () => {
      for (const caller of [manager(), frontline(), observer()]) {
        await expect(caller.sla.create(newPolicyInput)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(caller.sla.update({ id: "any", name: "x" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(caller.sla.sort({ policyIds: ["any"] })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(caller.sla.setActive({ id: "any", active: false })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
    });
  });

  describe("sla.options（登录可用）", () => {
    it("未登录 UNAUTHORIZED；登录角色（无 sla.view）也可读", async () => {
      const anonymous = appRouter.createCaller({
        traceId: "sla-test",
        user: null,
        sessionToken: null,
      });
      await expect(anonymous.sla.options()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      const options = await observer().sla.options();
      const names = options.map((option) => option.name);
      // 出厂四条按目录序打头，新建启用策略随其后；停用行不出现
      expect(names.slice(0, 4)).toEqual(FACTORY_POLICY_NAMES);
      expect(names).toContain("VIP专线");
      expect(names).not.toContain("待停用策略");
      // 只载 id/name/description
      expect(Object.keys(options[0] ?? {}).sort()).toEqual(["description", "id", "name"]);
    });
  });

  describe("建单盖章（slaPolicyId 引用）", () => {
    it("引用建单：策略 id 落库，dueAt/要求串按策略配置盖章", async () => {
      const created = await manager().ticket.create(baseInput());
      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.slaPolicyId).toBe(policyId("一般投诉"));
      expect(detail.firstResponseRequirement).toBe(
        `${(await prisma.slaPolicy.findUniqueOrThrow({ where: { id: policyId("一般投诉") } })).firstResponseMinutes}分钟内完成首次响应`,
      );
      expect(detail.followUpFrequency).toBeTruthy();

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.slaPolicyId).toBe(policyId("一般投诉"));
    });

    it("引用缺失或已停用即拒绝（与缺行同错）", async () => {
      await expect(
        manager().ticket.create({ ...baseInput(), slaPolicyId: "no-such-id" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      const victimId = policyId("加急投诉");
      await admin().sla.setActive({ id: victimId, active: false });
      try {
        await expect(
          manager().ticket.create({ ...baseInput(), slaPolicyId: victimId }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      } finally {
        await admin().sla.setActive({ id: victimId, active: true });
      }
    });

    it("旧 complaintLevel 输入返回明确校验错误（建单/编辑同口径）", async () => {
      for (const legacy of [{ complaintLevel: "一般投诉" }, { complaintLevel: "" }]) {
        const error = await manager()
          .ticket.create({ ...baseInput(), ...legacy } as never)
          .catch((e: unknown) => e);
        expect(error).toMatchObject({ code: "BAD_REQUEST" });
        expect((error as Error).message).toContain("投诉等级文本轨已下线");
      }

      const created = await manager().ticket.create(baseInput());
      await expect(
        manager().ticket.edit({
          ...baseInput(),
          ticketId: created.id,
          complaintLevel: "加急投诉",
        } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
