import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

/**
 * complaint_channel_catalogs 迁移的内容金样：两个目录无应用层种子，迁移即
 * 目录真相源——初始条目（映射表目标全集，全部启用，displayOrder 按目标首次
 * 出现顺序）只在这里逐字钉住；旧文本列的下线一并钉住。
 */
describe("complaint_channel_catalogs migration (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;

  beforeAll(async () => {
    harness = await startIntegrationHarness();
    prisma = harness.prisma;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("user_feedback_channels = 映射表目标全集（15 项，全启用，声明序）", async () => {
    const rows = await prisma.userFeedbackChannel.findMany({
      orderBy: { displayOrder: "asc" },
    });
    expect(rows.map((row) => [row.name, row.active, row.displayOrder])).toEqual([
      ["经纪400热线", true, 1],
      ["支付400热线", true, 2],
      ["保司400热线", true, 3],
      ["监管引导件", true, 4],
      ["监管正式件", true, 5],
      ["网微投诉", true, 6],
      ["黑猫", true, 7],
      ["市监/工商", true, 8],
      ["发卡行", true, 9],
      ["人行", true, 10],
      ["内部客服热线", true, 11],
      ["派出所", true, 12],
      ["消保平台", true, 13],
      ["微信商户", true, 14],
      ["政府转办", true, 15],
    ]);
  });

  it("feedback_receive_channels = 映射表目标全集（36 项，全启用，声明序）", async () => {
    const rows = await prisma.feedbackReceiveChannel.findMany({
      orderBy: { displayOrder: "asc" },
    });
    expect(rows.map((row) => [row.name, row.active, row.displayOrder])).toEqual([
      ["（微信）凯森&骏伯客诉对接群", true, 1],
      ["（微信）骏伯-融盛客户服务沟通群", true, 2],
      ["（微信）东方大地-多点客诉处理群", true, 3],
      ["（微信）富友支付&东方大地客诉处理群", true, 4],
      ["（微信）保险-凯森&易宝支付客诉群", true, 5],
      ["（微信）凯森与银商支付客诉处理群", true, 6],
      ["（飞书）骏伯&泰康互联投诉沟通群", true, 7],
      ["（微信）私发", true, 8],
      ["（微信）众惠官方&骏伯客诉处理群", true, 9],
      ["（飞书）骏伯-水滴分销双均分投诉处理群", true, 10],
      ["（微信）保险-东方大地与连连支付客诉处理", true, 11],
      ["（微信）东方大地保险10093023194&易宝", true, 12],
      ["（微信）利宝&骏伯 客服对接群", true, 13],
      ["（微信）信息流-客诉处理群", true, 14],
      ["（微信）泰康大健康-亿瀚客诉处理群", true, 15],
      ["（微信）通联支付&客诉处理群", true, 16],
      ["（微信）骏伯保东方大地-融盛 客户服务沟通", true, 17],
      ["（飞书）骏伯&海客-客服对接群", true, 18],
      ["（微信）爱邦保险经纪（暖哇）&骏伯客服群", true, 19],
      ["（微信）泰康互联-弘梵客诉处理群", true, 20],
      ["（飞书）保险微信投诉告警群", true, 21],
      ["（微信）中融多点客诉处理群", true, 22],
      ["（微信）中华-骏伯客户服务沟通群", true, 23],
      ["（微信）轻松保&骏伯客诉沟通群", true, 24],
      ["（微信）暖哇-多点 客诉处理群", true, 25],
      ["（微信）安盛&骏伯客诉沟通群", true, 26],
      ["（微信）【内部】BPO版块客诉沟通群", true, 27],
      ["（微信）保险&银商支付客诉处理群", true, 28],
      ["（微信）保险-东方大地&合利宝客诉处理", true, 29],
      ["（微信）保险-易宝支付&凯森客诉群", true, 30],
      ["内部客服热线", true, 31],
      ["（微信）保险媒体信息流-客诉处理", true, 32],
      ["（微信）骏伯&宜信客服沟通群", true, 33],
      ["（微信）众安安心保-东方大地-客诉处理群", true, 34],
      ["（微信）骏伯保东方大地-融盛 客户服务沟通群", true, 35],
      ["（微信）东方大地、陕西凯森&快钱支付客诉", true, 36],
    ]);
  });

  it("tickets/users 的旧文本列与改名前外键列均已下线", async () => {
    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE (table_name = 'tickets' AND column_name IN ('userComplaintChannel', 'complaintReceiveChannel', 'userComplaintChannelId', 'complaintReceiveChannelId'))
         OR (table_name = 'users' AND column_name IN ('prefillUserComplaintChannel', 'prefillComplaintReceiveChannel', 'prefillUserComplaintChannelId', 'prefillComplaintReceiveChannelId'))
    `;
    expect(columns).toEqual([]);
  });

  it("角色必填集键改写：目录引用旧 key → 新 key", async () => {
    const legacy = await prisma.role.create({
      data: {
        name: "存量必填角色",
        permissions: [],
        requiredTicketFields: ["customerName", "userComplaintChannelId", "complaintReceiveChannelId"],
      },
    });

    await prisma.$executeRaw`
      UPDATE "roles"
      SET "requiredTicketFields" = array_replace(
          array_replace("requiredTicketFields", 'userComplaintChannelId', 'userFeedbackChannelId'),
          'complaintReceiveChannelId', 'feedbackReceiveChannelId'
      )
    `;

    expect(
      (await prisma.role.findUniqueOrThrow({ where: { id: legacy.id } })).requiredTicketFields,
    ).toEqual(["customerName", "userFeedbackChannelId", "feedbackReceiveChannelId"]);
  });
});
