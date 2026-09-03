import { DASHBOARD_MATRIX_UNFILLED_KEY } from "@insuredesk/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedRefundDefaultSlaPolicy } from "../prisma/seed-data.ts";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  getDashboardActionStats,
  getDashboardAnalysisStats,
} from "../src/services/dashboard.service.ts";
import {
  type ComplaintCoreInput,
  type ComplaintDetailInput,
  createComplaintTickets,
  type IntegrationHarness,
  startIntegrationHarness,
} from "./integration-harness.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date("2026-07-20T10:00:00.000Z");
const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR_MS);

describe("dashboard (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let complaintKindId: string;
  let refundKindId: string;
  let refundPolicyId: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "slaPolicies", "channels", "categories"],
    });
    prisma = harness.prisma;
    seeded = harness.seeded;
    complaintKindId = (await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } }))
      .id;
    refundKindId = (
      await prisma.ticketKind.findUniqueOrThrow({ where: { key: "refund_exception" } })
    ).id;
    // harness 的 slaPolicies 种子只含投诉组；退费组默认策略由独立种子补插（同 bootstrap）。
    refundPolicyId = (await seedRefundDefaultSlaPolicy(prisma)).id;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  beforeEach(async () => {
    await prisma.ticket.deleteMany();
  });

  const managerAuth = () => harness.authUserFor(seeded.users.manager, seeded.roles.csManager);
  const frontlineAuth = () => harness.authUserFor(seeded.users.cs1, seeded.roles.frontline);

  const actionStats = (viewer = managerAuth()) =>
    getDashboardActionStats(harness.depsAt(NOW), viewer);
  const analysisStats = (
    input: { createdFrom?: string; createdTo?: string } = {},
    viewer = managerAuth(),
  ) => getDashboardAnalysisStats(harness.depsAt(NOW), viewer, input);

  function fixture(
    core: ComplaintCoreInput = {},
    detail: ComplaintDetailInput = {},
  ): { core: ComplaintCoreInput; detail: ComplaintDetailInput } {
    return {
      core: {
        source: "manual",
        kindId: complaintKindId,
        slaPolicyId: harness.slaPolicyId("一般投诉"),
        ...core,
      },
      detail: { channelId: harness.channelId("保司"), ...detail },
    };
  }

  async function makeRefundTicket(core: ComplaintCoreInput = {}) {
    return prisma.ticket.create({
      data: {
        source: "jb-insurance",
        kindId: refundKindId,
        slaPolicyId: refundPolicyId,
        slaAnchorAt: core.slaAnchorAt ?? core.createdAt ?? NOW,
        ...core,
      },
    });
  }

  function policyRow(stats: Awaited<ReturnType<typeof actionStats>>, name: string) {
    const row = stats.policies.find((policy) => policy.name === name);
    if (!row) throw new Error(`策略桶「${name}」缺失`);
    return row;
  }

  describe("actionStats 行动指标", () => {
    it("四个计数与边界：待首响不含未分配、过线严格大于、超时/预警与列表同边界", async () => {
      const cs1 = seeded.users.cs1.id;
      const manager = seeded.users.manager.id;
      await createComplaintTickets(prisma, [
        fixture({ createdAt: at(-3), dueAt: at(30) }), // 未分配·新
        fixture({ createdAt: at(-10), slaPolicyId: null, dueAt: null }), // 未分配·无策略
        fixture({ createdAt: at(-50), dueAt: at(-1) }), // 未分配·已超时（含未分配单）
        fixture({
          // 待超时 + 待首响未过线
          status: "assigned",
          assigneeId: cs1,
          createdAt: at(-0.5),
          slaAnchorAt: at(-0.5),
          dueAt: at(1),
        }),
        fixture({
          // 恰 2h 不预警（严格）；首响过线（121min > 120min）
          status: "assigned",
          assigneeId: cs1,
          createdAt: at(-2),
          slaAnchorAt: new Date(NOW.getTime() - 121 * 60 * 1000),
          dueAt: new Date(NOW.getTime() + 2 * HOUR_MS),
        }),
        fixture({
          // 恰在时限不超时（严格），但已入 2h 预警窗；已首响不待首响
          status: "assigned",
          assigneeId: cs1,
          createdAt: at(-2),
          dueAt: NOW,
          contactCount: 1,
        }),
        fixture({
          // 刚过时限即超时；首响 119min 未过线
          status: "processing",
          assigneeId: cs1,
          createdAt: at(-2),
          slaAnchorAt: new Date(NOW.getTime() - 119 * 60 * 1000),
          dueAt: new Date(NOW.getTime() - 1),
        }),
        fixture({
          // 在途超时；已首响
          status: "processing",
          assigneeId: manager,
          createdAt: at(-30),
          dueAt: at(-5),
          contactCount: 2,
        }),
        fixture({
          // 完结即移出实时口径
          status: "completed",
          assigneeId: cs1,
          createdAt: at(-30),
          dueAt: at(-1),
          completionTime: at(-2),
        }),
        fixture({
          // 无策略：待首响但永不判过线
          status: "assigned",
          assigneeId: manager,
          createdAt: at(-10),
          slaAnchorAt: at(-10),
          slaPolicyId: null,
          dueAt: null,
        }),
        fixture({
          // 特急 30min 首响线：31min 已过线
          status: "assigned",
          assigneeId: cs1,
          createdAt: new Date(NOW.getTime() - 31 * 60 * 1000),
          slaAnchorAt: new Date(NOW.getTime() - 31 * 60 * 1000),
          slaPolicyId: harness.slaPolicyId("特急投诉"),
          dueAt: null,
        }),
      ]);

      const { metrics } = await actionStats();
      expect(metrics.overdue).toBe(3);
      expect(metrics.dueSoon).toBe(2);
      expect(metrics.awaitingFirstResponse).toBe(5);
      expect(metrics.firstResponseOverLine).toBe(2);
      expect(metrics.unassigned).toBe(3);
      expect(metrics.unassignedOldestWaitMs).toBe(50 * HOUR_MS);
    });

    it("策略停用的工单不判首响过线，复活后恢复", async () => {
      await createComplaintTickets(prisma, [
        fixture({
          status: "assigned",
          assigneeId: seeded.users.cs1.id,
          createdAt: at(-10),
          slaAnchorAt: at(-10),
          slaPolicyId: harness.slaPolicyId("高级投诉"),
        }),
      ]);
      const policyId = harness.slaPolicyId("高级投诉");
      await prisma.slaPolicy.update({ where: { id: policyId }, data: { active: false } });
      try {
        const { metrics } = await actionStats();
        expect(metrics.awaitingFirstResponse).toBe(1);
        expect(metrics.firstResponseOverLine).toBe(0);
      } finally {
        await prisma.slaPolicy.update({ where: { id: policyId }, data: { active: true } });
      }
      const { metrics } = await actionStats();
      expect(metrics.firstResponseOverLine).toBe(1);
    });
  });

  describe("actionStats 策略桶", () => {
    it("两组 active 策略按 kind displayOrder→sortOrder 排序，未指定桶垫底；不设时限恒 0", async () => {
      const cs1 = seeded.users.cs1.id;
      await createComplaintTickets(prisma, [
        fixture({ status: "assigned", assigneeId: cs1, createdAt: at(-1), dueAt: at(47) }),
        fixture({ status: "processing", assigneeId: cs1, createdAt: at(-2), dueAt: at(46) }),
        fixture({
          // 完结不计 inFlight
          status: "completed",
          assigneeId: cs1,
          createdAt: at(-30),
          dueAt: at(18),
          completionTime: at(-2),
        }),
        fixture({
          status: "processing",
          assigneeId: cs1,
          createdAt: at(-50),
          slaPolicyId: harness.slaPolicyId("高级投诉"),
          dueAt: at(-2),
        }),
        fixture({
          status: "assigned",
          assigneeId: cs1,
          createdAt: at(-1),
          slaPolicyId: harness.slaPolicyId("加急投诉"),
          dueAt: at(1),
        }),
        fixture({
          // 特急 dueAt 恒 null：多老都不出超时/预警
          status: "processing",
          assigneeId: cs1,
          createdAt: at(-500),
          slaPolicyId: harness.slaPolicyId("特急投诉"),
          dueAt: null,
        }),
        fixture({ status: "assigned", assigneeId: cs1, createdAt: at(-1), slaPolicyId: null }),
      ]);
      await makeRefundTicket({ createdAt: at(-1), status: "assigned", assigneeId: cs1 });

      const stats = await actionStats();
      expect(stats.policies.map((policy) => policy.name)).toEqual([
        "一般投诉",
        "高级投诉",
        "加急投诉",
        "特急投诉",
        "退费异常默认策略",
        "未指定策略",
      ]);
      expect(policyRow(stats, "一般投诉")).toMatchObject({
        policyId: harness.slaPolicyId("一般投诉"),
        kindName: "投诉",
        timeoutMs: 48 * HOUR_MS,
        inFlight: 2,
        dueSoon: 0,
        overdue: 0,
      });
      expect(policyRow(stats, "高级投诉")).toMatchObject({ inFlight: 1, dueSoon: 0, overdue: 1 });
      expect(policyRow(stats, "加急投诉")).toMatchObject({
        timeoutMs: 72 * HOUR_MS,
        inFlight: 1,
        dueSoon: 1,
        overdue: 0,
      });
      expect(policyRow(stats, "特急投诉")).toMatchObject({
        timeoutMs: null,
        inFlight: 1,
        dueSoon: 0,
        overdue: 0,
      });
      expect(policyRow(stats, "退费异常默认策略")).toMatchObject({
        policyId: refundPolicyId,
        kindName: "退费异常",
        timeoutMs: 48 * HOUR_MS,
        inFlight: 1,
      });
      const unspecified = stats.policies.at(-1);
      expect(unspecified).toMatchObject({
        policyId: null,
        kindName: null,
        timeoutMs: null,
        inFlight: 1,
        dueSoon: 0,
        overdue: 0,
      });
    });
  });

  describe("actionStats 数据范围", () => {
    it("无 dashboard.view_all 收窄为本人名下：unassigned 恒 0，策略桶同步收窄", async () => {
      const cs1 = seeded.users.cs1.id;
      await createComplaintTickets(prisma, [
        fixture({ createdAt: at(-1), dueAt: at(47) }), // 未分配
        fixture({ status: "assigned", assigneeId: cs1, createdAt: at(-1), dueAt: at(1) }),
        fixture({
          status: "processing",
          assigneeId: seeded.users.manager.id,
          createdAt: at(-30),
          dueAt: at(-1),
        }),
      ]);

      const own = await actionStats(frontlineAuth());
      expect(own.scope).toBe("own");
      expect(own.metrics.unassigned).toBe(0);
      expect(own.metrics.dueSoon).toBe(1);
      expect(own.metrics.overdue).toBe(0);
      expect(policyRow(own, "一般投诉").inFlight).toBe(1);

      const all = await actionStats();
      expect(all.scope).toBe("all");
      expect(all.metrics.unassigned).toBe(1);
      expect(all.metrics.overdue).toBe(1);
      expect(policyRow(all, "一般投诉").inFlight).toBe(3);
    });

    it("rejects callers without dashboard.view", async () => {
      const caller = harness.callerWith(seeded.users.cs1, seeded.roles.frontline, ["ticket.view"]);
      await expect(caller.dashboard.actionStats()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("analysisStats trend 粒度", () => {
    const localIso = (date: Date) => date.toISOString();

    it("span < 2 天按小时：createdFrom 所在本地日 24 桶，previous = 前一日同时段", async () => {
      const dayStart = new Date(2026, 6, 10);
      const hour = (offset: number) => new Date(dayStart.getTime() + offset * HOUR_MS);
      await createComplaintTickets(prisma, [
        fixture({ createdAt: hour(3) }),
        fixture({ createdAt: hour(3.5) }),
        fixture({ createdAt: hour(15) }),
        fixture({ createdAt: new Date(dayStart.getTime() - 21 * HOUR_MS) }), // 前一日 03:00
        fixture({ createdAt: new Date(dayStart.getTime() - 9 * HOUR_MS) }), // 前一日 15:00
        fixture({ createdAt: new Date(dayStart.getTime() - 8.5 * HOUR_MS) }),
        fixture({ createdAt: hour(5), source: "file_import" }), // file_import 排除
      ]);

      const { trend } = await analysisStats({
        createdFrom: localIso(dayStart),
        createdTo: localIso(new Date(dayStart.getTime() + DAY_MS)),
      });
      expect(trend.granularity).toBe("hour");
      expect(trend.points).toHaveLength(24);
      expect(trend.points[0]?.bucketStart).toBe(localIso(dayStart));
      expect(trend.points[3]).toMatchObject({ created: 2, previous: 1 });
      expect(trend.points[15]).toMatchObject({ created: 1, previous: 2 });
      expect(trend.points.reduce((sum, point) => sum + point.created, 0)).toBe(3);
    });

    it("span = 62 天按日：本地日界分桶，previous 等长前移按桶序号对齐", async () => {
      const from = new Date(2026, 5, 1);
      await createComplaintTickets(prisma, [
        fixture({ createdAt: new Date(from.getTime() + HOUR_MS) }),
        fixture({ createdAt: new Date(from.getTime() + 5 * DAY_MS) }),
        fixture({ createdAt: new Date(from.getTime() - 58 * DAY_MS) }), // previous 桶 5
        fixture({ createdAt: new Date(from.getTime() - 64 * DAY_MS) }), // previous 窗口之外
      ]);
      await makeRefundTicket({ createdAt: new Date(from.getTime() + 5 * DAY_MS + HOUR_MS) });

      const { trend } = await analysisStats({
        createdFrom: localIso(from),
        createdTo: localIso(new Date(from.getTime() + 62 * DAY_MS)),
      });
      expect(trend.granularity).toBe("day");
      expect(trend.points).toHaveLength(63);
      expect(trend.points[0]?.bucketStart).toBe(localIso(from));
      expect(trend.points[0]).toMatchObject({ created: 1, previous: 0 });
      expect(trend.points[5]).toMatchObject({ created: 2, previous: 1 }); // 含全部种类
      expect(trend.points.reduce((sum, point) => sum + point.previous, 0)).toBe(1);
    });

    it("span = 63 天按周：自 range 起点 7 天一桶，恰落 to 的工单入末桶", async () => {
      const from = new Date(2026, 5, 1);
      const to = new Date(from.getTime() + 63 * DAY_MS);
      await createComplaintTickets(prisma, [
        fixture({ createdAt: new Date(from.getTime() + DAY_MS) }),
        fixture({ createdAt: to }),
        fixture({ createdAt: new Date(from.getTime() - 65 * DAY_MS) }), // previous 桶 0
      ]);

      const { trend } = await analysisStats({
        createdFrom: localIso(from),
        createdTo: localIso(to),
      });
      expect(trend.granularity).toBe("week");
      expect(trend.points).toHaveLength(10);
      expect(trend.points[0]?.bucketStart).toBe(localIso(from));
      expect(trend.points[0]).toMatchObject({ created: 1, previous: 1 });
      expect(trend.points[9]).toMatchObject({ created: 1, previous: 0 });
    });

    it("缺省窗口：createdTo = now、createdFrom = 其前 6 天（按日 7 桶）；其余周期块无界", async () => {
      await createComplaintTickets(prisma, [
        fixture({ createdAt: new Date(NOW.getTime() - 100 * DAY_MS) }),
      ]);

      const stats = await analysisStats();
      expect(stats.trend.granularity).toBe("day");
      expect(stats.trend.points).toHaveLength(7);
      // 周期块不叠 range：100 天前的工单仍计入 kinds
      expect(stats.kinds.find((kind) => kind.name === "投诉")?.count).toBe(1);
    });
  });

  describe("analysisStats kinds / categories / sources", () => {
    it("kinds 全种类目录零填充，按 displayOrder 序，叠 createdRange", async () => {
      await createComplaintTickets(prisma, [
        fixture({ createdAt: at(-24) }),
        fixture({ createdAt: at(-24) }),
        fixture({ createdAt: at(-24 * 30) }), // 区间外
      ]);
      await makeRefundTicket({ createdAt: at(-24) });

      const { kinds } = await analysisStats({
        createdFrom: at(-7 * 24).toISOString(),
        createdTo: NOW.toISOString(),
      });
      expect(kinds).toEqual([
        { kindId: complaintKindId, name: "投诉", count: 2 },
        { kindId: refundKindId, name: "退费异常", count: 1 },
      ]);
    });

    it("categories 投诉单 Top 10 + 其他 + 未填写", async () => {
      const names = [
        "监管投诉-引导性",
        "监管投诉-非引导性",
        "投诉-服务态度",
        "投诉-未履行告知义务",
        "投诉-信息泄露",
        "投诉-保费收取问题",
        "理赔咨询",
        "理赔投诉",
        "退保申请",
        "退保投诉",
        "保单变更",
        "保单查询",
      ];
      const rows = names.flatMap((name, index) =>
        Array.from({ length: names.length - index }, () =>
          fixture({ createdAt: at(-24) }, { categoryId: harness.categoryId(name) }),
        ),
      );
      rows.push(fixture({ createdAt: at(-24) }, { categoryId: null }));
      rows.push(fixture({ createdAt: at(-24) }, { categoryId: null }));
      await createComplaintTickets(prisma, rows);

      const { categories } = await analysisStats();
      expect(categories.map((row) => row.name)).toEqual([...names.slice(0, 10), "其他", "未填写"]);
      expect(categories.map((row) => row.count)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 3, 2]);
      expect(categories[0]?.categoryId).toBe(harness.categoryId("监管投诉-引导性"));
      expect(categories.at(-2)?.categoryId).toBeNull();
      expect(categories.at(-1)?.categoryId).toBeNull();
    });

    it("sources 按 DEFAULT_TICKET_SOURCE_FILTER 零填充，file_import 永不在列", async () => {
      await createComplaintTickets(prisma, [
        fixture({ createdAt: at(-1) }),
        fixture({ createdAt: at(-1) }),
        fixture({ createdAt: at(-1), source: "external_channel" }),
        fixture({ createdAt: at(-1), source: "file_import" }),
        fixture({ createdAt: at(-1), source: "file_import" }),
      ]);

      const { sources } = await analysisStats();
      expect(sources).toEqual([
        { source: "feishu_form", count: 0 },
        { source: "manual", count: 2 },
        { source: "community", count: 0 },
        { source: "external_channel", count: 1 },
        { source: "jb-insurance", count: 0 },
      ]);
    });
  });

  describe("analysisStats matrix", () => {
    it("行列和 = 周期内投诉单总数；实体和 = 行和；未填写行/列；实体 Top 8 + 其他 + 未填写", async () => {
      const ufcA = harness.userFeedbackChannelId("经纪400热线");
      const ufcB = harness.userFeedbackChannelId("保司400热线");
      const rows: { core: ComplaintCoreInput; detail: ComplaintDetailInput }[] = [];
      // 保司：9 个项目（9..1 张）→ Top 8 + 其他(1)；1 张未填项目
      for (let index = 0; index < 9; index += 1) {
        const count = 9 - index;
        for (let i = 0; i < count; i += 1) {
          rows.push(
            fixture(
              { createdAt: at(-24) },
              {
                channelId: harness.channelId("保司"),
                project: `项目${index + 1}`,
                userFeedbackChannelId: index % 2 === 0 ? ufcA : ufcB,
              },
            ),
          );
        }
      }
      rows.push(
        fixture(
          { createdAt: at(-24) },
          {
            channelId: harness.channelId("保司"),
            project: null,
            userFeedbackChannelId: null,
          },
        ),
      );
      // 经纪 / 支付：实体下钻；监管：无实体
      rows.push(
        fixture(
          { createdAt: at(-24) },
          {
            channelId: harness.channelId("经纪"),
            brokerageEntity: "东方大地",
            userFeedbackChannelId: ufcA,
          },
        ),
        fixture(
          { createdAt: at(-24) },
          {
            channelId: harness.channelId("经纪"),
            brokerageEntity: "东方大地",
            userFeedbackChannelId: ufcA,
          },
        ),
        fixture(
          { createdAt: at(-24) },
          {
            channelId: harness.channelId("经纪"),
            brokerageEntity: "其他经纪",
            userFeedbackChannelId: ufcB,
          },
        ),
        fixture(
          { createdAt: at(-24) },
          {
            channelId: harness.channelId("支付"),
            paymentChannel: "连连支付",
            userFeedbackChannelId: ufcA,
          },
        ),
        fixture(
          { createdAt: at(-24) },
          { channelId: harness.channelId("监管"), userFeedbackChannelId: ufcB },
        ),
        fixture(
          { createdAt: at(-24) },
          { channelId: harness.channelId("监管"), userFeedbackChannelId: ufcB },
        ),
        // 未填写行
        fixture({ createdAt: at(-24) }, { channelId: null, userFeedbackChannelId: ufcA }),
        // 区间外：不计入
        fixture(
          { createdAt: at(-24 * 30) },
          { channelId: harness.channelId("保司"), project: "老项目", userFeedbackChannelId: ufcA },
        ),
      );
      await createComplaintTickets(prisma, rows);

      const range = {
        createdFrom: at(-7 * 24).toISOString(),
        createdTo: NOW.toISOString(),
      };
      const { matrix } = await analysisStats(range);

      const ufcCatalogCount = await prisma.userFeedbackChannel.count();
      expect(matrix.columns).toHaveLength(ufcCatalogCount + 1);
      expect(matrix.columns.at(-1)).toEqual({ id: null, name: "未填写" });

      expect(matrix.rows.map((row) => row.name)).toEqual([
        "保司",
        "经纪",
        "支付",
        "监管",
        "未填写",
      ]);
      const sumCells = (cells: Record<string, number>) =>
        Object.values(cells).reduce((sum, count) => sum + count, 0);
      const rowByName = (name: string) => {
        const row = matrix.rows.find((entry) => entry.name === name);
        if (!row) throw new Error(`matrix 行「${name}」缺失`);
        return row;
      };

      // 行列和 = 周期内投诉单总数
      const grandTotal = matrix.rows.reduce((sum, row) => sum + sumCells(row.cells), 0);
      expect(grandTotal).toBe(46 + 3 + 1 + 2 + 1);
      for (const row of matrix.rows) {
        expect(Object.keys(row.cells)).toHaveLength(ufcCatalogCount + 1);
      }

      const insurance = rowByName("保司");
      expect(sumCells(insurance.cells)).toBe(46);
      expect(insurance.cells[DASHBOARD_MATRIX_UNFILLED_KEY]).toBe(1);
      // Top 8（计数降序）+ 其他 + 未填写
      expect(insurance.entities.map((entity) => entity.name)).toEqual([
        "项目1",
        "项目2",
        "项目3",
        "项目4",
        "项目5",
        "项目6",
        "项目7",
        "项目8",
        "其他",
        "未填写",
      ]);
      expect(insurance.entities[0]?.cells[ufcA]).toBe(9);
      expect(sumCells(insurance.entities[8]?.cells ?? {})).toBe(1); // 其他 = 项目9
      expect(insurance.entities[9]?.cells[DASHBOARD_MATRIX_UNFILLED_KEY]).toBe(1);
      const entityTotal = insurance.entities.reduce(
        (sum, entity) => sum + sumCells(entity.cells),
        0,
      );
      expect(entityTotal).toBe(sumCells(insurance.cells));

      const brokerage = rowByName("经纪");
      expect(brokerage.entities.map((entity) => entity.name)).toEqual(["东方大地", "其他经纪"]);
      expect(brokerage.entities[0]?.cells[ufcA]).toBe(2);
      expect(brokerage.entities.reduce((sum, entity) => sum + sumCells(entity.cells), 0)).toBe(
        sumCells(brokerage.cells),
      );

      const payment = rowByName("支付");
      expect(payment.entities.map((entity) => entity.name)).toEqual(["连连支付"]);

      expect(rowByName("监管").entities).toEqual([]);
      const unfilled = matrix.rows.at(-1);
      expect(unfilled?.channelId).toBeNull();
      expect(unfilled?.cells[ufcA]).toBe(1);
      expect(unfilled?.entities).toEqual([]);
    });
  });

  describe("analysisStats agents", () => {
    it("责任人候选全集零填充（含无工单者），无 dashboard.view_all 只剩自己一行", async () => {
      const stats = await analysisStats();
      // admin/manager/cs1 合规；observer 只读无 ticket.process 出局
      expect(stats.agents.map((agent) => agent.assigneeId).sort()).toEqual(
        [seeded.users.admin.id, seeded.users.manager.id, seeded.users.cs1.id].sort(),
      );
      for (const agent of stats.agents) {
        expect(agent).toMatchObject({
          inFlight: 0,
          overdue: 0,
          dueSoon: 0,
          awaitingFirstResponse: 0,
          followUpCheckpoints: 0,
          followUpRolling: 0,
          completed: 0,
          avgCompletionMs: null,
          overdueCount: 0,
          overdueRate: 0,
        });
      }

      const own = await analysisStats({}, frontlineAuth());
      expect(own.scope).toBe("own");
      expect(own.agents.map((agent) => agent.assigneeId)).toEqual([seeded.users.cs1.id]);
    });

    it("实时列不叠 createdRange：区间外创建的在途单照常计入", async () => {
      const range = {
        createdFrom: at(-7 * 24).toISOString(),
        createdTo: NOW.toISOString(),
      };
      await createComplaintTickets(prisma, [
        fixture({
          // 区间外创建：实时列照计，周期列不计
          status: "processing",
          assigneeId: seeded.users.cs1.id,
          createdAt: at(-24 * 30),
          dueAt: at(-1),
        }),
        fixture({
          status: "assigned",
          assigneeId: seeded.users.manager.id,
          createdAt: at(-24 * 30),
          dueAt: at(1),
          contactCount: 0,
        }),
      ]);

      const { agents } = await analysisStats(range);
      const cs1 = agents.find((agent) => agent.assigneeId === seeded.users.cs1.id);
      const manager = agents.find((agent) => agent.assigneeId === seeded.users.manager.id);
      expect(cs1).toMatchObject({ inFlight: 1, overdue: 1, dueSoon: 0, overdueCount: 0 });
      expect(manager).toMatchObject({
        inFlight: 1,
        dueSoon: 1,
        awaitingFirstResponse: 1,
        completed: 0,
      });
    });

    it("周期列口径：completed/avgCompletionMs/overdueCount（曾超时）/overdueRate 分母；排序 inFlight→completed→name", async () => {
      const cs1 = seeded.users.cs1.id;
      await createComplaintTickets(prisma, [
        fixture({
          // 按时完结：时长 1 天
          status: "completed",
          assigneeId: cs1,
          createdAt: at(-3 * 24),
          dueAt: at(-24),
          completionTime: at(-2 * 24),
        }),
        fixture({
          // 超时完结：时长 3 天，曾超时
          status: "completed",
          assigneeId: cs1,
          createdAt: at(-4 * 24),
          dueAt: at(-2 * 24),
          completionTime: at(-24),
        }),
        fixture({
          // 在途已超时：曾超时
          status: "processing",
          assigneeId: cs1,
          createdAt: at(-2 * 24),
          dueAt: at(-24),
        }),
        fixture({
          // 特急在途：dueAt null 永不超时
          status: "processing",
          assigneeId: cs1,
          createdAt: at(-24),
          slaPolicyId: harness.slaPolicyId("特急投诉"),
          dueAt: null,
        }),
        fixture({
          status: "assigned",
          assigneeId: seeded.users.manager.id,
          createdAt: at(-24),
          dueAt: at(47),
        }),
        fixture({
          // 区间外完结：不进周期列
          status: "completed",
          assigneeId: cs1,
          createdAt: at(-24 * 30),
          dueAt: at(-24 * 29),
          completionTime: at(-24 * 29),
        }),
      ]);

      const { agents } = await analysisStats({
        createdFrom: at(-7 * 24).toISOString(),
        createdTo: NOW.toISOString(),
      });
      expect(agents.map((agent) => agent.assigneeId)).toEqual([
        cs1,
        seeded.users.manager.id,
        seeded.users.admin.id,
      ]);
      const row = agents[0];
      expect(row).toMatchObject({
        completed: 2,
        avgCompletionMs: 2 * DAY_MS,
        overdueCount: 2,
        overdueRate: 0.5, // 分母 = 周期内创建名下单总数 4
        inFlight: 2,
        overdue: 1,
      });
    });

    it("跟进欠账列：检查点窗口内未达标命中、窗口已过不命中、滚动欠跟进命中、达标即出窗", async () => {
      const cs1 = seeded.users.cs1.id;
      const rows = await createComplaintTickets(prisma, [
        fixture({
          // 24h 检查点窗口 [23h,24h) 内，0/1 次 → 命中
          status: "assigned",
          assigneeId: cs1,
          createdAt: at(-23.5),
          slaAnchorAt: at(-23.5),
          dueAt: at(24.5),
        }),
        fixture({
          // 24h 窗口已过、48h 窗口未至 → 不命中
          status: "assigned",
          assigneeId: cs1,
          createdAt: at(-25),
          slaAnchorAt: at(-25),
          dueAt: at(23),
        }),
        fixture({
          // 特急：上条 comment 距今 13h ≥ 12h → 滚动命中
          status: "processing",
          assigneeId: cs1,
          createdAt: at(-30),
          slaAnchorAt: at(-30),
          slaPolicyId: harness.slaPolicyId("特急投诉"),
          dueAt: null,
          contactCount: 1,
        }),
        fixture({
          // 特急但无任何 comment：滚动不启动（待首响兜底）
          status: "assigned",
          assigneeId: cs1,
          createdAt: at(-30),
          slaAnchorAt: at(-30),
          slaPolicyId: harness.slaPolicyId("特急投诉"),
          dueAt: null,
        }),
        fixture({
          // 检查点已达标（1/1）→ 不命中
          status: "processing",
          assigneeId: seeded.users.manager.id,
          createdAt: at(-23.5),
          slaAnchorAt: at(-23.5),
          dueAt: at(24.5),
          contactCount: 1,
        }),
      ]);
      const rollingTicketId = rows[2];
      if (!rollingTicketId) throw new Error("滚动工单 fixture 缺失");
      await prisma.processLog.create({
        data: {
          ticketId: rollingTicketId,
          operatorId: cs1,
          operatorName: seeded.users.cs1.name,
          action: "comment",
          remark: "跟进",
          at: at(-13),
        },
      });

      const { agents } = await analysisStats();
      const cs1Row = agents.find((agent) => agent.assigneeId === cs1);
      expect(cs1Row?.followUpCheckpoints).toBe(1);
      expect(cs1Row?.followUpRolling).toBe(1);
      const managerRow = agents.find((agent) => agent.assigneeId === seeded.users.manager.id);
      expect(managerRow?.followUpCheckpoints).toBe(0);
      expect(managerRow?.followUpRolling).toBe(0);
    });

    it("策略停用退出跟进欠账判定", async () => {
      await createComplaintTickets(prisma, [
        fixture({
          status: "assigned",
          assigneeId: seeded.users.cs1.id,
          createdAt: at(-23.5),
          slaAnchorAt: at(-23.5),
          slaPolicyId: harness.slaPolicyId("高级投诉"),
          dueAt: at(24.5),
        }),
      ]);
      const policyId = harness.slaPolicyId("高级投诉");
      await prisma.slaPolicy.update({ where: { id: policyId }, data: { active: false } });
      try {
        const { agents } = await analysisStats();
        expect(
          agents.find((agent) => agent.assigneeId === seeded.users.cs1.id)?.followUpCheckpoints,
        ).toBe(0);
      } finally {
        await prisma.slaPolicy.update({ where: { id: policyId }, data: { active: true } });
      }
    });
  });

  describe("analysisStats 数据范围与权限", () => {
    it("own scope：周期块与 agents 同步收窄为本人名下", async () => {
      await createComplaintTickets(prisma, [
        fixture({ status: "assigned", assigneeId: seeded.users.cs1.id, createdAt: at(-24) }),
        fixture({
          status: "assigned",
          assigneeId: seeded.users.manager.id,
          createdAt: at(-24),
        }),
      ]);

      const own = await analysisStats(
        { createdFrom: at(-7 * 24).toISOString(), createdTo: NOW.toISOString() },
        frontlineAuth(),
      );
      expect(own.scope).toBe("own");
      expect(own.kinds.find((kind) => kind.name === "投诉")?.count).toBe(1);
      expect(own.sources.find((row) => row.source === "manual")?.count).toBe(1);
      expect(own.agents).toHaveLength(1);

      const all = await analysisStats({
        createdFrom: at(-7 * 24).toISOString(),
        createdTo: NOW.toISOString(),
      });
      expect(all.kinds.find((kind) => kind.name === "投诉")?.count).toBe(2);
    });

    it("软删与 file_import 不计入任何周期块", async () => {
      await createComplaintTickets(prisma, [
        fixture({ createdAt: at(-24) }),
        fixture({ createdAt: at(-24), deletedAt: at(-1) }),
        fixture({ createdAt: at(-24), source: "file_import" }),
      ]);

      const stats = await analysisStats();
      expect(stats.kinds.find((kind) => kind.name === "投诉")?.count).toBe(1);
      expect(stats.sources.reduce((sum, row) => sum + row.count, 0)).toBe(1);
      expect(
        stats.matrix.rows.reduce(
          (total, row) => total + Object.values(row.cells).reduce((sum, count) => sum + count, 0),
          0,
        ),
      ).toBe(1);
      expect(stats.trend.points.reduce((sum, point) => sum + point.created, 0)).toBe(1);
    });

    it("rejects callers without dashboard.view", async () => {
      const caller = harness.callerWith(seeded.users.cs1, seeded.roles.frontline, ["ticket.view"]);
      await expect(caller.dashboard.analysisStats({})).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("性能", () => {
    it("3000 工单上两个 procedure 各在 2 秒内完成", async () => {
      const assignees = [seeded.users.cs1.id, seeded.users.manager.id, seeded.users.admin.id, null];
      const statuses = ["unassigned", "assigned", "processing", "completed"] as const;
      await createComplaintTickets(
        prisma,
        Array.from({ length: 3000 }, (_, i) => {
          const status = statuses[i % statuses.length] ?? "unassigned";
          const assigneeId = status === "unassigned" ? null : (assignees[i % 4] ?? null);
          return fixture(
            {
              slaPolicyId: harness.slaPolicyId(i % 11 === 0 ? "特急投诉" : "一般投诉"),
              status,
              assigneeId,
              createdAt: new Date(NOW.getTime() - (i % 96) * HOUR_MS),
              dueAt: i % 11 === 0 ? null : new Date(NOW.getTime() + ((i % 96) - 48) * HOUR_MS),
              completionTime:
                status === "completed" ? new Date(NOW.getTime() - (i % 24) * HOUR_MS) : null,
            },
            { project: `项目${i % 12}` },
          );
        }),
      );

      const actionStart = performance.now();
      await actionStats();
      expect(performance.now() - actionStart).toBeLessThan(2000);

      const analysisStart = performance.now();
      await analysisStats();
      expect(performance.now() - analysisStart).toBeLessThan(2000);
    });
  });
});
