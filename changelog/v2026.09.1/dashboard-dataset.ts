import { DEFAULT_SLA_POLICIES, TicketKindKey, TicketStatus } from "@insuredesk/shared";
import {
  DEFAULT_SLA_POLICY_DESCRIPTIONS,
  DEFAULT_TICKET_CATEGORIES,
  DEMO_PASSWORD,
  seedFactoryRolesAndDemoUsers,
  seedRefundDefaultSlaPolicy,
} from "../../apps/api/prisma/seed-data.ts";
import { prisma } from "../../apps/api/src/db.ts";
import { hashPassword } from "../../apps/api/src/services/auth.service.ts";
import { stampFromPolicy } from "../../apps/api/src/services/ticket.service.ts";
import { requireTicketKindId } from "../../apps/api/src/services/ticket-kind.service.ts";
import { REFUND_PUSH_PLATFORM } from "../../packages/shared/src/refund-push.ts";

const TICKET_ID_PREFIX = "clchangelogdash";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * 看板/列表截图共用的演示数据集：六区各自需要的工单形态都覆盖到（超时、
 * 即将超时、待首响、未分配、逐策略在途、渠道×用户反馈渠道矩阵、本周期与
 * 上一周期的趋势对照、种类/类别/来源分布、多坐席负载）。固定 id 前缀，
 * 重跑先删后建，保证相对 now 的时间口径不随库龄漂移。
 */
export async function ensureDashboardDataset(): Promise<void> {
  const { roles, users } = await seedFactoryRolesAndDemoUsers(prisma);
  const cs2 = await prisma.user.upsert({
    where: { username: "cs2" },
    update: {},
    create: {
      username: "cs2",
      name: "陈客服",
      email: "cs2@insuredesk.local",
      roleId: roles.frontline.id,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      active: true,
    },
  });
  const agents = [users.cs1, users.manager, cs2];

  const complaintKindId = await requireTicketKindId(prisma, TicketKindKey.Complaint);
  const refundKindId = await requireTicketKindId(prisma, TicketKindKey.RefundException);

  const policies = [];
  for (const [index, defaults] of DEFAULT_SLA_POLICIES.entries()) {
    policies.push(
      await prisma.slaPolicy.upsert({
        where: { name: defaults.name },
        update: {},
        create: {
          name: defaults.name,
          description: DEFAULT_SLA_POLICY_DESCRIPTIONS[defaults.name] ?? null,
          sortOrder: index + 1,
          active: true,
          firstResponseMinutes: defaults.firstResponseMinutes,
          overdueHours: defaults.overdueHours,
          reminderRules: defaults.reminderRules,
          kindId: complaintKindId,
        },
      }),
    );
  }
  const refundPolicy = await seedRefundDefaultSlaPolicy(prisma);

  const channelNames = ["保司", "经纪", "支付", "监管"];
  const channels = [];
  for (const [index, name] of channelNames.entries()) {
    channels.push(
      await prisma.channel.upsert({
        where: { name },
        update: {},
        create: { name, displayOrder: index + 1 },
      }),
    );
  }

  const feedbackChannelNames = ["保司400热线", "经纪400热线", "网微投诉", "内部客服热线"];
  const feedbackChannels = [];
  for (const [index, name] of feedbackChannelNames.entries()) {
    feedbackChannels.push(
      await prisma.userFeedbackChannel.upsert({
        where: { name },
        update: {},
        create: { name, displayOrder: index + 1 },
      }),
    );
  }

  const categories = [];
  for (const [index, name] of DEFAULT_TICKET_CATEGORIES.slice(0, 6).entries()) {
    categories.push(
      await prisma.ticketCategory.upsert({
        where: { name },
        update: {},
        create: { name, displayOrder: index + 1 },
      }),
    );
  }

  const completionStatus = await prisma.completionStatus.findFirst({
    where: { active: true },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
  });

  await prisma.ticket.deleteMany({ where: { id: { startsWith: TICKET_ID_PREFIX } } });

  const now = new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const sources = ["manual", "feishu_form", "community"] as const;
  let seq = 0;

  async function addTicket(spec: {
    hoursAgo: number;
    status: (typeof TicketStatus)[keyof typeof TicketStatus];
    policy?: (typeof policies)[number] | null;
    assignee?: (typeof agents)[number];
    contactCount?: number;
    kindId?: string;
    source?: string;
    channel?: (typeof channels)[number];
    feedbackChannel?: (typeof feedbackChannels)[number];
    category?: (typeof categories)[number];
    completed?: boolean;
  }): Promise<void> {
    const anchor = ago(spec.hoursAgo * HOUR_MS);
    const policy = spec.policy === undefined ? policies[0] : spec.policy;
    const completed = spec.completed ?? false;
    const ticket = await prisma.ticket.create({
      data: {
        id: `${TICKET_ID_PREFIX}${String(seq++).padStart(3, "0")}`,
        source: spec.source ?? "manual",
        kindId: spec.kindId ?? complaintKindId,
        createdAt: anchor,
        slaAnchorAt: anchor,
        status: completed ? TicketStatus.Completed : spec.status,
        assigneeId: spec.assignee?.id ?? null,
        assignedAt: spec.assignee ? new Date(anchor.getTime() + HOUR_MS) : null,
        contactCount: spec.contactCount ?? 1,
        completionTime: completed ? new Date(anchor.getTime() + 30 * HOUR_MS) : null,
        completionStatusId: completed ? (completionStatus?.id ?? null) : null,
        ...stampFromPolicy(policy ?? null, anchor),
      },
    });
    if (spec.kindId === undefined || spec.kindId === complaintKindId) {
      await prisma.ticketComplaintDetail.create({
        data: {
          ticketId: ticket.id,
          feedbackTime: anchor,
          channelId: spec.channel?.id ?? null,
          userFeedbackChannelId: spec.feedbackChannel?.id ?? null,
          categoryId: spec.category?.id ?? null,
          policyNumbers: [`DEMO-POL-${2000 + seq}`],
        },
      });
    }
  }

  // 需要行动区：超时 2、即将超时 2（48h 策略锚在 46~47h 前）、待首响 3（零联系，
  // 其中一张已过 120 分钟首响线）、未分配 2。
  await addTicket({
    hoursAgo: 96,
    status: TicketStatus.Processing,
    assignee: agents[0],
    channel: channels[0],
    feedbackChannel: feedbackChannels[0],
    category: categories[2],
  });
  await addTicket({
    hoursAgo: 76,
    status: TicketStatus.Assigned,
    assignee: agents[1],
    policy: policies[1],
    channel: channels[1],
    feedbackChannel: feedbackChannels[1],
    category: categories[3],
  });
  await addTicket({
    hoursAgo: 47,
    status: TicketStatus.Processing,
    assignee: agents[0],
    channel: channels[2],
    feedbackChannel: feedbackChannels[2],
    category: categories[0],
  });
  await addTicket({
    hoursAgo: 46.5,
    status: TicketStatus.Processing,
    assignee: agents[2],
    channel: channels[0],
    feedbackChannel: feedbackChannels[3],
    category: categories[1],
  });
  await addTicket({
    hoursAgo: 3,
    status: TicketStatus.Assigned,
    assignee: agents[0],
    contactCount: 0,
    channel: channels[1],
    feedbackChannel: feedbackChannels[0],
    category: categories[4],
  });
  await addTicket({
    hoursAgo: 1.5,
    status: TicketStatus.Assigned,
    assignee: agents[1],
    contactCount: 0,
    channel: channels[0],
    feedbackChannel: feedbackChannels[1],
    category: categories[5],
  });
  await addTicket({
    hoursAgo: 0.5,
    status: TicketStatus.Assigned,
    assignee: agents[2],
    contactCount: 0,
    policy: policies[2],
    channel: channels[2],
    feedbackChannel: feedbackChannels[2],
    category: categories[2],
  });
  await addTicket({
    hoursAgo: 30,
    status: TicketStatus.Unassigned,
    channel: channels[3],
    feedbackChannel: feedbackChannels[3],
    category: categories[1],
  });
  await addTicket({
    hoursAgo: 5,
    status: TicketStatus.Unassigned,
    channel: channels[0],
    feedbackChannel: feedbackChannels[0],
    category: categories[3],
  });

  // 策略条补足：高级/加急各有在途，另有一张未指定策略（进「未指定」桶）。
  await addTicket({
    hoursAgo: 20,
    status: TicketStatus.Processing,
    assignee: agents[1],
    policy: policies[1],
    channel: channels[1],
    feedbackChannel: feedbackChannels[1],
    category: categories[0],
  });
  await addTicket({
    hoursAgo: 10,
    status: TicketStatus.Processing,
    assignee: agents[2],
    policy: policies[2],
    channel: channels[2],
    feedbackChannel: feedbackChannels[2],
    category: categories[4],
  });
  await addTicket({
    hoursAgo: 2,
    status: TicketStatus.Assigned,
    assignee: agents[2],
    policy: null,
    contactCount: 0,
    channel: channels[0],
    feedbackChannel: feedbackChannels[3],
    category: categories[5],
  });

  // 历史量：2~56 天前每两天一张，渠道×用户反馈渠道×类别×来源×坐席轮转，
  // 3/4 完结 —— 供趋势环比（近 30 天 vs 前 30 天）、交叉矩阵与分布区出数。
  for (let i = 0; i < 28; i++) {
    await addTicket({
      hoursAgo: 24 * (2 + i * 2) + (i % 5) * 3,
      status: i % 4 === 0 ? TicketStatus.Processing : TicketStatus.Completed,
      policy: policies[i % policies.length],
      assignee: agents[i % agents.length],
      contactCount: 1 + (i % 3),
      channel: channels[i % channels.length],
      feedbackChannel: feedbackChannels[i % feedbackChannels.length],
      category: categories[i % categories.length],
      source: sources[i % sources.length],
      completed: i % 4 !== 0,
    });
  }

  // 退费异常 3 张：种类环形图与来源构成需要第二种类。
  for (const [i, daysAgo] of [3, 10, 20].entries()) {
    const anchor = ago(daysAgo * DAY_MS);
    await prisma.ticket.create({
      data: {
        id: `${TICKET_ID_PREFIX}r${i}`,
        source: REFUND_PUSH_PLATFORM,
        kindId: refundKindId,
        createdAt: anchor,
        slaAnchorAt: anchor,
        status: i === 0 ? TicketStatus.Processing : TicketStatus.Completed,
        assigneeId: agents[i % agents.length].id,
        assignedAt: new Date(anchor.getTime() + HOUR_MS),
        contactCount: 2,
        completionTime: i === 0 ? null : new Date(anchor.getTime() + 20 * HOUR_MS),
        completionStatusId: i === 0 ? null : (completionStatus?.id ?? null),
        ...stampFromPolicy(refundPolicy, anchor),
      },
    });
  }
}
