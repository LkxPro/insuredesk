import { TicketKindKey, TicketStatus } from "@insuredesk/shared";
import { regionPath } from "@insuredesk/shared/region";
import { prisma } from "../../apps/api/src/db.ts";
import { stampFromPolicy } from "../../apps/api/src/services/ticket.service.ts";
import { requireTicketKindId } from "../../apps/api/src/services/ticket-kind.service.ts";

const TICKET_ID_PREFIX = "clchangelogheat";
// 地图按库内全部带地址工单着色：v2026.10.0 截图钩子留下的演示单会改变本图色阶
const LEGACY_MAP_TICKET_ID_PREFIX = "clchangelogmap";
const DAY_MS = 24 * 60 * 60 * 1000;

const DISTRICT_COUNTS: readonly (readonly [string, number])[] = [
  ["440305", 10],
  ["440106", 8],
  ["440304", 6],
  ["440104", 6],
  ["320106", 8],
  ["320505", 7],
  ["320115", 6],
  ["320211", 5],
  ["330106", 9],
  ["330105", 5],
  ["330205", 5],
  ["330302", 3],
  ["370102", 7],
  ["370202", 7],
  ["370303", 5],
  ["510107", 9],
  ["510104", 8],
  ["410102", 8],
  ["410302", 7],
  ["110105", 8],
  ["110108", 6],
  ["310115", 8],
  ["310104", 5],
  ["420111", 7],
  ["420102", 5],
  ["430103", 6],
  ["430104", 4],
  ["350102", 5],
  ["350203", 5],
  ["340104", 8],
  ["130102", 8],
  ["610102", 7],
  ["500103", 6],
  ["210102", 3],
  ["210202", 3],
  ["360102", 5],
  ["450102", 5],
  ["530102", 4],
  ["140105", 3],
  ["520102", 3],
  ["120101", 3],
  ["230102", 2],
  ["220102", 2],
  ["650102", 2],
  ["150102", 1],
  ["620102", 1],
  ["460106", 1],
  ["640104", 1],
];

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

function addressOf(districtCode: string) {
  const path = regionPath(districtCode);
  const province = path.find((node) => node.level === "province");
  const city = path.find((node) => node.level === "city");
  const district = path.find((node) => node.level === "district");
  if (!province || district?.code !== districtCode) {
    throw new Error(`区县码不在区划数据中：${districtCode}`);
  }
  return {
    provinceCode: province.code,
    provinceName: province.name,
    cityCode: city?.code ?? null,
    cityName: city?.name ?? null,
    districtCode: district.code,
    districtName: district.name,
  };
}

const demoUser = await prisma.user.findUnique({ where: { username: "admin" } });
const channels = await prisma.channel.findMany({ orderBy: { displayOrder: "asc" } });
const categories = await prisma.ticketCategory.findMany({ orderBy: { displayOrder: "asc" } });
const complaintKindId = await requireTicketKindId(prisma, TicketKindKey.Complaint);

await prisma.ticket.deleteMany({
  where: {
    OR: [
      { id: { startsWith: TICKET_ID_PREFIX } },
      { id: { startsWith: LEGACY_MAP_TICKET_ID_PREFIX } },
    ],
  },
});

const now = Date.now();
let index = 0;
for (const [districtCode, count] of DISTRICT_COUNTS) {
  const address = addressOf(districtCode);
  for (let n = 0; n < count; n++) {
    // 地图页默认只筛近 90 天创建的工单
    const anchor = new Date(now - (1 + (index % 80)) * DAY_MS);
    const ticket = await prisma.ticket.create({
      data: {
        id: `${TICKET_ID_PREFIX}${String(index).padStart(3, "0")}`,
        source: "manual",
        kindId: complaintKindId,
        createdAt: anchor,
        slaAnchorAt: anchor,
        status: TicketStatus.Processing,
        creatorId: demoUser?.id ?? null,
        assigneeId: demoUser?.id ?? null,
        assignedAt: new Date(anchor.getTime() + 60 * 60 * 1000),
        contactCount: 1,
        ...address,
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
        policyNumbers: [`DEMO-HEAT-${5000 + index}`],
      },
    });
    index++;
  }
}

await prisma.$disconnect();
