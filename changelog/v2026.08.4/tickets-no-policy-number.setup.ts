import { prisma } from "../../apps/api/src/db.ts";

const recent = await prisma.ticket.findMany({
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: 2,
  select: { id: true },
});
await prisma.ticket.updateMany({
  where: { id: { in: recent.map((t) => t.id) } },
  data: { policyNumbers: [], noPolicyNumber: true },
});
await prisma.$disconnect();
