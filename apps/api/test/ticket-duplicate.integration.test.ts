import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("ticket 查重（Testcontainers）", () => {
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

  const manager = () => harness.callerFor(seeded.users.manager, seeded.roles.csManager);
  const frontline = () => harness.callerFor(seeded.users.cs1, seeded.roles.frontline);
  const admin = () => harness.callerFor(seeded.users.admin, seeded.roles.admin);

  it("保单号精确相等、大小写敏感", async () => {
    await manager().ticket.create({ customerName: "保单精确", policyNumbers: ["PXD100"] });

    const hits = await frontline().ticket.findDuplicates({ policyNumbers: ["PXD100"] });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      customerName: "保单精确",
      displayStatus: "unassigned",
      matchedFields: ["policyNumbers"],
    });

    await expect(frontline().ticket.findDuplicates({ policyNumbers: ["pxd100"] })).resolves.toEqual(
      [],
    );
  });

  it("「无」等占位保单号不参与查重：互不命中、不挡创建，同数组真保单照常命中", async () => {
    await manager().ticket.create({ customerName: "占位-无", policyNumbers: ["无"] });
    await manager().ticket.create({ customerName: "占位-无保单", policyNumbers: ["无保单信息"] });
    await manager().ticket.create({ customerName: "占位-带真单", policyNumbers: ["无", "PXD900"] });

    await expect(frontline().ticket.findDuplicates({ policyNumbers: ["无"] })).resolves.toEqual([]);
    await expect(
      frontline().ticket.findDuplicates({ policyNumbers: ["无保单信息"] }),
    ).resolves.toEqual([]);

    const hits = await frontline().ticket.findDuplicates({ policyNumbers: ["无", "PXD900"] });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      customerName: "占位-带真单",
      matchedFields: ["policyNumbers"],
    });

    const created = await manager().ticket.create({
      customerName: "占位-再建",
      policyNumbers: ["无"],
    });
    expect(created.id).toBeDefined();
  });

  it("手机号 trim 后精确相等，不做归一化", async () => {
    await manager().ticket.create({ customerName: "手机精确", phone: "13811112222" });
    await manager().ticket.create({ customerName: "手机带空格", phone: "138 3333 4444" });

    const trimmed = await frontline().ticket.findDuplicates({ phone: "  13811112222  " });
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]).toMatchObject({ customerName: "手机精确", matchedFields: ["phone"] });

    await expect(frontline().ticket.findDuplicates({ phone: "13833334444" })).resolves.toEqual([]);
  });

  it("phone/contactPhone 2×2 交叉，matchedFields 按输入侧字段记", async () => {
    await manager().ticket.create({ customerName: "交叉-联系人", contactPhone: "13755556666" });
    await manager().ticket.create({ customerName: "交叉-客户", phone: "13766667777" });

    const viaPhone = await frontline().ticket.findDuplicates({ phone: "13755556666" });
    expect(viaPhone[0]).toMatchObject({ customerName: "交叉-联系人", matchedFields: ["phone"] });

    const viaContact = await frontline().ticket.findDuplicates({ contactPhone: "13766667777" });
    expect(viaContact[0]).toMatchObject({
      customerName: "交叉-客户",
      matchedFields: ["contactPhone"],
    });
  });

  it("保单号或手机号任一命中即返回，多单多字段各自记 matchedFields", async () => {
    await manager().ticket.create({
      customerName: "或-双中",
      policyNumbers: ["PXD200"],
      phone: "13611110000",
    });
    await manager().ticket.create({ customerName: "或-只中保单", policyNumbers: ["PXD300"] });

    const hits = await frontline().ticket.findDuplicates({
      policyNumbers: ["PXD200", "PXD300"],
      phone: "13611110000",
    });
    expect(hits.map((hit) => hit.customerName).sort()).toEqual(["或-双中", "或-只中保单"]);
    expect(hits.find((hit) => hit.customerName === "或-双中")?.matchedFields).toEqual([
      "policyNumbers",
      "phone",
    ]);
    expect(hits.find((hit) => hit.customerName === "或-只中保单")?.matchedFields).toEqual([
      "policyNumbers",
    ]);
  });

  it("排除软删工单；excludeTicketId 排除自身", async () => {
    const doomed = await manager().ticket.create({ customerName: "软删", phone: "13522223333" });
    await admin().ticket.delete({ ticketId: doomed.id });
    await expect(frontline().ticket.findDuplicates({ phone: "13522223333" })).resolves.toEqual([]);

    const self = await manager().ticket.create({ customerName: "自身", phone: "13533334444" });
    await expect(frontline().ticket.findDuplicates({ phone: "13533334444" })).resolves.toHaveLength(
      1,
    );
    await expect(
      frontline().ticket.findDuplicates({ phone: "13533334444", excludeTicketId: self.id }),
    ).resolves.toEqual([]);
  });

  it("命中超过 20 条时按最新处理时间倒序取前 20，有新高跟进的老单排在新建单前", async () => {
    let oldestId = "";
    const ids: string[] = [];
    for (let index = 0; index < 21; index++) {
      const created = await manager().ticket.create({
        customerName: `上限-${index}`,
        phone: "13300000007",
        allowDuplicate: true,
      });
      if (index === 0) {
        oldestId = created.id;
      }
      ids.push(created.id);
    }
    // 钉死创建时间，消除同毫秒并列对排序断言的干扰
    const base = new Date("2026-08-01T00:00:00.000Z").getTime();
    for (const [index, id] of ids.entries()) {
      await prisma.ticket.update({ where: { id }, data: { createdAt: new Date(base + index) } });
    }
    await manager().ticket.assign({ ticketId: oldestId, assigneeId: seeded.users.manager.id });
    await manager().ticket.addComment({ ticketId: oldestId, remark: "老单新跟进" });

    const hits = await frontline().ticket.findDuplicates({ phone: "13300000007" });
    expect(hits).toHaveLength(20);
    expect(hits[0]?.customerName).toBe("上限-0");
    expect(hits[0]?.activityText).toBe("老单新跟进");
    expect(hits[1]?.customerName).toBe("上限-20");
    expect(hits.map((hit) => hit.customerName)).not.toContain("上限-1");
  });

  it("findDuplicates 由 ticket.view 把守：一线可查查重（含他人工单），空权限被拒", async () => {
    const noPerms = harness.callerWith(seeded.users.cs1, seeded.roles.frontline, []);
    const attempt = noPerms.ticket.findDuplicates({ phone: "13811112222" });
    await expect(attempt).rejects.toThrowError(TRPCError);
    await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("create 提交兜底：命中 409，allowDuplicate 放行，全空查重字段不触发", async () => {
    await manager().ticket.create({
      customerName: "兜底",
      phone: "13411112222",
      policyNumbers: ["PXD400"],
    });

    await expect(
      manager().ticket.create({ customerName: "撞手机", phone: "13411112222" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      manager().ticket.create({ customerName: "撞保单", policyNumbers: ["PXD400"] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const forced = await manager().ticket.create({
      customerName: "撞手机",
      phone: "13411112222",
      allowDuplicate: true,
    });
    expect(forced.workOrderNumber).toBeDefined();

    const blank = await manager().ticket.create({ customerName: "无查重字段" });
    expect(blank.id).toBeDefined();
  });

  it("edit 提交兜底：改查重字段命中 409，放行/无关字段/自身排除各归其位", async () => {
    await manager().ticket.create({ customerName: "编辑-他", phone: "13211112222" });
    const mine = await manager().ticket.create({
      customerName: "编辑-我",
      phone: "13233334444",
      policyNumbers: ["PXD500"],
    });

    await expect(
      manager().ticket.edit({
        ticketId: mine.id,
        customerName: "编辑-我",
        phone: "13211112222",
        policyNumbers: ["PXD500"],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const forced = await manager().ticket.edit({
      ticketId: mine.id,
      customerName: "编辑-我",
      phone: "13211112222",
      policyNumbers: ["PXD500"],
      allowDuplicate: true,
    });
    expect(forced.changedFields).toEqual(["phone"]);

    // 查重字段未动的编辑不被存量重复阻塞（此刻 mine.phone 与他人相同）
    const unrelated = await manager().ticket.edit({
      ticketId: mine.id,
      customerName: "编辑-我2",
      phone: "13211112222",
      policyNumbers: ["PXD500"],
    });
    expect(unrelated.changedFields).toEqual(["customerName"]);

    const solo = await manager().ticket.create({
      customerName: "编辑-独",
      phone: "13255556666",
      policyNumbers: ["PXD600"],
    });
    const selfEdit = await manager().ticket.edit({
      ticketId: solo.id,
      customerName: "编辑-独",
      phone: "13255556666",
      policyNumbers: ["PXD601"],
    });
    expect(selfEdit.changedFields).toEqual(["policyNumbers"]);
  });

  it("命中条目带活动摘要：完结单=完结备注，未完结=最新处理记录，无记录退回创建时间", async () => {
    const open = await manager().ticket.create({
      customerName: "活动-未完结",
      phone: "13199990000",
      allowDuplicate: true,
    });
    await manager().ticket.assign({ ticketId: open.id, assigneeId: seeded.users.manager.id });
    await manager().ticket.addComment({ ticketId: open.id, remark: "已电话联系客户" });

    const done = await manager().ticket.create({
      customerName: "活动-完结",
      phone: "13199990000",
      allowDuplicate: true,
    });
    await manager().ticket.assign({ ticketId: done.id, assigneeId: seeded.users.manager.id });
    const completionStatus = await prisma.completionStatus.findFirstOrThrow();
    await manager().ticket.resolve({
      ticketId: done.id,
      completionStatusId: completionStatus.id,
      remark: "已按原路退回保费",
    });

    await manager().ticket.create({
      customerName: "活动-无记录",
      phone: "13199990000",
      allowDuplicate: true,
    });

    const hits = await frontline().ticket.findDuplicates({ phone: "13199990000" });
    const byName = (name: string) => hits.find((hit) => hit.customerName === name);

    expect(byName("活动-未完结")).toMatchObject({ activityText: "已电话联系客户" });
    expect(byName("活动-完结")).toMatchObject({ activityText: "已按原路退回保费" });
    expect(byName("活动-无记录")).toMatchObject({ activityText: "暂无处理记录" });
    expect(byName("活动-无记录")?.activityAt).toBe(byName("活动-无记录")?.createdAt);
  });
});
