import { createHash } from "node:crypto";
import { prisma } from "../../apps/api/src/db.ts";

const hash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });

const keys = [
  {
    id: "clchangelogapikey01",
    name: "运营周报拉数",
    token: "sk_changelog_demo_ops_weekly_0001",
    createdAt: new Date("2026-09-02T10:20:00+08:00"),
    lastUsedAt: new Date("2026-09-04T08:30:00+08:00"),
    expiresAt: null,
  },
  {
    id: "clchangelogapikey02",
    name: "管理看板试点",
    token: "sk_changelog_demo_mgmt_pilot_0002",
    createdAt: new Date("2026-09-03T16:05:00+08:00"),
    lastUsedAt: null,
    expiresAt: new Date("2026-12-31T23:59:59+08:00"),
  },
];

for (const key of keys) {
  await prisma.apiKey.upsert({
    where: { id: key.id },
    update: {},
    create: {
      id: key.id,
      name: key.name,
      keyHash: hash(key.token),
      keyPreview: key.token.slice(-8),
      userId: admin.id,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      status: "active",
    },
  });
}

await prisma.$disconnect();
