import { EXTERNAL_ROLE_PERMISSIONS, TicketKindKey } from "@insuredesk/shared";
import { prisma } from "../../apps/api/src/db.ts";
import { hashPassword } from "../../apps/api/src/services/auth.service.ts";

export async function ensureReleaseDataset(): Promise<void> {
  const externalRole = await prisma.role.upsert({
    where: { name: "发版演示外部角色" },
    create: { name: "发版演示外部角色", permissions: [...EXTERNAL_ROLE_PERMISSIONS] },
    update: { permissions: [...EXTERNAL_ROLE_PERMISSIONS], system: false },
  });
  const internalRole = await prisma.role.upsert({
    where: { name: "发版演示客服角色" },
    create: { name: "发版演示客服角色", permissions: ["ticket.view", "ticket.process"] },
    update: { permissions: ["ticket.view", "ticket.process"], system: false },
  });
  const passwordHash = await hashPassword("password123");
  const users = [];
  for (const [index, name] of ["合作方演示", "客服演示", "历史客服"].entries()) {
    const data = {
      name,
      passwordHash,
      roleId: index === 0 ? externalRole.id : internalRole.id,
      active: index !== 2,
    };
    users.push(
      await prisma.user.upsert({
        where: { username: `changelog102-${index}` },
        create: { id: `clchangelog102user${index}`, username: `changelog102-${index}`, ...data },
        update: data,
      }),
    );
  }
  const kind = await prisma.ticketKind.upsert({
    where: { key: TicketKindKey.Complaint },
    create: { key: TicketKindKey.Complaint, name: "投诉单", active: true },
    update: {},
  });
  for (let index = 0; index < 6; index++) {
    const external = index < 3;
    const creator = users[external ? 0 : index - 3];
    if (!creator) throw new Error("Missing release demo user");
    const anchor = new Date(Date.now() - (index + 1) * 30 * 60 * 1000);
    const detail = {
      customerName: `发版演示·${["王女士", "王女士", "王女士", "陈先生", "李女士", "张先生"][index]}`,
      phone: external ? "13800001028" : `1390000102${index}`,
      policyNumbers: external ? ["RELEASE102POLICY"] : [`RELEASE102POLICY${index}`],
      feedbackTime: anchor,
      customerRequest: "发版演示：核实保单扣费并回访客户",
    };
    const data = {
      source: external ? "external_channel" : "manual",
      kindId: kind.id,
      creatorId: creator.id,
      status: index % 2 === 0 ? "processing" : "assigned",
      submissionText: "发版演示：客户反映保单续费扣款，希望核实扣费明细并协助处理。",
      createdAt: anchor,
      slaAnchorAt: anchor,
      deletedAt: null,
    };
    const ticket = await prisma.ticket.upsert({
      where: { id: `clchangelog102${external ? "ext" : "int"}${external ? index : index - 3}` },
      create: {
        id: `clchangelog102${external ? "ext" : "int"}${external ? index : index - 3}`,
        ...data,
        complaintDetail: { create: detail },
      },
      update: { ...data, complaintDetail: { upsert: { create: detail, update: detail } } },
    });
    if (external) {
      const log = {
        ticketId: ticket.id,
        action: "comment",
        operatorId: creator.id,
        operatorName: "客服演示",
        internalOnly: false,
        remark: [
          "已核实扣费记录，正在联系保司确认。",
          "已联系客户补充保单信息。",
          "已向客户说明处理进度，等待回访。",
        ][index],
        at: new Date(anchor.getTime() + 15 * 60 * 1000),
      };
      await prisma.processLog.upsert({
        where: { id: `clchangelog102log${index}` },
        create: { id: `clchangelog102log${index}`, ...log },
        update: log,
      });
    }
  }
  await prisma.$disconnect();
}
