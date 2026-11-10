import { TicketKindKey } from "@insuredesk/shared";
import { seedTicketKinds } from "../../apps/api/prisma/seed-data.ts";
import { prisma } from "../../apps/api/src/db.ts";

try {
  await seedTicketKinds(prisma);
  const kind = await prisma.ticketKind.findUniqueOrThrow({
    where: { key: TicketKindKey.Complaint },
  });
  const role = await prisma.role.upsert({
    where: { name: "更新日志演示客服" },
    update: {},
    create: { name: "更新日志演示客服", permissions: ["ticket.view", "ticket.create"] },
  });
  for (const [index, name] of ["林晓", "林悦", "陈晨"].entries()) {
    const userId = `release112-user-${index}`;
    await prisma.user.upsert({
      where: { id: userId },
      update: { name, active: true },
      create: { id: userId, username: `release112-${index}`, name, roleId: role.id },
    });
    const ticketId = `release112-ticket-${index}`;
    const at = new Date(`2026-11-10T${12 - index}:00:00+08:00`);
    const data = {
      source: "manual",
      kindId: kind.id,
      creatorId: userId,
      assigneeId: userId,
      status: "processing",
      createdAt: at,
      updatedAt: at,
      slaAnchorAt: at,
      deletedAt: null,
    };
    await prisma.ticket.upsert({
      where: { id: ticketId },
      update: data,
      create: { id: ticketId, ...data },
    });
    const detail = {
      customerName: ["周女士（演示）", "王先生（演示）", "李女士（演示）"][index],
      customerRequest: ["演示：核实退费进度", "演示：补充保单资料", "演示：确认回访时间"][index],
      project: "更新日志演示",
    };
    await prisma.ticketComplaintDetail.upsert({
      where: { ticketId },
      update: detail,
      create: { ticketId, ...detail },
    });
    const messages = [
      {
        action: "external_note",
        operatorName: "渠道客服",
        remark: "客户希望确认退费进度，请协助核实。",
      },
      {
        action: "comment",
        operatorName: name,
        remark: "已联系客户核对申请信息，正在确认处理进度。",
      },
      { action: "internal_note", operatorName: name, remark: "已核实退费进度，明日上午回访客户。" },
    ];
    for (const [messageIndex, message] of messages.entries()) {
      const id = `release112-message-${index}-${messageIndex}`;
      const log = {
        ticketId,
        operatorId: userId,
        ...message,
        internalOnly: message.action === "internal_note",
        at: new Date(at.getTime() + messageIndex * 600_000),
      };
      await prisma.processLog.upsert({ where: { id }, update: log, create: { id, ...log } });
    }
  }
} finally {
  await prisma.$disconnect();
}
