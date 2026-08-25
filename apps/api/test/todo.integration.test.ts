import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/routers/index.ts";
import { listMyTodos } from "../src/services/todo.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("我的待办 read-time alerts (Testcontainers)", () => {
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

  function viewerFor(user: User, role: Role) {
    return {
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
    };
  }

  function callerFor(user: User, role: Role) {
    return appRouter.createCaller({
      traceId: "todo-test",
      user: viewerFor(user, role),
      sessionToken: null,
    });
  }

  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);

  function todosAt(user: User, role: Role, instant: Date) {
    return listMyTodos({ prisma, clock: { now: () => instant } }, viewerFor(user, role));
  }

  /** A fresh assignee per test, so todo lists never bleed across tests. */
  let assigneeSeq = 0;
  async function createAssignee() {
    assigneeSeq += 1;
    return prisma.user.create({
      data: {
        username: `todoassignee${assigneeSeq}`,
        name: `待办责任人${assigneeSeq}号`,
        roleId: seeded.roles.frontline.id,
        active: true,
      },
    });
  }

  const baseInput = {
    feedbackTime: "2026-07-09T02:00:00.000Z",
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    policyNumbers: ["P2026070900789"],
    userFeedbackChannelId: null,
    customerName: "赵待办",
    phone: "13800000003",
    customerRequest: "希望尽快跟进理赔",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    allowDuplicate: true,
  } satisfies TicketCreateInput & { allowDuplicate?: boolean };

  async function createTicket(policyName = "一般投诉") {
    const created = await manager().ticket.create({
      ...baseInput,
      slaPolicyId: harness.slaPolicyId(policyName),
    });
    const { createdAt } = await prisma.ticket.findUniqueOrThrow({
      where: { id: created.id },
      select: { createdAt: true },
    });
    return { ...created, createdAt };
  }

  function plus(base: Date, ms: number) {
    return new Date(base.getTime() + ms);
  }

  async function lastCommentAt(ticketId: string) {
    const log = await prisma.processLog.findFirstOrThrow({
      where: { ticketId, action: "comment" },
      orderBy: { at: "desc" },
      select: { at: true },
    });
    return log.at;
  }

  const typesOf = (item?: { alerts: Array<{ type: string }> }) =>
    item?.alerts.map((alert) => alert.type) ?? [];

  describe("告警归属 (assigneeId 恒 = 当前用户)", () => {
    it("未分配工单不进任何人的待办——即使已经超时", async () => {
      const bystander = await createAssignee();
      const ticket = await createTicket();

      const wayPastDue = plus(ticket.createdAt, 100 * HOUR);
      expect((await todosAt(seeded.users.manager, seeded.roles.csManager, wayPastDue)).count).toBe(
        0,
      );
      expect((await todosAt(bystander, seeded.roles.frontline, wayPastDue)).count).toBe(0);
    });

    it("主管虽有 ticket.view_all，待办也只看自己名下", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket();
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });

      const instant = plus(ticket.createdAt, 3 * HOUR);
      const ownerTodos = await todosAt(owner, seeded.roles.frontline, instant);
      expect(ownerTodos.count).toBe(1);
      expect(ownerTodos.items[0]?.ticketId).toBe(ticket.id);
      expect(ownerTodos.items[0]?.slaPolicyName).toBe("一般投诉");
      expect(ownerTodos.items[0]).not.toHaveProperty("complaintLevel");

      expect((await todosAt(seeded.users.manager, seeded.roles.csManager, instant)).count).toBe(0);
    });

    it("改派后告警随 assigneeId 实时切换", async () => {
      const oldOwner = await createAssignee();
      const newOwner = await createAssignee();
      const ticket = await createTicket();
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: oldOwner.id });

      const instant = plus(ticket.createdAt, 23 * HOUR + 30 * MINUTE);
      const before = await todosAt(oldOwner, seeded.roles.frontline, instant);
      expect(before.items.map((item) => item.ticketId)).toEqual([ticket.id]);
      expect(typesOf(before.items[0])).toEqual(["awaiting_first_response", "follow_up_checkpoint"]);

      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: newOwner.id });

      expect((await todosAt(oldOwner, seeded.roles.frontline, instant)).count).toBe(0);
      const after = await todosAt(newOwner, seeded.roles.frontline, instant);
      expect(after.items.map((item) => item.ticketId)).toEqual([ticket.id]);
      expect(typesOf(after.items[0])).toEqual(["awaiting_first_response", "follow_up_checkpoint"]);
    });

    it("completed 后全部告警停止（掉出清单）", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket();
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });

      const wayPastDue = plus(ticket.createdAt, 100 * HOUR);
      expect((await todosAt(owner, seeded.roles.frontline, wayPastDue)).count).toBe(1);

      const status = await prisma.completionStatus.findUniqueOrThrow({
        where: { name: "正常完结" },
      });
      await callerFor(owner, seeded.roles.frontline).ticket.resolve({
        ticketId: ticket.id,
        completionStatusId: status.id,
        remark: "已与客户达成一致",
      });

      expect((await todosAt(owner, seeded.roles.frontline, wayPastDue)).count).toBe(0);
    });
  });

  describe("待首响 (常驻 + 染红阈值)", () => {
    it("从被分配起常驻待办；严格超过 firstResponseMinutes 由黄转红，仅严重度提升", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket(); // 一般投诉: 红线 120 分钟
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });

      const fresh = await todosAt(owner, seeded.roles.frontline, plus(ticket.createdAt, MINUTE));
      expect(typesOf(fresh.items[0])).toEqual(["awaiting_first_response"]);
      expect(fresh.items[0]?.alerts[0]?.severity).toBe("warning");

      // exactly on the red line: 超过 is strict, still warning
      const onTheLine = await todosAt(
        owner,
        seeded.roles.frontline,
        plus(ticket.createdAt, 120 * MINUTE),
      );
      expect(onTheLine.items[0]?.alerts[0]?.severity).toBe("warning");

      const pastTheLine = await todosAt(
        owner,
        seeded.roles.frontline,
        plus(ticket.createdAt, 120 * MINUTE + 1),
      );
      expect(typesOf(pastTheLine.items[0])).toEqual(["awaiting_first_response"]);
      expect(pastTheLine.items[0]?.alerts[0]?.severity).toBe("critical");
      expect(pastTheLine.items[0]?.severity).toBe("critical");
    });

    it("第一条 comment 即掉出待首响", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket();
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });
      await callerFor(owner, seeded.roles.frontline).ticket.addComment({
        ticketId: ticket.id,
        remark: "已电话联系客户",
      });

      expect(
        (await todosAt(owner, seeded.roles.frontline, plus(ticket.createdAt, 130 * MINUTE))).count,
      ).toBe(0);
    });
  });

  describe("follow_up_checkpoint (窗口两端 + 累计口径)", () => {
    it("提前量起点含、检查点终点不含 (一般投诉 {24h,1次,提前60min})", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket();
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });
      const checkpointTypesAt = async (offsetMs: number) =>
        typesOf(
          (await todosAt(owner, seeded.roles.frontline, plus(ticket.createdAt, offsetMs))).items[0],
        );

      expect(await checkpointTypesAt(23 * HOUR - 1)).toEqual(["awaiting_first_response"]);
      expect(await checkpointTypesAt(23 * HOUR)).toEqual([
        "awaiting_first_response",
        "follow_up_checkpoint",
      ]);
      expect(await checkpointTypesAt(24 * HOUR - 1)).toEqual([
        "awaiting_first_response",
        "follow_up_checkpoint",
      ]);
      expect(await checkpointTypesAt(24 * HOUR)).toEqual(["awaiting_first_response"]);
    });

    it("补齐跟进自动掉出；后续检查点按自 createdAt 的累计数判定", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket(); // 一般投诉: {24h,1次}、{48h,2次,提前180min}
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });
      await callerFor(owner, seeded.roles.frontline).ticket.addComment({
        ticketId: ticket.id,
        remark: "首次跟进",
      });

      expect(
        (await todosAt(owner, seeded.roles.frontline, plus(ticket.createdAt, 23.5 * HOUR))).count,
      ).toBe(0);

      const at45h = await todosAt(owner, seeded.roles.frontline, plus(ticket.createdAt, 45 * HOUR));
      expect(typesOf(at45h.items[0])).toEqual(["follow_up_checkpoint"]);
      expect(at45h.items[0]?.alerts[0]?.message).toBe("48 小时检查点将至：已跟进 1/2 次");
    });

    it("累计跨责任人：改派后新责任人看到全单累计次数", async () => {
      const first = await createAssignee();
      const second = await createAssignee();
      const ticket = await createTicket("加急投诉"); // {24h,2次,提前60min}
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: first.id });
      await callerFor(first, seeded.roles.frontline).ticket.addComment({
        ticketId: ticket.id,
        remark: "第一次跟进",
      });
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: second.id });

      const inWindow = plus(ticket.createdAt, 23 * HOUR + 30 * MINUTE);
      const before = await todosAt(second, seeded.roles.frontline, inWindow);
      expect(typesOf(before.items[0])).toEqual(["follow_up_checkpoint"]);
      expect(before.items[0]?.alerts[0]?.message).toBe("24 小时检查点将至：已跟进 1/2 次");

      await callerFor(second, seeded.roles.frontline).ticket.addComment({
        ticketId: ticket.id,
        remark: "第二次跟进",
      });
      expect((await todosAt(second, seeded.roles.frontline, inWindow)).count).toBe(0);
    });
  });

  describe("slaAnchorAt 计时锚（首响/检查点按锚点起算）", () => {
    it("锚早于录入 12h：首响红线与 24h 检查点按锚点判定，不按录入时刻", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket(); // 一般投诉: 红线 120min; {24h,1次,提前60min}
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });
      // 退费口径：slaAnchorAt = 平台 refundCreateTime，可早于录入 12h
      const anchor = plus(ticket.createdAt, -12 * HOUR);
      await prisma.ticket.update({ where: { id: ticket.id }, data: { slaAnchorAt: anchor } });

      const oneHourIn = await todosAt(owner, seeded.roles.frontline, plus(ticket.createdAt, HOUR));
      const firstResponse = oneHourIn.items[0]?.alerts[0];
      expect(firstResponse?.type).toBe("awaiting_first_response");
      expect(firstResponse?.severity).toBe("critical");
      expect(firstResponse?.message).toBe("尚未首次跟进，已等待 13 小时");

      const elevenHalf = await todosAt(
        owner,
        seeded.roles.frontline,
        plus(ticket.createdAt, 11.5 * HOUR),
      );
      expect(typesOf(elevenHalf.items[0])).toEqual([
        "awaiting_first_response",
        "follow_up_checkpoint",
      ]);
      expect(elevenHalf.items[0]?.alerts[1]?.message).toBe("24 小时检查点将至：已跟进 0/1 次");
    });
  });

  describe("rolling_follow_up (特急滚动欠跟进)", () => {
    it("尚无 comment 时不滚动——常驻的待首响已覆盖", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket("特急投诉");
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });

      const todos = await todosAt(owner, seeded.roles.frontline, plus(ticket.createdAt, 13 * HOUR));
      expect(typesOf(todos.items[0])).toEqual(["awaiting_first_response"]);
    });

    it("距上一条 comment 满 intervalHours 进入待办（含边界）；特急永无 due_soon/overdue", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket("特急投诉"); // intervalHours = 12
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });
      await callerFor(owner, seeded.roles.frontline).ticket.addComment({
        ticketId: ticket.id,
        remark: "已触达客户",
      });
      const commentAt = await lastCommentAt(ticket.id);

      expect(
        (await todosAt(owner, seeded.roles.frontline, plus(commentAt, 12 * HOUR - 1))).count,
      ).toBe(0);

      const onTheDot = await todosAt(owner, seeded.roles.frontline, plus(commentAt, 12 * HOUR));
      expect(typesOf(onTheDot.items[0])).toEqual(["rolling_follow_up"]);
      expect(onTheDot.items[0]?.alerts[0]?.severity).toBe("critical");

      const muchLater = await todosAt(owner, seeded.roles.frontline, plus(commentAt, 1000 * HOUR));
      expect(typesOf(muchLater.items[0])).toEqual(["rolling_follow_up"]);
      expect(muchLater.items[0]?.dueAt).toBeNull();
    });

    it("再次跟进即重置滚动基准", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket("特急投诉");
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });
      const caller = callerFor(owner, seeded.roles.frontline);
      await caller.ticket.addComment({ ticketId: ticket.id, remark: "第一次触达" });
      await caller.ticket.addComment({ ticketId: ticket.id, remark: "第二次触达" });
      const latest = await lastCommentAt(ticket.id);

      expect((await todosAt(owner, seeded.roles.frontline, plus(latest, 11 * HOUR))).count).toBe(0);
      expect((await todosAt(owner, seeded.roles.frontline, plus(latest, 12 * HOUR))).count).toBe(1);
    });
  });

  describe("due_soon / overdue (复用时间谓词单一真源)", () => {
    it("与列表计算状态同刻变化：不足 2h 严格进入、dueAt 瞬间仍 due_soon、严格超过才 overdue", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket(); // 一般投诉: dueAt = createdAt + 48h
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });
      const caller = callerFor(owner, seeded.roles.frontline);
      // two comments satisfy both checkpoints (1@24h, 2@48h) and 待首响, so
      // only the deadline predicates remain in play
      await caller.ticket.addComment({ ticketId: ticket.id, remark: "第一次跟进" });
      await caller.ticket.addComment({ ticketId: ticket.id, remark: "第二次跟进" });
      const todoTypesAt = async (offsetMs: number) => {
        const todos = await todosAt(
          owner,
          seeded.roles.frontline,
          plus(ticket.createdAt, offsetMs),
        );
        return todos.items[0] ? typesOf(todos.items[0]) : [];
      };

      expect(await todoTypesAt(46 * HOUR)).toEqual([]); // 不足 2 小时 is strict
      expect(await todoTypesAt(46 * HOUR + 1)).toEqual(["due_soon"]);
      expect(await todoTypesAt(48 * HOUR)).toEqual(["due_soon"]); // 已超过 is strict
      expect(await todoTypesAt(48 * HOUR + 1)).toEqual(["overdue"]);
    });
  });

  describe("改等级 (规则随当前 SLAPolicy)", () => {
    it("已过检查点不补发；dueAt、染红线与后续检查点按新等级判定", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket(); // born 一般投诉 (dueAt 48h, 红线 120min)
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });
      await manager().ticket.edit({
        ...baseInput,
        ticketId: ticket.id,
        slaPolicyId: harness.slaPolicyId("加急投诉"),
      });
      const todosFor = (offsetMs: number) =>
        todosAt(owner, seeded.roles.frontline, plus(ticket.createdAt, offsetMs));

      expect((await todosFor(90 * MINUTE)).items[0]?.alerts[0]?.severity).toBe("critical");

      expect(await todosFor(30 * HOUR).then((t) => typesOf(t.items[0]))).toEqual([
        "awaiting_first_response",
      ]);

      const at45h30 = await todosFor(45 * HOUR + 30 * MINUTE);
      expect(typesOf(at45h30.items[0])).toEqual([
        "awaiting_first_response",
        "follow_up_checkpoint",
      ]);
      expect(at45h30.items[0]?.alerts[1]?.message).toBe("48 小时检查点将至：已跟进 0/4 次");

      expect(await todosFor(49 * HOUR).then((t) => typesOf(t.items[0]))).not.toContain("overdue");
      expect(await todosFor(72 * HOUR + 1).then((t) => typesOf(t.items[0]))).toContain("overdue");
    });
  });

  describe("策略停用语义 (引用停用策略的工单走缺行降级路径，不抛错)", () => {
    it("停用后：检查点/染红消失，待首响与 due_soon/overdue 照常", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket(); // 一般投诉: dueAt 48h, 红线 120min, {24h,1次,提前60min}
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });
      const policy = await prisma.slaPolicy.findUniqueOrThrow({
        where: { name: "一般投诉" },
      });
      const at = (offsetMs: number) =>
        todosAt(owner, seeded.roles.frontline, plus(ticket.createdAt, offsetMs));

      expect(typesOf((await at(23.5 * HOUR)).items[0])).toEqual([
        "awaiting_first_response",
        "follow_up_checkpoint",
      ]);

      await prisma.slaPolicy.update({ where: { id: policy.id }, data: { active: false } });
      try {
        const degraded = await at(23.5 * HOUR);
        expect(typesOf(degraded.items[0])).toEqual(["awaiting_first_response"]);

        const pastRedLine = await at(3 * HOUR);
        expect(typesOf(pastRedLine.items[0])).toEqual(["awaiting_first_response"]);
        expect(pastRedLine.items[0]?.severity).toBe("warning");

        expect(typesOf((await at(47 * HOUR)).items[0])).toEqual([
          "awaiting_first_response",
          "due_soon",
        ]);
        expect(typesOf((await at(49 * HOUR)).items[0])).toEqual([
          "awaiting_first_response",
          "overdue",
        ]);
      } finally {
        await prisma.slaPolicy.update({ where: { id: policy.id }, data: { active: true } });
      }
    });
  });

  describe("轨道合并 (送达: 一次请求)", () => {
    it("notification.list 同时携带轨 1 收件箱与轨 2 待办", async () => {
      const owner = await createAssignee();
      const ticket = await createTicket();
      await manager().ticket.assign({ ticketId: ticket.id, assigneeId: owner.id });

      // Under the real clock the freshly assigned ticket sits in the todo via
      // the threshold-free 常驻 待首响 — deterministic seconds after creation
      const poll = await callerFor(owner, seeded.roles.frontline).notification.list();
      expect(poll.unreadCount).toBe(1);
      expect(poll.items[0]?.type).toBe("assigned");
      expect(poll.todo.count).toBe(1);
      expect(poll.todo.items[0]?.ticketId).toBe(ticket.id);
      expect(poll.todo.items[0]?.workOrderNumber).toBe(ticket.workOrderNumber);
      expect(typesOf(poll.todo.items[0])).toEqual(["awaiting_first_response"]);
    });
  });
});
