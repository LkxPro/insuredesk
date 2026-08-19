import { prisma } from "../../apps/api/src/db.ts";

await prisma.complaintReceiveChannel.upsert({
  where: { name: "（微信）保险-东方大地与连连支付客诉处理" },
  update: {},
  create: { name: "（微信）保险-东方大地与连连支付客诉处理" },
});
await prisma.$disconnect();
