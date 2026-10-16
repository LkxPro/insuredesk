import { type TicketAddressCodes, ticketExportInputSchema } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemClock } from "../src/clock.ts";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { effectivePermissions } from "../src/services/auth.service.ts";
import { exportTickets } from "../src/services/ticket-export.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

const NANSHAN = { provinceCode: "440000", cityCode: "440300", districtCode: "440305" };
const BEIJING_CHAOYANG = { provinceCode: "110000", cityCode: null, districtCode: "110105" };
const DONGGUAN = { provinceCode: "440000", cityCode: "441900", districtCode: null };
const TAIWAN = { provinceCode: "710000", cityCode: null, districtCode: null };

describe("工单地址 (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let refundKindId: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    prisma = harness.prisma;
    refundKindId = (
      await prisma.ticketKind.findUniqueOrThrow({ where: { key: "refund_exception" } })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const manager = () =>
    harness.callerFor(harness.seeded.users.manager, harness.seeded.roles.csManager);

  const addressColumns = (id: string) =>
    prisma.ticket.findUniqueOrThrow({
      where: { id },
      select: {
        provinceCode: true,
        provinceName: true,
        cityCode: true,
        cityName: true,
        districtCode: true,
        districtName: true,
      },
    });

  async function createWithAddress(address: TicketAddressCodes | null) {
    const created = await manager().ticket.create({
      customerName: "地址客户",
      allowDuplicate: true,
      address,
    });
    return created.id;
  }

  async function editLogs(ticketId: string) {
    return prisma.processLog.findMany({
      where: { ticketId, action: "edit" },
      orderBy: { at: "asc" },
    });
  }

  describe("建单", () => {
    it.each([
      ["三级", NANSHAN, ["广东省", "深圳市", "南山区"]],
      ["直辖市两级", BEIJING_CHAOYANG, ["北京市", null, "朝阳区"]],
      ["市级叶子", DONGGUAN, ["广东省", "东莞市", null]],
      ["台湾省级叶子", TAIWAN, ["台湾省", null, null]],
    ] as const)("%s：码落库，名称由服务端回填", async (_label, address, names) => {
      const id = await createWithAddress(address);
      expect(await addressColumns(id)).toEqual({
        ...address,
        provinceName: names[0],
        cityName: names[1],
        districtName: names[2],
      });
    });

    it("客户端伪造的名称被忽略", async () => {
      const created = await manager().ticket.create({
        allowDuplicate: true,
        address: {
          ...NANSHAN,
          provinceName: "伪造省",
          districtName: "伪造区",
        } as TicketAddressCodes,
      });
      expect(await addressColumns(created.id)).toMatchObject({
        provinceName: "广东省",
        districtName: "南山区",
      });
    });

    it("不传地址 = 无地址", async () => {
      const created = await manager().ticket.create({ allowDuplicate: true });
      expect((await addressColumns(created.id)).provinceCode).toBeNull();
    });

    it.each([
      ["未到叶子", { provinceCode: "440000", cityCode: "440300", districtCode: null }],
      ["上下级不匹配", { provinceCode: "440000", cityCode: "440100", districtCode: "440305" }],
      ["不存在的码", { provinceCode: "440000", cityCode: "440300", districtCode: "440399" }],
    ])("%s 拒绝且不落库", async (_label, address) => {
      const before = await prisma.ticket.count();
      const error = await manager()
        .ticket.create({ allowDuplicate: true, address })
        .catch((e: unknown) => e);
      expect(error).toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("地址"),
      });
      expect(await prisma.ticket.count()).toBe(before);
    });
  });

  describe("投诉编辑协议", () => {
    it("不传 address = 保留；null = 清空；对象 = 替换，地址变更进操作日志", async () => {
      const id = await createWithAddress(NANSHAN);

      await manager().ticket.editComplaint({
        ticketId: id,
        customerName: "改名",
        allowDuplicate: true,
      });
      expect((await addressColumns(id)).districtCode).toBe("440305");

      const replaced = await manager().ticket.editComplaint({
        ticketId: id,
        customerName: "改名",
        address: BEIJING_CHAOYANG,
        allowDuplicate: true,
      });
      expect(replaced.changedFields).toEqual(["address"]);
      expect(await addressColumns(id)).toMatchObject({ provinceName: "北京市", cityCode: null });

      const cleared = await manager().ticket.editComplaint({
        ticketId: id,
        customerName: "改名",
        address: null,
        allowDuplicate: true,
      });
      expect(cleared.changedFields).toEqual(["address"]);
      expect((await addressColumns(id)).provinceCode).toBeNull();

      const remarks = (await editLogs(id)).map((log) => log.remark);
      expect(remarks).toContain("地址: 广东省 深圳市 南山区→北京市 朝阳区");
      expect(remarks).toContain("地址: 北京市 朝阳区→（空）");
    });

    it("提交相同地址不算改动、不写日志", async () => {
      const id = await createWithAddress(NANSHAN);
      const result = await manager().ticket.editComplaint({
        ticketId: id,
        customerName: "地址客户",
        address: NANSHAN,
        allowDuplicate: true,
      });
      expect(result.changedFields).toEqual([]);
      expect(await editLogs(id)).toHaveLength(0);
    });

    it("已存失效区划码时，不传 address 可编辑其他字段", async () => {
      const id = await createWithAddress(NANSHAN);
      await prisma.ticket.update({
        where: { id },
        data: { districtCode: "440399", districtName: "已撤销区" },
      });
      const result = await manager().ticket.editComplaint({
        ticketId: id,
        customerName: "新名字",
        allowDuplicate: true,
      });
      expect(result.changedFields).toEqual(["customerName"]);
      expect(await addressColumns(id)).toMatchObject({
        districtCode: "440399",
        districtName: "已撤销区",
      });
    });
  });

  describe("退费编辑", () => {
    it("退费工单可写入与清空地址", async () => {
      const ticket = await prisma.ticket.create({
        data: {
          source: "jb-insurance",
          kindId: refundKindId,
          slaAnchorAt: new Date("2026-08-24T08:40:00.000Z"),
          status: "processing",
        },
      });
      const written = await manager().ticket.editRefund({
        ticketId: ticket.id,
        contactPhone: null,
        slaPolicyId: null,
        address: DONGGUAN,
      });
      expect(written.changedFields).toEqual(["address"]);
      expect((await addressColumns(ticket.id)).cityName).toBe("东莞市");

      await manager().ticket.editRefund({
        ticketId: ticket.id,
        contactPhone: null,
        slaPolicyId: null,
        address: null,
      });
      expect((await addressColumns(ticket.id)).cityCode).toBeNull();
      expect((await editLogs(ticket.id)).map((log) => log.remark)).toEqual([
        "地址: （空）→广东省 东莞市",
        "地址: 广东省 东莞市→（空）",
      ]);
    });
  });

  it("详情返回地址对象，未填为 null", async () => {
    const withAddress = await createWithAddress(NANSHAN);
    const without = await createWithAddress(null);
    expect((await manager().ticket.detail({ id: withAddress })).address).toEqual({
      provinceCode: "440000",
      provinceName: "广东省",
      cityCode: "440300",
      cityName: "深圳市",
      districtCode: "440305",
      districtName: "南山区",
    });
    expect((await manager().ticket.detail({ id: without })).address).toBeNull();
  });

  it("导出两 sheet 末尾追加省/市/区县三列", async () => {
    const id = await createWithAddress(NANSHAN);
    const workOrderNumber = (await prisma.ticket.findUniqueOrThrow({ where: { id } }))
      .workOrderNumber;
    const { manager: user } = harness.seeded.users;
    const role = harness.seeded.roles.csManager;
    const file = await exportTickets(
      { prisma, clock: systemClock },
      {
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
      },
      ticketExportInputSchema.parse({
        format: "csv",
        kindId: [(await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } })).id],
        search: workOrderNumber,
      }),
    );
    const [header = "", row = ""] = file.body.toString("utf8").replace(/^﻿/, "").split(/\r?\n/);
    expect(header.endsWith("完结状态,省,市,区县")).toBe(true);
    expect(row.endsWith(",广东省,深圳市,南山区")).toBe(true);
  });
});
