import { TicketKindKey, TicketStatus } from "@insuredesk/shared";
import { prisma } from "../../apps/api/src/db.ts";
import { stampFromPolicy } from "../../apps/api/src/services/ticket.service.ts";
import { requireTicketKindId } from "../../apps/api/src/services/ticket-kind.service.ts";
import { REFUND_PUSH_PLATFORM } from "../../packages/shared/src/refund-push.ts";

const TICKET_ID = "clchangelogrefund0002";

const existing = await prisma.ticket.findUnique({ where: { id: TICKET_ID } });
if (!existing) {
  const anchor = new Date("2026-09-01T14:05:00+08:00");
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
      assignedAt: new Date("2026-09-01T14:20:00+08:00"),
      ...stampFromPolicy(policy, anchor),
    },
  });

  await prisma.ticketRefundDetail.create({
    data: {
      ticketId: ticket.id,
      platform: REFUND_PUSH_PLATFORM,
      endorNo: "END20260901000002",
      sysOrderId: "SYS20260831007654",
      workOrderType: "退费异常",
      expectedAmount: "560.00",
      refundCreateTime: anchor,
      refundTrades: [{ tradeNo: "1", payNo: "PAY20260820876543", expectedAmount: "560.00" }],
      holderName: "李晓梅",
      holderPhone: "13998765432",
      companyName: "东方大地保险",
      productName: "无忧意外险",
      policyNo: "P20260820112233",
      failureReason: "退保差额未到账",
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
