import type { Permission } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("工单种类 catalog (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    prisma = harness.prisma;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const manager = () =>
    harness.callerWith(harness.seeded.users.manager, harness.seeded.roles.csManager, [
      "dictionary.manage",
    ] as Permission[]);
  const frontline = () =>
    harness.callerWith(harness.seeded.users.cs1, harness.seeded.roles.frontline, [
      "ticket.view",
    ] as Permission[]);

  it("迁移播种行为绑定两行：投诉(complaint) 与 退费异常(refund_exception)，全启用按序", async () => {
    const rows = await prisma.ticketKind.findMany({ orderBy: { displayOrder: "asc" } });
    expect(rows.map((row) => [row.key, row.name, row.active, row.displayOrder])).toEqual([
      ["complaint", "投诉", true, 1],
      ["refund_exception", "退费异常", true, 2],
    ]);

    const list = await manager().ticketKind.list();
    expect(list.map((row) => row.name)).toEqual(["投诉", "退费异常"]);
  });

  it("新增同形状种类：服务端生成稳定 key；改名/排序/启停走目录工厂语义", async () => {
    const router = manager().ticketKind;
    const created = await router.create({ name: "  咨询  " });
    expect(created).toMatchObject({ name: "咨询", active: true });

    const stored = await prisma.ticketKind.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.key).toBeTruthy();

    const renamed = await router.update({ id: created.id, name: "咨询件" });
    expect(renamed.name).toBe("咨询件");
    // key 不可改：update 输入没有 key 口，改名后 key 原样
    expect((await prisma.ticketKind.findUniqueOrThrow({ where: { id: created.id } })).key).toBe(
      stored.key,
    );

    const complaint = await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } });
    const refund = await prisma.ticketKind.findUniqueOrThrow({
      where: { key: "refund_exception" },
    });
    await router.reorder({ ids: [refund.id, complaint.id, created.id] });
    expect((await router.list()).map((row) => row.id)).toEqual([
      refund.id,
      complaint.id,
      created.id,
    ]);
    await router.reorder({ ids: [complaint.id, refund.id, created.id] });

    await router.setActive({ id: created.id, active: false });
    expect((await frontline().ticketKind.options()).map((option) => option.name)).not.toContain(
      "咨询件",
    );
    expect(
      (await frontline().ticketKind.filterOptions()).find((option) => option.id === created.id),
    ).toMatchObject({ name: "咨询件", active: false });
    await router.setActive({ id: created.id, active: true });

    await expect(router.create({ name: "投诉" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "种类名称已存在",
    });

    await expect(router.delete({ id: created.id })).resolves.toEqual({ id: created.id });
  });

  it("行为绑定行（complaint/refund_exception）删除被拒，无论是否被工单引用", async () => {
    const router = manager().ticketKind;
    for (const key of ["complaint", "refund_exception"] as const) {
      const row = await prisma.ticketKind.findUniqueOrThrow({ where: { key } });
      await expect(router.delete({ id: row.id })).rejects.toMatchObject({
        code: "CONFLICT",
        message: `「${row.name}」种类绑定系统行为，不可删除，可改为停用`,
      });
      expect(await prisma.ticketKind.findUnique({ where: { key } })).not.toBeNull();
    }
  });

  it("无 dictionary.manage 只能读 options/filterOptions，写操作被拒", async () => {
    await expect(manager().ticketKind.create({ name: "越权种类" })).resolves.toMatchObject({
      name: "越权种类",
    });
    await expect(frontline().ticketKind.create({ name: "越权乙" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(frontline().ticketKind.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(frontline().ticketKind.options()).resolves.toBeInstanceOf(Array);
  });
});
