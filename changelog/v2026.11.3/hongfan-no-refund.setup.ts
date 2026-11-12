import {
  NO_REFUND_COMPLETION_STATUS_ID,
  REFUND_PUSH_PLATFORM,
  TicketKindKey,
} from "@insuredesk/shared";
import { seedFactoryRolesAndDemoUsers, seedTicketKinds } from "../../apps/api/prisma/seed-data.ts";
import { prisma } from "../../apps/api/src/db.ts";

const ticketId = "release113-hongfan-no-refund";
const at = new Date("2026-11-12T10:00:00+08:00");

try {
  await seedTicketKinds(prisma);
  const { users } = await seedFactoryRolesAndDemoUsers(prisma);
  const kind = await prisma.ticketKind.findUniqueOrThrow({
    where: { key: TicketKindKey.RefundException },
  });
  await prisma.completionStatus.upsert({
    where: { id: NO_REFUND_COMPLETION_STATUS_ID },
    update: { name: "未退费", active: true },
    create: { id: NO_REFUND_COMPLETION_STATUS_ID, name: "未退费", active: true },
  });
  const ticket = {
    source: REFUND_PUSH_PLATFORM,
    kindId: kind.id,
    status: "processing",
    assigneeId: users.cs1.id,
    assignedAt: at,
    createdAt: at,
    slaAnchorAt: at,
    deletedAt: null,
    completionTime: null,
    completionStatusId: null,
  };
  await prisma.ticket.upsert({
    where: { id: ticketId },
    update: ticket,
    create: { id: ticketId, ...ticket },
  });
  const detail = {
    platform: REFUND_PUSH_PLATFORM,
    endorNo: "DEMO-REFUND-20261112",
    sysOrderId: "DEMO-ORDER-20261112",
    workOrderType: "退费异常",
    expectedAmount: "128.00",
    refundCreateTime: at,
    refundTrades: [{ tradeNo: "1", payNo: "DEMO-PAY-20261112", expectedAmount: "128.00" }],
    holderName: "周女士（演示）",
    holderPhone: "13800000000",
    policyNo: "DEMO-POLICY-20261112",
    productName: "医疗保险（演示）",
    failureReason: "客户撤回退费申请",
  };
  await prisma.ticketRefundDetail.upsert({
    where: { ticketId },
    update: detail,
    create: { ticketId, ...detail },
  });
  const log = {
    ticketId,
    operatorId: users.cs1.id,
    operatorName: users.cs1.name,
    action: "comment",
    remark: "客户确认保留保障，撤回退费申请，本次按未退费结案。",
    at,
  };
  await prisma.processLog.upsert({
    where: { id: "release113-hongfan-followup" },
    update: log,
    create: { id: "release113-hongfan-followup", ...log },
  });
} finally {
  await prisma.$disconnect();
}
