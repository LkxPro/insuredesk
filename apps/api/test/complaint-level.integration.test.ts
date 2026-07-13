import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPLAINT_LEVELS, DEFAULT_SLA_POLICIES } from "@insuredesk/shared";
import type { ComplaintLevel, PrismaClient } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Issue #48 acceptance tests: ComplaintLevel directory seeded with four
 * defaults, each embedding its SLAPolicy; tickets double-write complaintLevelId
 * + appliedSlaPolicy snapshot + dueAt + deadlineWarningAt; all relationships
 * and JSON data work in real PostgreSQL.
 */
describe("ComplaintLevel directory (issue #48, Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = container.getConnectionUri();

    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    process.env.DATABASE_URL = databaseUrl;

    const [{ prisma: appPrisma }, seedData] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
    ]);
    prisma = appPrisma;

    await seedData.seedPresetRolesAndUsers(prisma);
    await seedData.seedSlaPolicies(prisma);
    await seedData.seedComplaintLevels(prisma);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it("seeds four default ComplaintLevels with embedded policies", async () => {
    const levels = await prisma.complaintLevel.findMany({ orderBy: { sortOrder: "asc" } });
    expect(levels).toHaveLength(4);

    const names = levels.map((l) => l.name);
    expect(names).toEqual(["一般投诉", "高级投诉", "加急投诉", "特急投诉"]);

    // Each level is enabled by default
    expect(levels.every((l) => l.enabled)).toBe(true);

    // Each has sortOrder 1–4
    expect(levels.map((l) => l.sortOrder)).toEqual([1, 2, 3, 4]);

    // Policy revision starts at 1
    expect(levels.every((l) => l.policyRevision === 1)).toBe(true);
  });

  it("embeds canonical SLAPolicy in each level's policy field", async () => {
    const generalLevel = await prisma.complaintLevel.findUnique({
      where: { name: "一般投诉" },
    });
    expect(generalLevel).not.toBeNull();

    const policy = generalLevel!.policy as any;
    const defaults = DEFAULT_SLA_POLICIES.一般投诉;

    expect(policy.firstResponseMinutes).toBe(defaults.firstResponseMinutes);
    expect(policy.overdueHours).toBe(defaults.overdueHours);
    expect(policy.warningAdvanceMinutes).toBeNull(); // Default: no warning
    expect(policy.reminderRules).toHaveLength(defaults.reminderRules.length);
  });

  it("enforces unique name constraint", async () => {
    await expect(
      prisma.complaintLevel.create({
        data: {
          name: "一般投诉",
          sortOrder: 99,
          policy: {},
        },
      }),
    ).rejects.toThrow();
  });

  it("allows ComplaintLevel relation to tickets (FK exists)", async () => {
    const level = await prisma.complaintLevel.findUnique({ where: { name: "加急投诉" } });
    expect(level).not.toBeNull();

    // Create a test ticket with the new fields
    const ticket = await prisma.ticket.create({
      data: {
        source: "manual",
        status: "unassigned",
        complaintLevelId: level!.id,
        complaintLevel: "加急投诉", // Legacy field
        appliedSlaPolicy: {
          schemaVersion: 1,
          policyRevision: level!.policyRevision,
          policy: level!.policy,
        },
        dueAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        deadlineWarningAt: null,
      },
    });

    expect(ticket.complaintLevelId).toBe(level!.id);
    expect(ticket.appliedSlaPolicy).not.toBeNull();
    expect((ticket.appliedSlaPolicy as any).schemaVersion).toBe(1);
    expect((ticket.appliedSlaPolicy as any).policyRevision).toBe(1);
  });

  it("allows deadlineWarningAt to be set and queried", async () => {
    const level = await prisma.complaintLevel.findUnique({ where: { name: "一般投诉" } });
    const now = new Date();
    const dueAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const warningAt = new Date(dueAt.getTime() - 2 * 60 * 60 * 1000);

    const ticket = await prisma.ticket.create({
      data: {
        source: "manual",
        status: "unassigned",
        complaintLevelId: level!.id,
        appliedSlaPolicy: {
          schemaVersion: 1,
          policyRevision: 1,
          policy: level!.policy,
        },
        dueAt,
        deadlineWarningAt: warningAt,
      },
    });

    expect(ticket.deadlineWarningAt).toEqual(warningAt);

    // Query by deadlineWarningAt (index exists)
    const pending = await prisma.ticket.findMany({
      where: {
        deadlineWarningAt: { lte: new Date() },
      },
    });
    // Should not include the future-warning ticket
    expect(pending.every((t) => t.id !== ticket.id)).toBe(true);
  });
});
