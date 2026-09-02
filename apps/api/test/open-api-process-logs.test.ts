import { randomUUID } from "node:crypto";
import {
  encodeCursor,
  openApiErrorBodySchema,
  openApiProcessLogListResponseSchema,
  openApiProcessLogSchema,
} from "@insuredesk/shared";
import { PrismaPg } from "@prisma/adapter-pg";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedExternalUserRole } from "../prisma/seed-data.ts";
import { parseEnv } from "../src/env.ts";
import {
  type PrismaClient,
  PrismaClient as ProbePrismaClient,
  type User,
} from "../src/generated/prisma/client.ts";
import { buildServer } from "../src/server.ts";
import { hashApiKey } from "../src/services/api-key.service.ts";
import { listOpenApiProcessLogs } from "../src/services/open-api-process-log.service.ts";
import {
  createComplaintTicket,
  type IntegrationHarness,
  startIntegrationHarness,
} from "./integration-harness.ts";

describe("GET /api/v1/process-logs (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let app: FastifyInstance;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    prisma = harness.prisma;
    seeded = harness.seeded;
    app = buildServer(
      parseEnv({
        DATABASE_URL: harness.databaseUrl,
        SESSION_SECRET: "insuredesk-open-api-logs-secret-0123456789ab",
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

  beforeEach(async () => {
    await prisma.ticket.deleteMany();
  });

  let seq = 0;
  async function issueKey(userId: string, overrides: Record<string, unknown> = {}) {
    const token = `sk_live_logs-${randomUUID()}`;
    await prisma.apiKey.create({
      data: {
        name: `open-api-logs-${++seq}`,
        keyHash: hashApiKey(token),
        userId,
        expiresAt: new Date(Date.now() + 86_400_000),
        ...overrides,
      },
    });
    return token;
  }

  function getLogs(token: string, query = "") {
    return app.inject({
      method: "GET",
      url: `/api/v1/process-logs${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function scopedUserWith(permissions: string[]): Promise<User> {
    const role = await prisma.role.create({
      data: { name: `开放API日志角色-${++seq}`, permissions },
    });
    return prisma.user.create({
      data: {
        username: `open-api-logs-user-${seq}`,
        name: `日志用户${seq}`,
        passwordHash: "dummy",
        roleId: role.id,
        active: true,
      },
    });
  }

  async function seedLog(
    ticketId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const row = await prisma.processLog.create({
      data: {
        ticketId,
        operatorId: seeded.users.cs1.id,
        operatorName: "张客服",
        action: "comment",
        remark: "跟进",
        at: new Date("2026-08-01T00:00:00Z"),
        ...overrides,
      },
    });
    return row.id;
  }

  describe("门禁", () => {
    it("无 ticket.export 权限的 key → 403 forbidden 信封", async () => {
      const token = await issueKey(seeded.users.cs1.id);
      const res = await getLogs(token);
      expect(res.statusCode).toBe(403);
      expect(() => openApiErrorBodySchema.parse(res.json())).not.toThrow();
      expect(res.json().error.code).toBe("forbidden");
    });

    it("external_role key → 403 forbidden 信封", async () => {
      const externalRole = await seedExternalUserRole(prisma);
      const external = await prisma.user.create({
        data: {
          username: `open-api-logs-external-${++seq}`,
          name: "外部",
          passwordHash: "dummy",
          roleId: externalRole.id,
          active: true,
        },
      });
      const token = await issueKey(external.id);
      const res = await getLogs(token);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("forbidden");
    });

    it("无 ticket.view_all → 只见 join 后 OR[assigneeId, creatorId] 工单的日志；view_all+export → 全量", async () => {
      const scoped = await scopedUserWith(["ticket.export"]);
      const mineAssigned = await createComplaintTicket(prisma, { assigneeId: scoped.id });
      const mineCreated = await createComplaintTicket(prisma, { creatorId: scoped.id });
      const others = await createComplaintTicket(prisma, {
        assigneeId: seeded.users.cs1.id,
        creatorId: seeded.users.manager.id,
      });
      const logMineAssigned = await seedLog(mineAssigned.id);
      const logMineCreated = await seedLog(mineCreated.id);
      await seedLog(others.id);

      const scopedRes = await getLogs(await issueKey(scoped.id));
      expect(scopedRes.statusCode).toBe(200);
      const scopedIds = scopedRes
        .json()
        .data.map((row: { id: string }) => row.id)
        .sort();
      expect(scopedIds).toEqual([logMineAssigned, logMineCreated].sort());

      const adminRes = await getLogs(await issueKey(seeded.users.admin.id));
      expect(adminRes.statusCode).toBe(200);
      expect(adminRes.json().data).toHaveLength(3);
    });

    it("ticketId 过滤与数据范围叠加：他人工单显式按 id 查也为空", async () => {
      const scoped = await scopedUserWith(["ticket.export"]);
      const others = await createComplaintTicket(prisma, {
        assigneeId: seeded.users.cs1.id,
      });
      await seedLog(others.id);

      const res = await getLogs(await issueKey(scoped.id), `?ticketId=${others.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([]);
    });
  });

  describe("ad-hoc 分页", () => {
    it("缺省 (at desc, id desc) 翻页到底：不重不漏，末页 hasMore=false 且 cursor/url 为 null", async () => {
      const ticket = await createComplaintTicket(prisma);
      const l1 = await seedLog(ticket.id, { at: new Date("2026-08-01T01:00:00Z") });
      const l2 = await seedLog(ticket.id, { at: new Date("2026-08-01T02:00:00Z") });
      const l3 = await seedLog(ticket.id, { at: new Date("2026-08-01T03:00:00Z") });
      const token = await issueKey(seeded.users.admin.id);

      const page1 = await getLogs(token, "?limit=2");
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json();
      expect(() => openApiProcessLogListResponseSchema.parse(body1)).not.toThrow();
      expect(body1.data.map((row: { id: string }) => row.id)).toEqual([l3, l2]);
      expect(body1.hasMore).toBe(true);
      expect(typeof body1.nextCursor).toBe("string");
      expect(body1.nextUrl.startsWith("/api/v1/process-logs?")).toBe(true);
      expect(body1.nextUrl).toContain("cursor=");

      const followed = await app.inject({
        method: "GET",
        url: body1.nextUrl,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(followed.statusCode).toBe(200);
      const body2 = followed.json();
      expect(body2.data.map((row: { id: string }) => row.id)).toEqual([l1]);
      expect(body2.hasMore).toBe(false);
      expect(body2.nextCursor).toBeNull();
      expect(body2.nextUrl).toBeNull();
    });

    it("空结果页：data=[]、hasMore=false、nextCursor/nextUrl=null", async () => {
      const token = await issueKey(seeded.users.admin.id);
      const res = await getLogs(token);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        data: [],
        hasMore: false,
        nextCursor: null,
        nextUrl: null,
      });
    });

    it("limit 边界：0/201/非数字 → 400 invalid_params", async () => {
      const token = await issueKey(seeded.users.admin.id);
      for (const bad of ["?limit=0", "?limit=201", "?limit=abc"]) {
        const res = await getLogs(token, bad);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("invalid_params");
      }
    });

    it("行形状：id/ticketId/workOrderNumber/action/operator/from/to/remark/internalOnly/at", async () => {
      const ticket = await createComplaintTicket(prisma);
      await seedLog(ticket.id, {
        action: "status_change",
        from: "unassigned",
        to: "assigned",
        remark: "分配并处理",
        internalOnly: true,
        operatorName: null,
        at: new Date("2026-08-01T05:00:00Z"),
      });
      const res = await getLogs(await issueKey(seeded.users.admin.id));
      expect(res.statusCode).toBe(200);
      const row = res.json().data[0];
      expect(() => openApiProcessLogSchema.parse(row)).not.toThrow();
      expect(row).toMatchObject({
        ticketId: ticket.id,
        workOrderNumber: ticket.workOrderNumber,
        action: "status_change",
        operatorId: seeded.users.cs1.id,
        operatorName: null,
        from: "unassigned",
        to: "assigned",
        remark: "分配并处理",
        internalOnly: true,
        at: "2026-08-01T05:00:00.000Z",
      });
    });
  });

  describe("internalOnly 与软删父单", () => {
    it("internalOnly=true 行两模式照常流出（对齐内部导出口径）", async () => {
      const ticket = await createComplaintTicket(prisma);
      const internal = await seedLog(ticket.id, {
        internalOnly: true,
        at: new Date("2026-08-01T01:00:00Z"),
      });
      const visible = await seedLog(ticket.id, {
        internalOnly: false,
        at: new Date("2026-08-01T02:00:00Z"),
      });
      const token = await issueKey(seeded.users.admin.id);

      const adhoc = await getLogs(token);
      expect(
        adhoc
          .json()
          .data.map((row: { id: string }) => row.id)
          .sort(),
      ).toEqual([internal, visible].sort());

      const incremental = await getLogs(token, "?since=2026-07-01T00:00:00Z");
      expect(
        incremental
          .json()
          .data.map((row: { id: string }) => row.id)
          .sort(),
      ).toEqual([internal, visible].sort());
    });

    it("父单软删后 logs 两模式照常出现", async () => {
      const ticket = await createComplaintTicket(prisma);
      const logId = await seedLog(ticket.id, { at: new Date("2026-08-01T01:00:00Z") });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { deletedAt: new Date("2026-08-02T00:00:00Z") },
      });
      const token = await issueKey(seeded.users.admin.id);

      const adhoc = await getLogs(token);
      expect(adhoc.json().data.map((row: { id: string }) => row.id)).toEqual([logId]);

      const incremental = await getLogs(token, "?since=2026-07-01T00:00:00Z");
      expect(incremental.json().data.map((row: { id: string }) => row.id)).toEqual([logId]);
    });
  });

  describe("游标", () => {
    it("不可解码/形状非法的 cursor → 400 invalid_cursor", async () => {
      const token = await issueKey(seeded.users.admin.id);
      const garbage = await getLogs(token, "?cursor=%%%");
      expect(garbage.statusCode).toBe(400);
      expect(garbage.json().error.code).toBe("invalid_cursor");

      const wrongShape = await getLogs(
        token,
        `?cursor=${encodeURIComponent(encodeCursor({ hello: 1 }))}`,
      );
      expect(wrongShape.statusCode).toBe(400);
      expect(wrongShape.json().error.code).toBe("invalid_cursor");
    });

    it("模式混用：ad-hoc 游标带 since 再请求 → 400 invalid_cursor；反向同样 400", async () => {
      const ticket = await createComplaintTicket(prisma);
      for (let i = 1; i <= 2; i += 1) {
        await seedLog(ticket.id, { at: new Date(`2026-08-0${i}T00:00:00Z`) });
      }
      const token = await issueKey(seeded.users.admin.id);

      const adhocPage = await getLogs(token, "?limit=1");
      const adhocCursor = adhocPage.json().nextCursor;
      expect(adhocCursor).not.toBeNull();
      const mixedAdhoc = await getLogs(
        token,
        `?limit=1&since=2026-07-01T00:00:00Z&cursor=${encodeURIComponent(adhocCursor)}`,
      );
      expect(mixedAdhoc.statusCode).toBe(400);
      expect(mixedAdhoc.json().error.code).toBe("invalid_cursor");

      const incrPage = await getLogs(token, "?limit=1&since=2026-07-01T00:00:00Z");
      const incrCursor = incrPage.json().nextCursor;
      expect(incrCursor).not.toBeNull();
      const mixedIncr = await getLogs(token, `?limit=1&cursor=${encodeURIComponent(incrCursor)}`);
      expect(mixedIncr.statusCode).toBe(400);
      expect(mixedIncr.json().error.code).toBe("invalid_cursor");
    });

    it("筛选混用：换 ticketId 续翻 → 400 invalid_cursor；原样续翻 → 200", async () => {
      const t1 = await createComplaintTicket(prisma);
      const t2 = await createComplaintTicket(prisma);
      for (let i = 1; i <= 2; i += 1) {
        await seedLog(t1.id, { at: new Date(`2026-08-0${i}T00:00:00Z`) });
      }
      const token = await issueKey(seeded.users.admin.id);
      const page1 = await getLogs(token, `?limit=1&ticketId=${t1.id}`);
      const cursor = page1.json().nextCursor;
      expect(cursor).not.toBeNull();

      const changed = await getLogs(
        token,
        `?limit=1&ticketId=${t2.id}&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(changed.statusCode).toBe(400);
      expect(changed.json().error.code).toBe("invalid_cursor");

      const same = await getLogs(
        token,
        `?limit=1&ticketId=${t1.id}&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(same.statusCode).toBe(200);
    });
  });

  describe("增量模式 (since)", () => {
    it("(at asc, id asc) 翻页：沿 nextUrl 到底不重不漏", async () => {
      const ticket = await createComplaintTicket(prisma);
      const l1 = await seedLog(ticket.id, { at: new Date("2026-08-10T00:00:00Z") });
      const l2 = await seedLog(ticket.id, { at: new Date("2026-08-11T00:00:00Z") });
      const l3 = await seedLog(ticket.id, { at: new Date("2026-08-12T00:00:00Z") });
      const token = await issueKey(seeded.users.admin.id);

      const page1 = await getLogs(token, "?since=2026-08-01T00:00:00Z&limit=2");
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json();
      expect(() => openApiProcessLogListResponseSchema.parse(body1)).not.toThrow();
      expect(body1.data.map((row: { id: string }) => row.id)).toEqual([l1, l2]);
      expect(body1.hasMore).toBe(true);
      expect(body1.nextUrl).toContain("since=2026-08-01T00%3A00%3A00Z");

      const page2 = await app.inject({
        method: "GET",
        url: body1.nextUrl,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(page2.statusCode).toBe(200);
      const body2 = page2.json();
      expect(body2.data.map((row: { id: string }) => row.id)).toEqual([l3]);
      expect(body2.hasMore).toBe(false);
      expect(body2.nextCursor).toBeNull();
      expect(body2.nextUrl).toBeNull();
    });

    it("首页边界 inclusive：since 恰等于某行 at 时该行在列", async () => {
      const ticket = await createComplaintTicket(prisma);
      await seedLog(ticket.id, { at: new Date("2026-08-10T00:00:00Z") });
      const l2 = await seedLog(ticket.id, { at: new Date("2026-08-11T00:00:00Z") });
      const token = await issueKey(seeded.users.admin.id);
      const res = await getLogs(token, "?since=2026-08-11T00:00:00Z");
      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((row: { id: string }) => row.id)).toEqual([l2]);
    });

    it("续页边界 exclusive：同 at 并列行按 id 断开，上一页末行不重出", async () => {
      const ticket = await createComplaintTicket(prisma);
      const same = new Date("2026-08-10T00:00:00Z");
      const a = await seedLog(ticket.id, { at: same });
      const b = await seedLog(ticket.id, { at: same });
      const [first, second] = [a, b].sort();
      const token = await issueKey(seeded.users.admin.id);

      const page1 = await getLogs(token, "?since=2026-08-01T00:00:00Z&limit=1");
      expect(page1.json().data.map((row: { id: string }) => row.id)).toEqual([first]);
      const page2 = await app.inject({
        method: "GET",
        url: page1.json().nextUrl,
        headers: { authorization: `Bearer ${token}` },
      });
      const body2 = page2.json();
      expect(body2.data.map((row: { id: string }) => row.id)).toEqual([second]);
      expect(body2.hasMore).toBe(false);
    });

    it("ticketId 过滤：只出该工单日志，incremental 同语义", async () => {
      const t1 = await createComplaintTicket(prisma);
      const t2 = await createComplaintTicket(prisma);
      const keep = await seedLog(t1.id, { at: new Date("2026-08-01T01:00:00Z") });
      await seedLog(t2.id, { at: new Date("2026-08-01T02:00:00Z") });
      const token = await issueKey(seeded.users.admin.id);

      const adhoc = await getLogs(token, `?ticketId=${t1.id}`);
      expect(adhoc.json().data.map((row: { id: string }) => row.id)).toEqual([keep]);

      const incremental = await getLogs(token, `?ticketId=${t1.id}&since=2026-07-01T00:00:00Z`);
      expect(incremental.json().data.map((row: { id: string }) => row.id)).toEqual([keep]);
    });
  });

  describe("增量同步规模与查询计划", () => {
    const AMPLIFIED_ROWS = 600;

    async function seedAmplified(ticketId: string): Promise<void> {
      const base = new Date("2026-06-01T00:00:00Z").getTime();
      await prisma.processLog.createMany({
        data: Array.from({ length: AMPLIFIED_ROWS }, (_, i) => ({
          ticketId,
          operatorId: seeded.users.cs1.id,
          operatorName: "张客服",
          action: "comment",
          remark: `跟进 ${i}`,
          at: new Date(base + i * 1000),
        })),
      });
    }

    it("放大同步：600 行逐页不重不漏，序与库内 (at,id) 一致", async () => {
      const ticket = await createComplaintTicket(prisma);
      await seedAmplified(ticket.id);
      const token = await issueKey(seeded.users.admin.id);

      const encounterOrder: string[] = [];
      let url: string | null = "/api/v1/process-logs?since=2026-05-01T00:00:00Z&limit=200";
      let pages = 0;
      while (url !== null) {
        pages += 1;
        expect(pages).toBeLessThanOrEqual(6);
        const res: Awaited<ReturnType<typeof app.inject>> = await app.inject({
          method: "GET",
          url,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        for (const row of body.data) {
          encounterOrder.push(row.id);
        }
        if (body.hasMore) {
          expect(typeof body.nextCursor).toBe("string");
          expect(body.nextUrl.startsWith("/api/v1/process-logs?")).toBe(true);
          url = body.nextUrl;
        } else {
          expect(body.nextCursor).toBeNull();
          expect(body.nextUrl).toBeNull();
          url = null;
        }
      }

      const truth = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM process_logs ORDER BY at ASC, id ASC
      `;
      expect(encounterOrder).toEqual(truth.map((row) => row.id));
      expect(encounterOrder).toHaveLength(AMPLIFIED_ROWS);
    });

    it("EXPLAIN（SET enable_seqscan=off）：首页与游标页都走 process_logs(at,id) 索引", async () => {
      const ticket = await createComplaintTicket(prisma);
      await seedAmplified(ticket.id);
      await prisma.$executeRawUnsafe("ANALYZE process_logs");

      const captured: { text: string; params: string }[] = [];
      const probe = new ProbePrismaClient({
        adapter: new PrismaPg({ connectionString: harness.databaseUrl }),
        log: [{ emit: "event", level: "query" }],
      });
      probe.$on("query", (event) => {
        captured.push({ text: event.query, params: event.params });
      });

      const viewer = harness.authUserFor(seeded.users.admin, seeded.roles.admin);
      const statements: { text: string; params: string }[] = [];
      try {
        const firstPage = await listOpenApiProcessLogs({ prisma: probe }, viewer, {
          limit: 200,
          since: "2026-05-01T00:00:00Z",
        });
        const firstPageQuery = captured.find(
          (entry) => entry.text.includes('."process_logs"') && entry.text.includes("ORDER BY"),
        );
        expect(firstPageQuery, "捕获首页 process_logs 查询").toBeDefined();
        statements.push(firstPageQuery as { text: string; params: string });
        expect(firstPage.hasMore).toBe(true);

        captured.length = 0;
        await listOpenApiProcessLogs({ prisma: probe }, viewer, {
          limit: 200,
          since: "2026-05-01T00:00:00Z",
          cursor: firstPage.nextCursor ?? undefined,
        });
        const cursorPageQuery = captured.find(
          (entry) => entry.text.includes('."process_logs"') && entry.text.includes("ORDER BY"),
        );
        expect(cursorPageQuery, "捕获游标页 process_logs 查询").toBeDefined();
        statements.push(cursorPageQuery as { text: string; params: string });
      } finally {
        await probe.$disconnect();
      }

      const inlineParams = (sql: string, paramsJson: string): string => {
        const params = JSON.parse(paramsJson) as unknown[];
        const literal = (value: unknown): string => {
          if (value === null || value === undefined) return "NULL";
          if (typeof value === "number") return String(value);
          if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
          return `'${String(value).replaceAll("'", "''")}'`;
        };
        return sql.replace(/\$(\d+)/g, (_match, n: string) => literal(params[Number(n) - 1]));
      };

      for (const statement of statements) {
        const plan = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
          const rows = await tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
            `EXPLAIN ${inlineParams(statement.text, statement.params)}`,
          );
          return rows.map((row) => row["QUERY PLAN"]).join("\n");
        });
        expect(plan).toContain("process_logs_at_id_idx");
        expect(plan).not.toMatch(/Seq Scan on process_logs/);
      }
    });
  });
});
