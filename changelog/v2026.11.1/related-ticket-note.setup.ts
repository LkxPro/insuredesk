import { DEMO_PASSWORD, seedTicketKinds } from "../../apps/api/prisma/seed-data.ts";
import { prisma } from "../../apps/api/src/db.ts";
import { hashPassword } from "../../apps/api/src/services/auth.service.ts";

await seedTicketKinds(prisma);
const kind = await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } });
const role = await prisma.role.upsert({
  where: { id: "release-111-entry-role" },
  update: { permissions: ["ticket.view", "ticket.create", "ticket.relate_all"] },
  create: {
    id: "release-111-entry-role",
    name: "关联录入客服",
    permissions: ["ticket.view", "ticket.create", "ticket.relate_all"],
  },
});
const passwordHash = await hashPassword(DEMO_PASSWORD);
for (const [id, username, name] of [
  ["release-111-entry", "release-entry", "林客服"],
  ["release-111-owner", "release-owner", "张客服"],
]) {
  await prisma.user.upsert({
    where: { id },
    update: { name, roleId: role.id, passwordHash, active: true },
    create: { id, username, name, roleId: role.id, passwordHash },
  });
}
const ticketId = "release-111-related-ticket";
const createdAt = new Date("2026-11-09T02:00:00Z");
const ticket = {
  source: "manual",
  kindId: kind.id,
  status: "processing",
  creatorId: "release-111-owner",
  assigneeId: "release-111-owner",
  createdAt,
  slaAnchorAt: createdAt,
  assignedAt: new Date("2026-11-09T02:10:00Z"),
  contactCount: 1,
  nextContactTime: new Date("2026-11-10T02:00:00Z"),
  deletedAt: null,
};
await prisma.ticket.upsert({
  where: { id: ticketId },
  update: ticket,
  create: { id: ticketId, workOrderNumber: "WO900111", ...ticket },
});
const detail = {
  customerName: "陈女士",
  phone: "13800001111",
  policyNumbers: ["POL20261109001"],
  noPolicyNumber: false,
  project: "安心健康险",
  brokerageEntity: "服务中心",
  paymentChannel: "微信支付",
  customerRequest: "客户希望核实保费扣款记录，已补充缴费凭证。",
};
await prisma.ticketComplaintDetail.upsert({
  where: { ticketId },
  update: detail,
  create: { ticketId, ...detail },
});
for (const log of [
  {
    id: "release-111-create",
    action: "create",
    operatorId: "release-111-owner",
    operatorName: "张客服",
    at: createdAt,
    remark: "登记客户保费扣款咨询",
    internalOnly: false,
  },
  {
    id: "release-111-followup",
    action: "comment",
    operatorId: "release-111-owner",
    operatorName: "张客服",
    at: new Date("2026-11-09T02:30:00Z"),
    remark: "已联系客户核实扣款时间，等待补充缴费凭证。",
    internalOnly: false,
  },
  {
    id: "release-111-note",
    action: "internal_note",
    operatorId: "release-111-entry",
    operatorName: "林客服",
    at: new Date("2026-11-09T06:00:00Z"),
    remark: "客户再次来电，已补充缴费凭证，请原负责人继续核实。",
    internalOnly: true,
  },
]) {
  await prisma.processLog.upsert({
    where: { id: log.id },
    update: { ticketId, ...log },
    create: { ticketId, ...log },
  });
}
await prisma.$disconnect();
