import { DEFAULT_SLA_POLICIES, TicketKindKey } from "@insuredesk/shared";
import { prisma } from "../../apps/api/src/db.ts";
import {
  DEFAULT_SLA_POLICY_DESCRIPTIONS,
  seedRefundDefaultSlaPolicy,
} from "../../apps/api/prisma/seed-data.ts";
import { requireTicketKindId } from "../../apps/api/src/services/ticket-kind.service.ts";

const kindId = await requireTicketKindId(prisma, TicketKindKey.Complaint);
for (const [index, defaults] of DEFAULT_SLA_POLICIES.entries()) {
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
      kindId,
    },
  });
}
await seedRefundDefaultSlaPolicy(prisma);
await prisma.$disconnect();
