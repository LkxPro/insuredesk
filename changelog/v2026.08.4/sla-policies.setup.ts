import { prisma } from "../../apps/api/src/db.ts";

await prisma.slaPolicy.updateMany({
  where: { name: "特急投诉", active: true },
  data: { active: false },
});
await prisma.$disconnect();
