import type { TicketAddressCodes, TicketListInput, TicketMapPointsInput } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

const NANSHAN = { provinceCode: "440000", cityCode: "440300", districtCode: "440305" };
const FUTIAN = { provinceCode: "440000", cityCode: "440300", districtCode: "440304" };
const BEIJING_CHAOYANG = { provinceCode: "110000", cityCode: null, districtCode: "110105" };
const DONGGUAN = { provinceCode: "440000", cityCode: "441900", districtCode: null };
const TAIWAN = { provinceCode: "710000", cityCode: null, districtCode: null };

describe("工单地图 ticketMap.points (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let hotline: string;
  let insurer: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    prisma = harness.prisma;
    hotline = harness.userFeedbackChannelId("内部客服热线");
    insurer = harness.userFeedbackChannelId("保司400热线");

    const create = (address: TicketAddressCodes | null, userFeedbackChannelId = insurer) =>
      manager().ticket.create({ allowDuplicate: true, address, userFeedbackChannelId });

    await create(NANSHAN);
    await create(NANSHAN);
    await create(NANSHAN, hotline);
    await create(FUTIAN);
    await create(BEIJING_CHAOYANG);
    await create(DONGGUAN);
    await create(TAIWAN);
    await create(null);

    const deleted = await create(NANSHAN);
    await prisma.ticket.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const archived = await create(NANSHAN);
    await prisma.ticket.update({ where: { id: archived.id }, data: { source: "file_import" } });
    const old = await create(NANSHAN);
    await prisma.ticket.update({
      where: { id: old.id },
      data: { createdAt: new Date("2020-01-01T00:00:00.000Z") },
    });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const manager = () =>
    harness.callerFor(harness.seeded.users.manager, harness.seeded.roles.csManager);
  const admin = () => harness.callerFor(harness.seeded.users.admin, harness.seeded.roles.admin);

  const counts = async (input: TicketMapPointsInput = {}) =>
    Object.fromEntries((await admin().ticketMap.points(input)).map((row) => [row.code, row.count]));

  it("按定位码分组：四种地址形态；排除软删除、未填地址、归档单", async () => {
    const rows = await admin().ticketMap.points({});
    expect(Object.fromEntries(rows.map((row) => [row.code, row.count]))).toEqual({
      "110105": 1,
      "440304": 1,
      "440305": 4,
      "441900": 1,
      "710000": 1,
    });
    expect(rows.find((row) => row.code === "110105")).toEqual({
      code: "110105",
      provinceCode: "110000",
      provinceName: "北京市",
      cityName: null,
      districtName: "朝阳区",
      count: 1,
    });
    expect(rows.find((row) => row.code === "441900")).toMatchObject({
      provinceCode: "440000",
      cityName: "东莞市",
      districtName: null,
    });
  });

  it("创建时间与用户反馈渠道筛选", async () => {
    expect((await counts({ createdFrom: "2025-01-01T00:00:00.000Z" }))["440305"]).toBe(3);
    expect(await counts({ userFeedbackChannelId: [hotline] })).toEqual({ "440305": 1 });
  });

  it("无 ticket.view_all 只统计本人可见工单；仅管理员默认持有 ticket_map.view", async () => {
    const { cs1 } = harness.seeded.users;
    const frontline = harness.callerFor(cs1, harness.seeded.roles.frontline);
    const mine = await manager().ticket.create({ allowDuplicate: true, address: FUTIAN });
    await manager().ticket.assign({ ticketId: mine.id, assigneeId: cs1.id });
    const scoped = harness.callerWith(cs1, harness.seeded.roles.frontline, [
      "ticket_map.view",
      "ticket.view",
    ]);
    expect(
      Object.fromEntries((await scoped.ticketMap.points({})).map((row) => [row.code, row.count])),
    ).toEqual({ "440304": 1 });
    await expect(frontline.ticketMap.points({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manager().ticketMap.points({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("列表 locationCode 过滤条数 = 地图该码计数", async () => {
    const filters: TicketMapPointsInput & TicketListInput = {
      createdFrom: "2025-01-01T00:00:00.000Z",
    };
    const mapCounts = await counts(filters);
    for (const code of ["440305", "110105", "441900", "710000"]) {
      const list = await admin().ticket.list({ ...filters, locationCode: code });
      expect(list.total, code).toBe(mapCounts[code]);
    }
    const hotlineList = await admin().ticket.list({
      locationCode: "440305",
      userFeedbackChannelId: [hotline],
    });
    expect(hotlineList.total).toBe(1);
  });

  it("定位码不跨级误命中：省码不匹配有下级的地址", async () => {
    const list = await admin().ticket.list({ locationCode: "440000" });
    expect(list.total).toBe(0);
  });
});
