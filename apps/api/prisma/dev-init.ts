import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Windows 上 pnpm 只有 .cmd：裸名 ENOENT，指名 .cmd 又被 Node 安全闸门
// EINVAL，只能 shell:true 走 cmd.exe 解析。
const shell = process.platform === "win32";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// A fresh Postgres volume may still be finishing initdb after the container
// reports healthy, so retry instead of failing the very first `make dev`.
const MIGRATE_ATTEMPTS = 15;
for (let attempt = 1; ; attempt++) {
  try {
    // prisma 的进度输出（Datasource、migrations found 等）是噪音；失败时才
    // 把 stderr 完整放出。
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "pipe", shell });
    break;
  } catch (error) {
    if (attempt === MIGRATE_ATTEMPTS) {
      process.stderr.write(String((error as { stderr?: Buffer }).stderr ?? error));
      console.error("❌ migrate deploy failed — is PostgreSQL up? (make dev)");
      process.exit(1);
    }
    console.log(`⏳ database not reachable yet, retrying (${attempt}/${MIGRATE_ATTEMPTS})...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// `migrate deploy` (unlike `migrate dev`) never generates the client, so a
// fresh clone would otherwise start with the ungenerated stub.
try {
  execFileSync("pnpm", ["exec", "prisma", "generate"], { stdio: "pipe", shell });
} catch (error) {
  const failed = error as { stdout?: Buffer; stderr?: Buffer };
  if (failed.stdout) process.stderr.write(failed.stdout);
  if (failed.stderr) process.stderr.write(failed.stderr);
  process.exit(1);
}

// Imported only after `prisma generate` — a static top-level import would
// load the stub that throws on instantiation.
const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../src/generated/prisma/client.ts");
const {
  seedChannels,
  seedRefundDefaultSlaPolicy,
  seedShiftTypes,
  seedTicketCategories,
  seedTicketKinds,
} = await import("./seed-data.ts");
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL ?? "") });
await seedTicketKinds(prisma);
console.log("✓ Ticket kinds: 2 (inserted if missing)");
await seedRefundDefaultSlaPolicy(prisma);
console.log("✓ Refund default SLA policy (inserted if missing)");
await seedShiftTypes(prisma);
console.log("✓ Shift types: 4 (created if missing)");
await seedTicketCategories(prisma);
console.log("✓ Ticket categories: 17 (first initialization only)");
await seedChannels(prisma);
console.log("✓ Channels: 4 (first initialization only)");
const userCount = await prisma.user.count();
await prisma.$disconnect();

if (userCount === 0) {
  execFileSync("pnpm", ["exec", "node", "prisma/seed.ts"], { stdio: "inherit", shell });
} else {
  console.log(`✓ ${userCount} users present — skipping seed`);
}
