import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import type { PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Issue #25 acceptance tests against a real Postgres: assignment writes the
 * 轨 1 `assigned` notification to the NEW assignee inside the same transaction
 * (single and batch through the one shared path), 改派 annotates the remaining
 * time, and the inbox read/mark-read flows are pinned to the viewer. Runs
 * through appRouter.createCaller — the same procedure pipeline the HTTP
 * adapter uses.
 */
describe("assigned notifications (Testcontainers)", () => {
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

  function callerFor(user: User, role: Role) {
    return appRouter.createCaller({
      traceId: "notification-test",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        roleId: role.id,
        roleName: role.name,
        permissions: role.permissions as Permission[],
        requiredTicketFields: [],
      },
      sessionToken: null,
    });
  }

  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);

  /** A fresh recipient per counting test, so inboxes never bleed across tests. */
  let recipientSeq = 0;
  async function createRecipient() {
    recipientSeq += 1;
    return prisma.user.create({
      data: {
        username: `recipient${recipientSeq}`,
        name: `收件人${recipientSeq}号`,
        roleId: seeded.roles.frontline.id,
        active: true,
      },
    });
  }

  const baseInput = {
    feedbackTime: "2026-07-09T02:00:00.000Z",
    channel: "保司",
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    policyNumber: "P2026070900456",
    userComplaintChannel: "400热线",
    customerName: "钱通知",
    phone: "13800000002",
    customerRequest: "希望尽快跟进理赔",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    category: "理赔投诉",
    complaintLevel: "一般投诉",
  } satisfies TicketCreateInput;

  /** A fresh unassigned ticket, created through the real create procedure. */
  async function createTicket(
    complaintLevel: TicketCreateInput["complaintLevel"] = baseInput.complaintLevel,
  ) {
    return manager().ticket.create({ ...baseInput, complaintLevel });
  }

  describe("assignment writes the notification (轨 1, same transaction)", () => {
    it("首次分配: one assigned notification targets the NEW assignee, stamped at the assignment instant", async () => {
      const recipient = await createRecipient();
      const created = await createTicket();

      await manager().ticket.assign({ ticketId: created.id, assigneeId: recipient.id });

      const inbox = await callerFor(recipient, seeded.roles.frontline).notification.list();
      expect(inbox.unreadCount).toBe(1);
      expect(inbox.items).toHaveLength(1);
      expect(inbox.items[0]).toEqual({
        id: expect.any(String),
        type: "assigned",
        title: "新工单分配",
        content: `${seeded.users.manager.name} 将工单 ${created.workOrderNumber} 分配给你`,
        ticketId: created.id,
        workOrderNumber: created.workOrderNumber,
        read: false,
        createdAt: expect.any(String),
      });

      // Same instant as the assignment itself: one shared `now` per action
      const detail = await manager().ticket.detail({ id: created.id });
      expect(inbox.items[0]?.createdAt).toBe(detail.assignedAt);
    });

    it("改派: the NEW assignee is notified with the remaining time; the old assignee gets nothing new", async () => {
      const oldOwner = await createRecipient();
      const newOwner = await createRecipient();
      const created = await createTicket();
      await manager().ticket.assign({ ticketId: created.id, assigneeId: oldOwner.id });

      await manager().ticket.assign({ ticketId: created.id, assigneeId: newOwner.id });

      const newInbox = await callerFor(newOwner, seeded.roles.frontline).notification.list();
      expect(newInbox.items).toHaveLength(1);
      expect(newInbox.items[0]?.title).toBe("工单改派");
      // 一般投诉 dueAt = createdAt + 48h, reassigned moments later → hours remain
      expect(newInbox.items[0]?.content).toMatch(
        new RegExp(
          `^${seeded.users.manager.name} 将工单 ${created.workOrderNumber} 改派给你（剩余处理时间 .+）$`,
        ),
      );

      const oldInbox = await callerFor(oldOwner, seeded.roles.frontline).notification.list();
      expect(oldInbox.items).toHaveLength(1); // still only the original 分配
      expect(oldInbox.items[0]?.title).toBe("新工单分配");
    });

    it("改派 a no-deadline ticket (特急) annotates 无处理时限", async () => {
      const oldOwner = await createRecipient();
      const newOwner = await createRecipient();
      const created = await createTicket("特急投诉");
      await manager().ticket.assign({ ticketId: created.id, assigneeId: oldOwner.id });

      await manager().ticket.assign({ ticketId: created.id, assigneeId: newOwner.id });

      const inbox = await callerFor(newOwner, seeded.roles.frontline).notification.list();
      expect(inbox.items[0]?.content).toBe(
        `${seeded.users.manager.name} 将工单 ${created.workOrderNumber} 改派给你（无处理时限）`,
      );
    });

    it("批量分配 shares the same write path: one notification per ticket, none for the already-owned skip", async () => {
      const recipient = await createRecipient();
      const fresh1 = await createTicket();
      const fresh2 = await createTicket();
      const alreadyTheirs = await createTicket();
      await manager().ticket.assign({ ticketId: alreadyTheirs.id, assigneeId: recipient.id });

      await manager().ticket.batchAssign({
        ticketIds: [fresh1.id, fresh2.id, alreadyTheirs.id],
        assigneeId: recipient.id,
      });

      const inbox = await callerFor(recipient, seeded.roles.frontline).notification.list();
      // 1 from the setup assign + 2 from the batch; the no-op skip wrote nothing
      expect(inbox.items).toHaveLength(3);
      expect(inbox.items.map((item) => item.workOrderNumber).sort()).toEqual(
        [fresh1.workOrderNumber, fresh2.workOrderNumber, alreadyTheirs.workOrderNumber].sort(),
      );
    });

    it("an aborted batch leaves no notification (transaction rollback)", async () => {
      const recipient = await createRecipient();
      const ok = await createTicket();
      const completed = await createTicket();
      await prisma.ticket.update({ where: { id: completed.id }, data: { status: "completed" } });

      await expect(
        manager().ticket.batchAssign({
          ticketIds: [ok.id, completed.id],
          assigneeId: recipient.id,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      const inbox = await callerFor(recipient, seeded.roles.frontline).notification.list();
      expect(inbox.items).toHaveLength(0);
      expect(inbox.unreadCount).toBe(0);
    });
  });

  describe("inbox reads (viewer-pinned)", () => {
    it("lists own notifications newest first, capped at limit, with the full unread count", async () => {
      const recipient = await createRecipient();
      const tickets = [await createTicket(), await createTicket(), await createTicket()];
      for (const ticket of tickets) {
        await manager().ticket.assign({ ticketId: ticket.id, assigneeId: recipient.id });
      }

      const inbox = await callerFor(recipient, seeded.roles.frontline).notification.list({
        limit: 2,
      });
      expect(inbox.items).toHaveLength(2); // capped by limit…
      expect(inbox.unreadCount).toBe(3); // …but the badge counts everything unread
      // Newest first: the last-assigned ticket leads
      expect(inbox.items[0]?.workOrderNumber).toBe(tickets[2]?.workOrderNumber);
      expect(inbox.items[1]?.workOrderNumber).toBe(tickets[1]?.workOrderNumber);
    });

    it("never returns someone else's notifications", async () => {
      const someoneElse = await createRecipient();
      const bystander = await createRecipient();
      const created = await createTicket();
      await manager().ticket.assign({ ticketId: created.id, assigneeId: someoneElse.id });

      const inbox = await callerFor(bystander, seeded.roles.frontline).notification.list();
      expect(inbox.items).toHaveLength(0);
      expect(inbox.unreadCount).toBe(0);
    });
  });

  describe("read state (已读流转)", () => {
    it("markRead flips one notification and the unread count; repeat calls are idempotent", async () => {
      const recipient = await createRecipient();
      const first = await createTicket();
      const second = await createTicket();
      await manager().ticket.assign({ ticketId: first.id, assigneeId: recipient.id });
      await manager().ticket.assign({ ticketId: second.id, assigneeId: recipient.id });

      const caller = callerFor(recipient, seeded.roles.frontline);
      const before = await caller.notification.list();
      const target = before.items.find((item) => item.ticketId === first.id);
      expect(target).toBeDefined();
      if (!target) {
        return;
      }

      await caller.notification.markRead({ id: target.id });
      await caller.notification.markRead({ id: target.id }); // idempotent

      const after = await caller.notification.list();
      expect(after.unreadCount).toBe(1);
      expect(after.items.find((item) => item.id === target.id)?.read).toBe(true);
      expect(after.items.find((item) => item.ticketId === second.id)?.read).toBe(false);
    });

    it("markRead on someone else's notification is a silent no-op (no leak, no change)", async () => {
      const owner = await createRecipient();
      const intruder = await createRecipient();
      const created = await createTicket();
      await manager().ticket.assign({ ticketId: created.id, assigneeId: owner.id });

      const ownerCaller = callerFor(owner, seeded.roles.frontline);
      const { items } = await ownerCaller.notification.list();
      const notificationId = items[0]?.id;
      expect(notificationId).toBeDefined();
      if (!notificationId) {
        return;
      }

      await callerFor(intruder, seeded.roles.frontline).notification.markRead({
        id: notificationId,
      });

      const after = await ownerCaller.notification.list();
      expect(after.items[0]?.read).toBe(false);
      expect(after.unreadCount).toBe(1);
    });

    it("markAllRead clears the viewer's badge and nobody else's", async () => {
      const recipient = await createRecipient();
      const bystander = await createRecipient();
      for (const ticket of [await createTicket(), await createTicket()]) {
        await manager().ticket.assign({ ticketId: ticket.id, assigneeId: recipient.id });
      }
      const bystanderTicket = await createTicket();
      await manager().ticket.assign({ ticketId: bystanderTicket.id, assigneeId: bystander.id });

      await callerFor(recipient, seeded.roles.frontline).notification.markAllRead();

      const cleared = await callerFor(recipient, seeded.roles.frontline).notification.list();
      expect(cleared.unreadCount).toBe(0);
      expect(cleared.items.every((item) => item.read)).toBe(true);

      const untouched = await callerFor(bystander, seeded.roles.frontline).notification.list();
      expect(untouched.unreadCount).toBe(1);
    });
  });

  describe("auth", () => {
    it("rejects every notification procedure without a session", async () => {
      const anonymous = appRouter.createCaller({
        traceId: "notification-test",
        user: null,
        sessionToken: null,
      });

      await expect(anonymous.notification.list()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(anonymous.notification.markRead({ id: "n1" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(anonymous.notification.markAllRead()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });
});
