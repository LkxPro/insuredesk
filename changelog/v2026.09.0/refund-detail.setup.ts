import { TicketKindKey, TicketStatus } from "@insuredesk/shared";
import { prisma } from "../../apps/api/src/db.ts";
import { REFUND_PUSH_PLATFORM } from "../../packages/shared/src/refund-push.ts";
import { requireTicketKindId } from "../../apps/api/src/services/ticket-kind.service.ts";
import { stampFromPolicy } from "../../apps/api/src/services/ticket.service.ts";

const REFUND_TICKET_ID = "clchangelogrefund0001";

const anchor = new Date("2026-08-28T10:30:00+08:00");

const existing = await prisma.ticket.findUnique({ where: { id: REFUND_TICKET_ID } });
if (!existing) {
  const kindId = await requireTicketKindId(prisma, TicketKindKey.RefundException);
  const policy = await prisma.slaPolicy.findFirst({
    where: { kindId, active: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const completionStatus = await prisma.completionStatus.findFirst({
    where: { active: true },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
  });

  const ticket = await prisma.ticket.create({
    data: {
      id: REFUND_TICKET_ID,
      source: REFUND_PUSH_PLATFORM,
      kindId,
      createdAt: anchor,
      slaAnchorAt: anchor,
      status: TicketStatus.Completed,
      completionTime: new Date("2026-08-29T16:45:00+08:00"),
      completionStatusId: completionStatus?.id ?? null,
      ...stampFromPolicy(policy, anchor),
    },
  });

  await prisma.ticketRefundDetail.create({
    data: {
      ticketId: ticket.id,
      platform: REFUND_PUSH_PLATFORM,
      endorNo: "END20260828000001",
      sysOrderId: "SYS20260827008921",
      workOrderType: "退费异常",
      expectedAmount: "1280.00",
      refundCreateTime: anchor,
      refundTrades: [
        { tradeNo: "1", payNo: "PAY20260801123456", expectedAmount: "640.00" },
        { tradeNo: "2", payNo: "PAY20260815123457", expectedAmount: "640.00" },
      ],
      holderName: "张建国",
      holderPhone: "13812345678",
      companyName: "东方大地保险",
      productName: "安心百万医疗险",
      policyNo: "P20260801099876",
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
      compensationAmount: "200.00",
    },
  });

  await prisma.callbackDelivery.create({
    data: {
      ticketId: ticket.id,
      status: "delivered",
      sysOrderId: "SYS20260827008921",
      endorNo: "END20260828000001",
      workOrderNumber: ticket.workOrderNumber,
      actualAmount: "1280.00",
      compensationAmount: "200.00",
      operator: "admin",
      attempts: 1,
      firstAttemptAt: new Date("2026-08-29T16:45:05+08:00"),
      deliveredAt: new Date("2026-08-29T16:45:06+08:00"),
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
