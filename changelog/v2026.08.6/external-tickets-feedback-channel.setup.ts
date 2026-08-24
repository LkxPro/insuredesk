import { hashPassword } from "../../apps/api/src/services/auth.service.ts";
import { prisma } from "../../apps/api/src/db.ts";

const role = await prisma.role.findUniqueOrThrow({ where: { name: "外部用户" } });
const account = await prisma.user.upsert({
  where: { username: "demo-external" },
  update: {},
  create: {
    username: "demo-external",
    name: "东方大地保险",
    passwordHash: await hashPassword("password123"),
    roleId: role.id,
  },
});

const channelIdByName = new Map<string, string>();
for (const name of ["保司400热线", "网微投诉", "监管正式件"]) {
  const row = await prisma.userFeedbackChannel.upsert({
    where: { name },
    update: {},
    create: { name, displayOrder: 100 + channelIdByName.size },
  });
  channelIdByName.set(name, row.id);
}

await prisma.ticket.deleteMany({ where: { creatorId: account.id } });

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3_600_000);
const specs = [
  {
    submissionText: "客户反映保单理赔进度缓慢，要求尽快核实处理。",
    channel: "保司400热线",
    policyNumbers: ["PA20260812001"],
    customerName: "王立群",
    status: "processing",
    at: hoursAgo(30),
    followUp: "已联系承保保司核保部门，预计明日给出书面答复。",
  },
  {
    submissionText: "客户投诉续保扣费未提前通知，要求退回多扣款项。",
    channel: "网微投诉",
    policyNumbers: ["PA20260801017", "PA20260801018"],
    customerName: "李晓梅",
    status: "assigned",
    at: hoursAgo(52),
    followUp: null,
  },
  {
    submissionText: "客户对拒赔结论不认可，已表明将向监管投诉。",
    channel: "监管正式件",
    policyNumbers: ["PA20260722008"],
    customerName: "张建国",
    status: "unassigned",
    at: hoursAgo(70),
    followUp: null,
  },
  {
    submissionText: "客户咨询电话等待时间过长，要求回电说明。",
    channel: null,
    policyNumbers: [],
    customerName: "赵敏",
    status: "completed",
    at: hoursAgo(96),
    followUp: "已回电客户并致歉，客户表示接受。",
  },
] as const;

for (const spec of specs) {
  const [{ nextval }] = await prisma.$queryRaw<[{ nextval: bigint }]>`
    SELECT nextval('work_order_number_seq')
  `;
  const ticket = await prisma.ticket.create({
    data: {
      workOrderNumber: `WO${nextval}`,
      source: "external_channel",
      submissionText: spec.submissionText,
      creatorId: account.id,
      userFeedbackChannelId: spec.channel ? channelIdByName.get(spec.channel)! : null,
      policyNumbers: [...spec.policyNumbers],
      customerName: spec.customerName,
      status: spec.status,
      feedbackTime: spec.at,
      createdAt: spec.at,
      updatedAt: spec.at,
      completionTime: spec.status === "completed" ? hoursAgo(80) : null,
    },
  });
  await prisma.processLog.create({
    data: {
      ticketId: ticket.id,
      operatorId: account.id,
      operatorName: account.name,
      action: "create",
      remark: spec.submissionText,
      at: spec.at,
    },
  });
  if (spec.followUp) {
    await prisma.processLog.create({
      data: {
        ticketId: ticket.id,
        operatorId: "system",
        operatorName: "陈静",
        action: "comment",
        remark: spec.followUp,
        at: hoursAgo(4),
      },
    });
  }
}

await prisma.$disconnect();
