import { TicketKindKey, TicketStatus } from "@insuredesk/shared";
import { prisma } from "../../apps/api/src/db.ts";
import { stampFromPolicy } from "../../apps/api/src/services/ticket.service.ts";
import { requireTicketKindId } from "../../apps/api/src/services/ticket-kind.service.ts";
import { REFUND_PUSH_PLATFORM } from "../../packages/shared/src/refund-push.ts";
import { ensureDashboardDataset } from "../v2026.09.1/dashboard-dataset.ts";

const TICKET_ID_PREFIX = "clchangelogcrt";
const MINUTE_MS = 60 * 1000;

await ensureDashboardDataset();

const [cs1, cs2, manager] = await Promise.all(
  ["cs1", "cs2", "manager"].map((username) =>
    prisma.user.findUniqueOrThrow({ where: { username } }),
  ),
);
const policies = await prisma.slaPolicy.findMany({
  where: { name: { in: ["一般投诉", "高级投诉", "加急投诉"] } },
});
const policyByName = new Map(policies.map((p) => [p.name, p]));
const channels = await prisma.channel.findMany({ orderBy: { displayOrder: "asc" } });
const categories = await prisma.ticketCategory.findMany({
  orderBy: { displayOrder: "asc" },
});
const complaintKindId = await requireTicketKindId(prisma, TicketKindKey.Complaint);
const refundKindId = await requireTicketKindId(prisma, TicketKindKey.RefundException);
const refundPolicy = await prisma.slaPolicy.findFirst({
  where: { kindId: refundKindId },
});

// 列表默认按创建时间倒序：演示工单锚在最近几分钟到几小时，稳定占据首页顶部。
const now = new Date();
const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE_MS);

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

const specs = [
  {
    source: "manual",
    creator: cs1,
    assignee: cs2,
    status: TicketStatus.Processing,
    minutesAgo: 10,
    policy: "一般投诉",
  },
  {
    source: "feishu_form",
    creator: null,
    assignee: cs1,
    status: TicketStatus.Assigned,
    minutesAgo: 25,
    policy: "一般投诉",
  },
  {
    source: "manual",
    creator: cs2,
    assignee: manager,
    status: TicketStatus.Processing,
    minutesAgo: 40,
    policy: "高级投诉",
  },
  {
    source: "external_channel",
    creator: cs1,
    assignee: cs2,
    status: TicketStatus.Assigned,
    minutesAgo: 55,
    policy: "加急投诉",
  },
  {
    source: "community",
    creator: null,
    assignee: null,
    status: TicketStatus.Unassigned,
    minutesAgo: 70,
    policy: "一般投诉",
  },
  // file_import 被列表缺省来源筛选排除（归档单），演示李主管作创建人只能用 manual。
  {
    source: "manual",
    creator: manager,
    assignee: cs1,
    status: TicketStatus.Processing,
    minutesAgo: 85,
    policy: "一般投诉",
  },
] as const;

await prisma.ticket.deleteMany({ where: { id: { startsWith: TICKET_ID_PREFIX } } });

for (const [index, spec] of specs.entries()) {
  const anchor = ago(spec.minutesAgo);
  const policy = policyByName.get(spec.policy) ?? null;
  const ticket = await prisma.ticket.create({
    data: {
      id: `${TICKET_ID_PREFIX}${index}`,
      source: spec.source,
      kindId: complaintKindId,
      createdAt: anchor,
      slaAnchorAt: anchor,
      status: spec.status,
      creatorId: spec.creator?.id ?? null,
      assigneeId: spec.assignee?.id ?? null,
      assignedAt: spec.assignee ? new Date(anchor.getTime() + 5 * MINUTE_MS) : null,
      contactCount: 1,
      ...stampFromPolicy(policy, anchor),
    },
  });
  await prisma.ticketComplaintDetail.create({
    data: {
      ticketId: ticket.id,
      feedbackTime: anchor,
      customerName: customerNames[index % customerNames.length],
      channelId: channels[index % channels.length]?.id ?? null,
      categoryId: categories[index % categories.length]?.id ?? null,
      policyNumbers: [`DEMO-POL-${3100 + index}`],
    },
  });
}

// 一张骏伯平台推送的退费异常单：创建人列显示平台名，与投诉单形成对照。
const refundAnchor = ago(100);
await prisma.ticket.create({
  data: {
    id: `${TICKET_ID_PREFIX}r0`,
    source: REFUND_PUSH_PLATFORM,
    kindId: refundKindId,
    createdAt: refundAnchor,
    slaAnchorAt: refundAnchor,
    status: TicketStatus.Processing,
    assigneeId: manager.id,
    assignedAt: new Date(refundAnchor.getTime() + 5 * MINUTE_MS),
    contactCount: 2,
    ...stampFromPolicy(refundPolicy, refundAnchor),
  },
});

// 看板演示集的存量工单补齐客户姓名与创建人，避免列表下方大片「—」。
const backlog = await prisma.ticket.findMany({
  where: { id: { startsWith: "clchangelogdash" } },
  include: { complaintDetail: true },
  orderBy: { createdAt: "desc" },
});
const creators = [cs1, cs2, manager];
for (const [index, ticket] of backlog.entries()) {
  if (ticket.complaintDetail) {
    await prisma.ticketComplaintDetail.update({
      where: { ticketId: ticket.id },
      data: { customerName: customerNames[index % customerNames.length] },
    });
  }
  if (ticket.source === "manual") {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { creatorId: creators[index % creators.length].id },
    });
  }
}

await prisma.$disconnect();
