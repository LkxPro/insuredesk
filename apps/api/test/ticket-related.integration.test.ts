import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createComplaintTicket,
  type IntegrationHarness,
  startIntegrationHarness,
} from "./integration-harness.ts";

function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

describe("手动录入关联", () => {
  let harness: IntegrationHarness;
  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
  }, 180_000);
  afterAll(async () => harness?.stop());

  it("等待并发编辑完成后重新校验电话，不允许按旧匹配追加", async () => {
    const { users, roles } = harness.seeded;
    const caller = harness.callerFor(users.admin, roles.admin);
    const ticket = await createComplaintTicket(harness.prisma, {}, { phone: "13870000008" });
    const locked = barrier();
    const release = barrier();
    const editing = harness.prisma.$transaction(
      async (tx) => {
        await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
        await tx.ticketComplaintDetail.update({
          where: { ticketId: ticket.id },
          data: { phone: "13870000009" },
        });
        locked.resolve();
        await release.promise;
      },
      { timeout: 15_000 },
    );
    await locked.promise;
    const adding = caller.ticket
      .addRelatedNote({
        ticketId: ticket.id,
        match: { phone: "13870000008" },
        remark: "旧号码备注",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    let waiting = false;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await harness.prisma.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%tickets%') AS waiting`;
        if (rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      release.resolve();
    }
    await editing;
    expect(waiting).toBe(true);
    expect(await adding).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await caller.ticket.detail({ id: ticket.id })).processLogs).toEqual([]);
  });

  it("普通录入只关联自己可见的未完结工单，新权限允许关联他人和未分配单", async () => {
    const { users, roles } = harness.seeded;
    const phone = "13870000001";
    const own = await createComplaintTicket(harness.prisma, { creatorId: users.cs1.id }, { phone });
    const other = await createComplaintTicket(
      harness.prisma,
      { assigneeId: users.manager.id, status: "assigned" },
      { phone },
    );
    await createComplaintTicket(
      harness.prisma,
      { creatorId: users.cs1.id, status: "completed" },
      { phone },
    );
    await createComplaintTicket(
      harness.prisma,
      { creatorId: users.cs1.id, deletedAt: new Date() },
      { phone },
    );
    const caller = harness.callerWith(users.cs1, roles.frontline, ["ticket.create", "ticket.view"]);
    expect((await caller.ticket.findRelated({ phone })).map((row) => row.id)).toEqual([own.id]);
    const cross = harness.callerWith(users.cs1, roles.frontline, [
      "ticket.create",
      "ticket.view",
      "ticket.relate_all",
    ]);
    expect((await cross.ticket.findRelated({ phone })).map((row) => row.id).sort()).toEqual(
      [own.id, other.id].sort(),
    );
  });

  it("手动新增按可关联范围阻断，旧的强制创建参数不能绕过，完结单不阻断", async () => {
    const { users, roles } = harness.seeded;
    const caller = harness.callerWith(users.cs1, roles.frontline, ["ticket.create", "ticket.view"]);
    const phone = "13870000002";
    const other = await createComplaintTicket(harness.prisma, {}, { phone });
    const created = await caller.ticket.create({ phone });
    await expect(caller.ticket.create({ phone, allowDuplicate: true })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await harness.prisma.ticket.updateMany({
      where: { id: { in: [other.id, created.id] } },
      data: { status: "completed" },
    });
    await expect(caller.ticket.create({ phone })).resolves.toHaveProperty("id");
  });

  it("跨范围查看和补充备注独立于正式跟进，每次访问重新验证匹配和权限", async () => {
    const { users, roles } = harness.seeded;
    const match = { phone: "13870000003" };
    const ticket = await createComplaintTicket(
      harness.prisma,
      { nextContactTime: new Date("2027-01-01Z") },
      match,
    );
    const cross = harness.callerWith(users.cs1, roles.frontline, [
      "ticket.create",
      "ticket.view",
      "ticket.relate_all",
    ]);
    const restricted = harness.callerWith(users.cs1, roles.frontline, [
      "ticket.create",
      "ticket.view",
    ]);
    const input = { ticketId: ticket.id, match };
    await expect(cross.ticket.detail({ id: ticket.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await cross.ticket.relatedDetail(input)).toMatchObject({
      id: ticket.id,
      status: "unassigned",
    });
    await cross.ticket.addRelatedNote({ ...input, remark: "客户补充了付款凭证" });
    const detail = await cross.ticket.relatedDetail(input);
    expect(detail).toMatchObject({
      status: "unassigned",
      contactCount: 0,
      nextContactTime: "2027-01-01T00:00:00.000Z",
    });
    expect(detail.processLogs).toEqual([
      expect.objectContaining({
        action: "internal_note",
        remark: "客户补充了付款凭证",
        operatorName: users.cs1.name,
      }),
    ]);
    await expect(restricted.ticket.relatedDetail(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      restricted.ticket.addRelatedNote({ ...input, remark: "不能追加" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      cross.ticket.relatedDetail({ ...input, match: { phone: "13870000004" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await harness.prisma.ticket.update({ where: { id: ticket.id }, data: { status: "completed" } });
    await expect(
      cross.ticket.addRelatedNote({ ...input, remark: "已经完结" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await cross.ticket.findRelated(match)).toEqual([]);
  });

  it("同一匹配条件并发录入也只能创建一单", async () => {
    const { users, roles } = harness.seeded;
    const caller = harness.callerFor(users.manager, roles.csManager);
    const results = await Promise.allSettled([
      caller.ticket.create({ phone: "13870000005" }),
      caller.ticket.create({ contactPhone: "13870000005" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await caller.ticket.findRelated({ phone: "13870000005" })).toHaveLength(1);
  });

  it("全部匹配可访问，保单或电话命中去重，空条件不命中", async () => {
    const { users, roles } = harness.seeded;
    const caller = harness.callerFor(users.admin, roles.admin);
    for (let index = 0; index < 22; index++) {
      await createComplaintTicket(
        harness.prisma,
        { contactPhone: "13870000006" },
        { policyNumbers: ["MATCH600"] },
      );
    }
    expect(
      await caller.ticket.findRelated({ phone: "13870000006", policyNumbers: ["MATCH600"] }),
    ).toHaveLength(22);
    expect(await caller.ticket.findRelated({ policyNumbers: ["match600"] })).toEqual([]);
    expect(await caller.ticket.findRelated({})).toEqual([]);
  });

  it("仅内部可见、不通知外部，外部身份及缺少新增权限不能使用该能力", async () => {
    const { users, roles } = harness.seeded;
    const externalRole = await harness.prisma.role.create({
      data: { name: "关联外部", permissions: ["ticket.create_external"] },
    });
    const owner = await harness.prisma.user.create({
      data: { name: "外部提交者", username: "related-external", roleId: externalRole.id },
    });
    const ticket = await createComplaintTicket(
      harness.prisma,
      { source: "external_channel", creatorId: owner.id },
      { phone: "13870000007" },
    );
    const input = { ticketId: ticket.id, match: { phone: "13870000007" }, remark: "仅内部凭证" };
    const admin = harness.callerFor(users.admin, roles.admin);
    await admin.ticket.addRelatedNote(input);
    const external = harness.callerFor(owner, externalRole);
    expect((await external.externalTicket.detail({ ticketId: ticket.id })).processLogs).toEqual([]);
    expect(
      (await external.externalTicket.findRelated({ phone: "13870000007" }))[0]?.activityText,
    ).toBe("暂无处理记录");
    expect((await external.notification.list()).items).toEqual([]);
    const forbidden = harness.callerWith(owner, externalRole, [
      "ticket.create",
      "ticket.relate_all",
    ]);
    await expect(forbidden.ticket.findRelated(input.match)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(forbidden.ticket.relatedDetail(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(forbidden.ticket.addRelatedNote(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const readonly = harness.callerWith(users.cs1, roles.frontline, [
      "ticket.view",
      "ticket.relate_all",
    ]);
    await expect(readonly.ticket.addRelatedNote(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(admin.ticket.addRelatedNote({ ...input, remark: " " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await harness.prisma.ticket.update({
      where: { id: ticket.id },
      data: { deletedAt: new Date() },
    });
    await expect(admin.ticket.addRelatedNote(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
