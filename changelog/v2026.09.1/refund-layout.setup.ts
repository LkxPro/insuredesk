import { TicketKindKey, TicketStatus } from "@insuredesk/shared";
import { prisma } from "../../apps/api/src/db.ts";
import { stampFromPolicy } from "../../apps/api/src/services/ticket.service.ts";
import { requireTicketKindId } from "../../apps/api/src/services/ticket-kind.service.ts";
import { REFUND_PUSH_PLATFORM } from "../../packages/shared/src/refund-push.ts";

const TICKET_ID = "clchangelogrefund0003";

const existing = await prisma.ticket.findUnique({ where: { id: TICKET_ID } });
if (!existing) {
  const anchor = new Date("2026-09-03T09:15:00+08:00");
  const kindId = await requireTicketKindId(prisma, TicketKindKey.RefundException);
  const policy = await prisma.slaPolicy.findFirst({
    where: { kindId, active: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });

  const ticket = await prisma.ticket.create({
    data: {
      id: TICKET_ID,
      source: REFUND_PUSH_PLATFORM,
      kindId,
      createdAt: anchor,
      slaAnchorAt: anchor,
      status: TicketStatus.Processing,
      assigneeId: admin?.id ?? null,
      assignedAt: new Date("2026-09-03T09:40:00+08:00"),
      contactPhone: "13755556666",
      ...stampFromPolicy(policy, anchor),
    },
  });

  await prisma.ticketRefundDetail.create({
    data: {
      ticketId: ticket.id,
      platform: REFUND_PUSH_PLATFORM,
      endorNo: "END20260903000003",
      sysOrderId: "SYS20260902009117",
      workOrderType: "退费异常",
      expectedAmount: "2350.00",
      refundCreateTime: anchor,
      refundTrades: [
        { tradeNo: "1", payNo: "PAY20260701556677", expectedAmount: "1180.00" },
        { tradeNo: "2", payNo: "PAY20260801556678", expectedAmount: "1170.00" },
      ],
      holderName: "王秀兰",
      holderPhone: "13677778888",
      companyName: "东方大地保险",
      productName: "安康住院医疗险",
      policyNo: "P20260701223445",
      failureReason: "重复扣费",
      pushedFields: [
        "endorNo",
        "sysOrderId",
        "workOrderType",
        "expectedAmount",
        "refundCreateTime",
        "refundTrade",
        "holderName",
        "holderPhone",
        "companyName",
        "productName",
        "policyNo",
        "failureReason",
      ],
      compensationAmount: "300.00",
    },
  });

  await prisma.processLog.create({
    data: {
      ticketId: ticket.id,
      operatorId: REFUND_PUSH_PLATFORM,
      operatorName: "骏伯保险平台",
      action: "create",
      remark: "推送创建",
      at: anchor,
    },
  });
}

await prisma.$disconnect();
