import { randomUUID } from "node:crypto";
import {
  openApiErrorBodySchema,
  PRIORITY_LABELS,
  PROCESS_LOG_ACTION_LABELS,
  TICKET_SOURCE_LABELS,
  TICKET_STATUS_LABELS,
} from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedExternalUserRole } from "../prisma/seed-data.ts";
import { parseEnv } from "../src/env.ts";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { openApiMetaResponseSchema } from "../src/routes/open-api/meta.route.ts";
import { buildServer } from "../src/server.ts";
import { hashApiKey } from "../src/services/api-key.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("GET /api/v1/meta (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let app: FastifyInstance;

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "channels", "categories", "slaPolicies"],
    });
    prisma = harness.prisma;
    seeded = harness.seeded;
    app = buildServer(
      parseEnv({
        DATABASE_URL: harness.databaseUrl,
        SESSION_SECRET: "insuredesk-open-api-meta-secret-0123456789abc",
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        OPEN_API_ENABLED: "true",
      }),
    );
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await harness?.stop();
  });

  let seq = 0;
  async function issueKey(userId: string, overrides: Record<string, unknown> = {}) {
    const token = `sk_meta-${randomUUID()}`;
    await prisma.apiKey.create({
      data: {
        name: `open-api-meta-${++seq}`,
        keyHash: hashApiKey(token),
        keyPreview: token.slice(-8),
        userId,
        expiresAt: new Date(Date.now() + 86_400_000),
        ...overrides,
      },
    });
    return token;
  }

  function getMeta(token?: string) {
    return app.inject({
      method: "GET",
      url: "/api/v1/meta",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  describe("需 key（401/403 矩阵）", () => {
    it("无/无效 token → 401；external_role key → 403", async () => {
      const missing = await getMeta();
      expect(missing.statusCode).toBe(401);
      expect(() => openApiErrorBodySchema.parse(missing.json())).not.toThrow();
      expect(missing.json().error.code).toBe("unauthorized");

      expect((await getMeta("sk_not-in-db")).statusCode).toBe(401);

      const externalRole = await seedExternalUserRole(prisma);
      const external = await prisma.user.create({
        data: {
          username: `open-api-meta-external-${++seq}`,
          name: "外部",
          passwordHash: "dummy",
          roleId: externalRole.id,
          active: true,
        },
      });
      const forbidden = await getMeta(await issueKey(external.id));
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().error.code).toBe("forbidden");
    });

    it("任意内部有效 key → 200（无 ticket.export 也可读 meta）", async () => {
      const res = await getMeta(await issueKey(seeded.users.cs1.id));
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });

  describe("内容快照", () => {
    it("body 过响应 schema；spec/docs 指钉死", async () => {
      const res = await getMeta(await issueKey(seeded.users.admin.id));
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(() => openApiMetaResponseSchema.parse(body)).not.toThrow();
      expect(body.spec).toBe("/api/v1/openapi.json");
      expect(body.docs).toBe("/docs/analytics");
      expect(typeof body.version).toBe("string");
    });

    it("枚举值+中文 label 与 shared 标签表逐字一致", async () => {
      const res = await getMeta(await issueKey(seeded.users.admin.id));
      const { enums } = res.json();

      const pairs = (labels: Record<string, string>) =>
        Object.entries(labels).map(([value, label]) => ({ value, label }));

      expect(enums["ticket.displayStatus"]).toEqual(pairs(TICKET_STATUS_LABELS));
      expect(enums["ticket.source"]).toEqual(pairs(TICKET_SOURCE_LABELS));
      expect(enums["complaint.priority"]).toEqual(pairs(PRIORITY_LABELS));
      expect(enums["processLog.action"]).toEqual(pairs(PROCESS_LOG_ACTION_LABELS));

      expect(enums["ticket.status"]).toEqual([
        { value: "unassigned", label: "未分配" },
        { value: "assigned", label: "已分配" },
        { value: "processing", label: "处理中" },
        { value: "completed", label: "已完结" },
      ]);
      expect(enums["complaint.nuclearBodyStatus"]).toEqual([
        { value: "是", label: "是" },
        { value: "否", label: "否" },
        { value: "待核实", label: "待核实" },
      ]);
    });

    it("五条增量契约 caveat 逐字钉死；契约演化声明含「只加字段、不改类型、不删字段、/api/v2」", async () => {
      const res = await getMeta(await issueKey(seeded.users.admin.id));
      const { caveats } = res.json();

      expect(caveats.incremental).toHaveLength(5);
      const [overlap, tombstone, computed, dictionary, internalOnly] = caveats.incremental;
      expect(overlap).toContain("重叠窗口");
      expect(overlap).toContain("幂等");
      expect(tombstone).toContain("tombstone");
      expect(tombstone).toContain("deletedAt");
      expect(computed).toContain("displayStatus");
      expect(computed).toContain("不产生增量事件");
      expect(computed).toContain("重算");
      expect(dictionary).toContain("name");
      expect(dictionary).toContain("快照");
      expect(dictionary).toContain("/api/v1/meta");
      expect(internalOnly).toContain("internalOnly");

      expect(caveats.contractEvolution).toContain("只加字段");
      expect(caveats.contractEvolution).toContain("不改类型");
      expect(caveats.contractEvolution).toContain("不删字段");
      expect(caveats.contractEvolution).toContain("/api/v2");
    });

    it("字典目录快照：七类目录行随库读出（id/name/active，slaPolicies 带 kindId，ticketKinds 带 key）", async () => {
      const res = await getMeta(await issueKey(seeded.users.admin.id));
      expect(res.statusCode).toBe(200);
      const { dictionaries } = res.json();

      const [kinds, channels, categories, slaPolicies, completionStatuses, ufc, frc] =
        await Promise.all([
          prisma.ticketKind.findMany({ orderBy: [{ displayOrder: "asc" }, { id: "asc" }] }),
          prisma.channel.findMany({ orderBy: [{ displayOrder: "asc" }, { id: "asc" }] }),
          prisma.ticketCategory.findMany({ orderBy: [{ displayOrder: "asc" }, { id: "asc" }] }),
          prisma.slaPolicy.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
          prisma.completionStatus.findMany({ orderBy: [{ displayOrder: "asc" }, { id: "asc" }] }),
          prisma.userFeedbackChannel.findMany({
            orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
          }),
          prisma.feedbackReceiveChannel.findMany({
            orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
          }),
        ]);

      expect(dictionaries.ticketKinds).toEqual(
        kinds.map(({ id, key, name, active }) => ({ id, key, name, active })),
      );
      expect(dictionaries.channels).toEqual(
        channels.map(({ id, name, active }) => ({ id, name, active })),
      );
      expect(dictionaries.categories).toEqual(
        categories.map(({ id, name, active }) => ({ id, name, active })),
      );
      expect(dictionaries.slaPolicies).toEqual(
        slaPolicies.map(({ id, name, active, kindId }) => ({ id, name, active, kindId })),
      );
      expect(dictionaries.completionStatuses).toEqual(
        completionStatuses.map(({ id, name, active }) => ({ id, name, active })),
      );
      expect(dictionaries.userFeedbackChannels).toEqual(
        ufc.map(({ id, name, active }) => ({ id, name, active })),
      );
      expect(dictionaries.feedbackReceiveChannels).toEqual(
        frc.map(({ id, name, active }) => ({ id, name, active })),
      );
      expect(dictionaries.channels.length).toBeGreaterThan(0);
      expect(dictionaries.slaPolicies.length).toBeGreaterThan(0);
    });
  });
});
