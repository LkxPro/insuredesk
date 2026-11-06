import { existsSync } from "node:fs";
import { prisma } from "../src/db.ts";
import { removeStoredHuifuAttachments } from "../src/services/huifu-attachment-cleanup.service.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
try {
  console.log(
    JSON.stringify(await removeStoredHuifuAttachments(prisma, process.argv.includes("--apply"))),
  );
} finally {
  await prisma.$disconnect();
}
