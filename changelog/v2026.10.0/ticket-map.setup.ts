import { TicketKindKey, TicketStatus } from "@insuredesk/shared";
import { prisma } from "../../apps/api/src/db.ts";
import { stampFromPolicy } from "../../apps/api/src/services/ticket.service.ts";
import { requireTicketKindId } from "../../apps/api/src/services/ticket-kind.service.ts";

const TICKET_ID_PREFIX = "clchangelogmap";
const DAY_MS = 24 * 60 * 60 * 1000;

// ticket-map-ranking 截图复用本脚本，南京区县数据供其区县排名。
const NANJING_DISTRICTS = [
  ["320106", "鼓楼区", 4],
  ["320104", "秦淮区", 3],
  ["320115", "江宁区", 3],
  ["320102", "玄武区", 2],
  ["320105", "建邺区", 2],
  ["320111", "浦口区", 1],
  ["320113", "栖霞区", 1],
  ["320114", "雨花台区", 1],
] as const;

// 地图页默认只筛近 90 天创建的工单，演示工单须全部落在该窗口内。
const CLUSTERS = [
  {
    provinceCode: "440000",
    provinceName: "广东省",
    cityCode: "440300",
    cityName: "深圳市",
    districtCode: "440305",
    districtName: "南山区",
    count: 5,
  },
  {
    provinceCode: "440000",
    provinceName: "广东省",
    cityCode: "440100",
    cityName: "广州市",
    districtCode: "440106",
    districtName: "天河区",
    count: 3,
  },
  {
    provinceCode: "110000",
    provinceName: "北京市",
    cityCode: null,
    cityName: null,
    districtCode: "110105",
    districtName: "朝阳区",
    count: 4,
  },
  {
    provinceCode: "310000",
    provinceName: "上海市",
    cityCode: null,
    cityName: null,
    districtCode: "310115",
    districtName: "浦东新区",
    count: 3,
  },
  {
    provinceCode: "510000",
    provinceName: "四川省",
    cityCode: "510100",
    cityName: "成都市",
    districtCode: "510107",
    districtName: "武侯区",
    count: 2,
  },
  {
    provinceCode: "330000",
    provinceName: "浙江省",
    cityCode: "330100",
    cityName: "杭州市",
    districtCode: "330106",
    districtName: "西湖区",
    count: 2,
  },
  {
    provinceCode: "420000",
    provinceName: "湖北省",
    cityCode: "420100",
    cityName: "武汉市",
    districtCode: "420111",
    districtName: "洪山区",
    count: 1,
  },
  {
    provinceCode: "650000",
    provinceName: "新疆维吾尔自治区",
    cityCode: "650100",
    cityName: "乌鲁木齐市",
    districtCode: "650102",
    districtName: "天山区",
    count: 1,
  },
  ...NANJING_DISTRICTS.map(([districtCode, districtName, count]) => ({
    provinceCode: "320000",
    provinceName: "江苏省",
    cityCode: "320100",
    cityName: "南京市",
    districtCode,
    districtName,
    count,
  })),
] as const;

const customerNames = [
  "王建国",
  "李秀英",
  "张伟民",
  "刘桂芳",
  "陈志强",
  "赵春梅",
  "周文斌",
  "吴雅静",
];

// 创建人/责任人锚定截图登录账号（admin 必在），不假设 dev 库 seed 出的演示坐席齐全
const demoUser = await prisma.user.findUnique({ where: { username: "admin" } });
const channels = await prisma.channel.findMany({ orderBy: { displayOrder: "asc" } });
const categories = await prisma.ticketCategory.findMany({ orderBy: { displayOrder: "asc" } });
const complaintKindId = await requireTicketKindId(prisma, TicketKindKey.Complaint);

await prisma.ticket.deleteMany({ where: { id: { startsWith: TICKET_ID_PREFIX } } });

const now = Date.now();
let index = 0;
for (const cluster of CLUSTERS) {
  for (let n = 0; n < cluster.count; n++) {
    const anchor = new Date(now - (2 + index * 1.5) * DAY_MS);
    const ticket = await prisma.ticket.create({
      data: {
        id: `${TICKET_ID_PREFIX}${String(index).padStart(2, "0")}`,
        source: "manual",
        kindId: complaintKindId,
        createdAt: anchor,
        slaAnchorAt: anchor,
        status: TicketStatus.Processing,
        creatorId: demoUser?.id ?? null,
        assigneeId: demoUser?.id ?? null,
        assignedAt: new Date(anchor.getTime() + 60 * 60 * 1000),
        contactCount: 1,
        provinceCode: cluster.provinceCode,
        provinceName: cluster.provinceName,
        cityCode: cluster.cityCode,
        cityName: cluster.cityName,
        districtCode: cluster.districtCode,
        districtName: cluster.districtName,
        ...stampFromPolicy(null, anchor),
      },
    });
    await prisma.ticketComplaintDetail.create({
      data: {
        ticketId: ticket.id,
        feedbackTime: anchor,
        customerName: customerNames[index % customerNames.length],
        channelId: channels[index % channels.length]?.id ?? null,
        categoryId: categories[index % categories.length]?.id ?? null,
        policyNumbers: [`DEMO-POL-${4100 + index}`],
      },
    });
    index++;
  }
}

await prisma.$disconnect();
