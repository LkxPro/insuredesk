import type { Permission, TicketCreateData } from "@insuredesk/shared";
import { isExternalRole, NUCLEAR_BODY_STATUSES } from "@insuredesk/shared";
import { REGION_PROVINCES, type RegionNode } from "@insuredesk/shared/region";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import type { AuthenticatedUser } from "../src/services/auth.service.ts";
import { createTicket } from "../src/services/ticket.service.ts";

if (process.env.DATABASE_URL === undefined) {
  process.loadEnvFile(".env");
}

const TOTAL = Number(process.argv[2] ?? 3000);
const MARKER = "MAPDEMO-";
const DAY_MS = 24 * 3600 * 1000;

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "",
    options: "-c timezone=UTC",
  }),
});

let seed = 20261022;
function rand() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
}
function gauss() {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}
function jitter(sigma: number) {
  return Math.exp(sigma * gauss());
}
function pick<T>(items: readonly T[], weight: (item: T) => number): T {
  const weights = items.map(weight);
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] ?? 0;
    if (r <= 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

const PROVINCE_WEIGHT: Record<string, number> = {
  广东省: 10,
  江苏省: 8,
  山东省: 7.5,
  浙江省: 7,
  河南省: 7,
  四川省: 6,
  河北省: 5,
  湖北省: 4.5,
  湖南省: 4.5,
  安徽省: 4,
  福建省: 3.6,
  上海市: 3.6,
  北京市: 3.3,
  陕西省: 3,
  江西省: 3,
  广西壮族自治区: 3,
  辽宁省: 3,
  重庆市: 2.7,
  云南省: 2.5,
  山西省: 2.2,
  贵州省: 2.1,
  黑龙江省: 1.9,
  天津市: 1.6,
  吉林省: 1.4,
  内蒙古自治区: 1.2,
  新疆维吾尔自治区: 1.2,
  甘肃省: 1.2,
  海南省: 0.8,
  宁夏回族自治区: 0.35,
  青海省: 0.3,
  西藏自治区: 0.15,
  香港特别行政区: 0.12,
  澳门特别行政区: 0.04,
};

const HOT_CITIES = new Set([
  "广州市",
  "深圳市",
  "东莞市",
  "佛山市",
  "南京市",
  "苏州市",
  "无锡市",
  "杭州市",
  "宁波市",
  "温州市",
  "济南市",
  "青岛市",
  "郑州市",
  "成都市",
  "武汉市",
  "长沙市",
  "合肥市",
  "福州市",
  "厦门市",
  "泉州市",
  "西安市",
  "南昌市",
  "南宁市",
  "沈阳市",
  "大连市",
  "昆明市",
  "太原市",
  "贵阳市",
  "哈尔滨市",
  "长春市",
  "石家庄市",
  "呼和浩特市",
  "乌鲁木齐市",
  "兰州市",
  "海口市",
  "银川市",
  "西宁市",
  "拉萨市",
  "唐山市",
  "保定市",
  "烟台市",
  "潍坊市",
  "临沂市",
  "徐州市",
  "常州市",
  "南通市",
  "嘉兴市",
  "金华市",
  "绍兴市",
  "台州市",
  "洛阳市",
  "南阳市",
  "中山市",
  "惠州市",
  "珠海市",
  "汕头市",
  "绵阳市",
  "宜昌市",
  "襄阳市",
  "株洲市",
  "衡阳市",
  "芜湖市",
  "柳州市",
  "赣州市",
  "遵义市",
  "曲靖市",
  "包头市",
  "鄂尔多斯市",
  "宝鸡市",
  "咸阳市",
]);
const CAPITALS = new Set([
  "广州市",
  "南京市",
  "杭州市",
  "济南市",
  "郑州市",
  "成都市",
  "武汉市",
  "长沙市",
  "合肥市",
  "福州市",
  "西安市",
  "南昌市",
  "南宁市",
  "沈阳市",
  "昆明市",
  "太原市",
  "贵阳市",
  "哈尔滨市",
  "长春市",
  "石家庄市",
  "呼和浩特市",
  "乌鲁木齐市",
  "兰州市",
  "海口市",
  "银川市",
  "西宁市",
  "拉萨市",
]);
const SUPER_CITIES = new Set([
  "深圳市",
  "广州市",
  "杭州市",
  "成都市",
  "武汉市",
  "苏州市",
  "南京市",
  "西安市",
  "郑州市",
  "长沙市",
]);

function cityWeight(city: RegionNode) {
  const name = city.name;
  let w = 1;
  if (SUPER_CITIES.has(name)) w = 7;
  else if (CAPITALS.has(name)) w = 5;
  else if (HOT_CITIES.has(name)) w = 3;
  else if (/州$|盟$|地区$/.test(name) && !name.endsWith("市")) w = 0.2;
  else if (city.children.length === 0) w = 0.4;
  return w * jitter(0.2);
}

function districtWeight(district: RegionNode, index: number) {
  let w = district.name.endsWith("区") ? 2 : district.name.endsWith("市") ? 1 : 0.6;
  if (index < 4 && district.name.endsWith("区")) w *= 1.6;
  return w * jitter(0.25);
}

function memoWeights(
  nodes: readonly RegionNode[],
  weight: (node: RegionNode, index: number) => number,
) {
  return new Map(nodes.map((node, i) => [node.code, weight(node, i)]));
}

const provinces = REGION_PROVINCES.filter((p) => (PROVINCE_WEIGHT[p.name] ?? 0) > 0);
const provinceW = new Map(
  provinces.map((p) => [p.code, (PROVINCE_WEIGHT[p.name] ?? 0) * jitter(0.12)]),
);
const childW = new Map<string, Map<string, number>>();
function childWeights(parent: RegionNode) {
  let map = childW.get(parent.code);
  if (!map) {
    const isCityLevel = parent.children[0]?.level === "city";
    map = isCityLevel
      ? memoWeights(parent.children, cityWeight)
      : memoWeights(parent.children, districtWeight);
    childW.set(parent.code, map);
  }
  return map;
}

function pickAddress() {
  const province = pick(provinces, (p) => provinceW.get(p.code) ?? 0);
  let node = province;
  while (node.children.length > 0) {
    const weights = childWeights(node);
    node = pick(node.children, (c) => weights.get(c.code) ?? 0);
  }
  const city =
    node.level === "city"
      ? node
      : node.level === "district" && node.parentCode !== province.code
        ? (province.children.find((c) => c.code === node.parentCode) ?? null)
        : null;
  return {
    provinceCode: province.code,
    cityCode: city?.code ?? null,
    districtCode: node.level === "district" ? node.code : null,
  };
}

const FEEDBACK_CHANNEL_WEIGHT: Record<string, number> = {
  保司400热线: 22,
  经纪400热线: 14,
  支付400热线: 12,
  网微投诉: 10,
  黑猫: 9,
  监管引导件: 8,
  消保平台: 6,
  监管正式件: 4,
  微信商户: 4,
  发卡行: 3,
  市监工商: 2,
  "市监/工商": 2,
  人行: 2,
  政府转办: 2,
  派出所: 1,
};

const SURNAMES =
  "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤";
const GIVEN =
  "伟芳娜秀英敏静丽强磊军洋勇艳杰娟涛明超秀兰霞平刚桂英华建国玉兰红梅志强俊杰晓东海燕欣怡子轩浩然雨涵梓涵思远佳怡文博一鸣宇航";
const PROJECTS = [
  "融盛百万医疗",
  "东方大地意外险",
  "泰康互联住院医疗",
  "众惠惠民保",
  "利宝车险",
  "中华安心保",
  "安盛重疾险",
  "暖哇健康告知险",
];
const BROKERAGES = ["东方大地经纪", "骏伯保险经纪", "凯森保险经纪", "爱邦保险经纪", "多点保险经纪"];
const PAYMENTS = ["连连支付", "易宝支付", "富友支付", "通联支付", "银商支付", "微信支付", "支付宝"];
const REQUESTS = [
  "客户称未授权开通自动续费，要求全额退还已扣保费。",
  "客户对扣费金额有异议，要求提供扣费明细并说明原因。",
  "客户反馈理赔进度缓慢，要求尽快给出明确结论。",
  "客户称销售时未告知等待期，要求退保并退还保费。",
  "客户频繁接到营销电话，要求停止骚扰并核实信息来源。",
  "客户要求取消保单并退还当期保费。",
  "客户对理赔金额不认可，要求重新核定。",
  "客户称页面宣传与实际保障不符，要求解释并处理。",
  "客户无法找到保单信息，要求补发电子保单。",
  "客户投诉客服态度差，要求道歉并回访。",
];
const PRIORITIES = [null, null, "low", "medium", "medium", "high", "urgent"] as const;
const COMPLETION_WEIGHT: Record<string, number> = {
  已退保: 20,
  已协商解决: 18,
  正常完结: 16,
  已达成一致: 12,
  已赔付: 8,
  客户自行撤诉: 6,
  联系不上: 5,
  未取得有效联系: 4,
  "诉求过高，无法达成一致": 4,
  转其他部门处理: 3,
  冷处理: 2,
  无效工单: 2,
};

function phone() {
  return `1${pick(["3", "5", "7", "8", "9"], () => 1)}${String(Math.floor(rand() * 1e9)).padStart(9, "0")}`;
}

async function main() {
  const manager = await prisma.user.findUniqueOrThrow({
    where: { username: "manager" },
    include: { role: true },
  });
  const assignees = await prisma.user.findMany({ where: { username: { in: ["cs1", "manager"] } } });
  const creator: AuthenticatedUser = {
    id: manager.id,
    username: manager.username,
    name: manager.name,
    email: manager.email,
    team: manager.team,
    roleId: manager.role.id,
    roleName: manager.role.name,
    permissions: manager.role.permissions as Permission[],
    requiredTicketFields: manager.role.requiredTicketFields,
    isExternal: isExternalRole(manager.role),
  };
  const feedbackChannels = (
    await prisma.userFeedbackChannel.findMany({ where: { active: true } })
  ).filter((c) => !c.name.includes("客服热线"));
  const receiveChannels = await prisma.feedbackReceiveChannel.findMany({ where: { active: true } });
  const categories = await prisma.ticketCategory.findMany({ where: { active: true } });
  const channels = await prisma.channel.findMany({ where: { active: true } });
  const completionStatuses = await prisma.completionStatus.findMany({ where: { active: true } });

  const removed = await prisma.ticket.deleteMany({
    where: { complaintDetail: { internalOrderNumber: { startsWith: MARKER } } },
  });
  if (removed.count > 0) console.log(`removed previous: ${removed.count}`);

  const now = Date.now();
  let done = 0;
  const jobs = Array.from({ length: TOTAL }, (_, i) => i);
  async function worker() {
    for (let i = jobs.shift(); i !== undefined; i = jobs.shift()) {
      const ageDays = Math.min(179.9, Math.abs(gauss()) * 60 + rand() * 20);
      const createdAt = new Date(now - ageDays * DAY_MS - rand() * DAY_MS);
      const tel = phone();
      const policy = `${MARKER}P${String(i + 1).padStart(5, "0")}`;
      const input: TicketCreateData = {
        feedbackTime: new Date(createdAt.getTime() - rand() * 6 * 3600 * 1000).toISOString(),
        channelId: pick(channels, () => 1).id,
        project: pick(PROJECTS, () => 1),
        brokerageEntity: pick(BROKERAGES, () => 1),
        paymentChannel: pick(PAYMENTS, () => 1),
        internalOrderNumber: `${MARKER}${String(i + 1).padStart(5, "0")}`,
        policyNumbers: [policy],
        noPolicyNumber: false,
        userFeedbackChannelId: pick(feedbackChannels, (c) => FEEDBACK_CHANNEL_WEIGHT[c.name] ?? 1)
          .id,
        feedbackReceiveChannelId: rand() < 0.7 ? pick(receiveChannels, () => 1).id : null,
        customerName: `${pick([...SURNAMES], () => 1)}${pick([...GIVEN], () => 1)}${rand() < 0.5 ? pick([...GIVEN], () => 1) : ""}`,
        phone: tel,
        contactPhone: null,
        customerRequest: pick(REQUESTS, () => 1),
        nuclearBodyStatus: pick(NUCLEAR_BODY_STATUSES, () => 1),
        hasContacted: false,
        contactTime: null,
        contactId: null,
        categoryId: pick(categories, () => 1).id,
        slaPolicyId: null,
        priority: pick(PRIORITIES, () => 1),
        address: pickAddress(),
      };
      const ticket = await createTicket(
        { prisma, clock: { now: () => createdAt } },
        creator,
        input,
        {
          allowDuplicate: true,
        },
      );

      const r = rand();
      const status =
        ageDays > 20
          ? r < 0.85
            ? "completed"
            : r < 0.95
              ? "processing"
              : "assigned"
          : r < 0.35
            ? "completed"
            : r < 0.6
              ? "processing"
              : r < 0.8
                ? "assigned"
                : "unassigned";
      if (status !== "unassigned") {
        const assignee = pick(assignees, (u) => (u.username === "cs1" ? 3 : 1));
        const assignedAt = new Date(createdAt.getTime() + rand() * 4 * 3600 * 1000);
        const completed = status === "completed";
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            status,
            assigneeId: assignee.id,
            assignedAt,
            contactCount: status === "assigned" ? 0 : 1 + Math.floor(rand() * 3),
            completionStatusId: completed
              ? pick(completionStatuses, (s) => COMPLETION_WEIGHT[s.name] ?? 1).id
              : null,
            completionTime: completed
              ? new Date(Math.min(now, assignedAt.getTime() + (0.5 + rand() * 6) * DAY_MS))
              : null,
          },
        });
      }
      done++;
      if (done % 500 === 0) console.log(`${done}/${TOTAL}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`created ${done}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
