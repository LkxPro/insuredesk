import { randomUUID } from "node:crypto";
import {
  encodeCursor,
  OPEN_API_TICKET_FIELD_KEYS,
  openApiErrorBodySchema,
  openApiTicketListResponseSchema,
  openApiTicketSchema,
  openApiTicketTombstoneSchema,
} from "@insuredesk/shared";
import { PrismaPg } from "@prisma/adapter-pg";
import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, seedExternalUserRole } from "../prisma/seed-data.ts";
import { systemClock } from "../src/clock.ts";
import { parseEnv } from "../src/env.ts";
import {
  type PrismaClient,
  PrismaClient as ProbePrismaClient,
  type User,
} from "../src/generated/prisma/client.ts";
import { buildServer } from "../src/server.ts";
import { hashApiKey } from "../src/services/api-key.service.ts";
import { listOpenApiTickets } from "../src/services/open-api-ticket.service.ts";
import { deleteTicket } from "../src/services/ticket-delete.service.ts";
import { revokeImportBatch } from "../src/services/ticket-import-batch.service.ts";
import {
  createComplaintTicket,
  createComplaintTickets,
  type IntegrationHarness,
  startIntegrationHarness,
} from "./integration-harness.ts";

describe("GET /api/v1/tickets (Testcontainers)", () => {
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
        SESSION_SECRET: "insuredesk-open-api-tickets-secret-0123456789",
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
    const token = `sk_tickets-${randomUUID()}`;
    await prisma.apiKey.create({
      data: {
        name: `open-api-tickets-${++seq}`,
        keyHash: hashApiKey(token),
        keyPreview: token.slice(-8),
        userId,
        expiresAt: new Date(Date.now() + 86_400_000),
        ...overrides,
      },
    });
    return token;
  }

  function getTickets(token: string, query = "") {
    return app.inject({
      method: "GET",
      url: `/api/v1/tickets${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function scopedUserWith(permissions: string[]): Promise<User> {
    const role = await prisma.role.create({
      data: { name: `开放API角色-${++seq}`, permissions },
    });
    return prisma.user.create({
      data: {
        username: `open-api-user-${seq}`,
        name: `开放API用户${seq}`,
        passwordHash: "dummy",
        roleId: role.id,
        active: true,
      },
    });
  }

  describe("门禁", () => {
    it("无 ticket.export 权限的 key → 403 forbidden 信封", async () => {
      const token = await issueKey(seeded.users.cs1.id);
      const res = await getTickets(token);
      expect(res.statusCode).toBe(403);
      expect(() => openApiErrorBodySchema.parse(res.json())).not.toThrow();
      expect(res.json().error.code).toBe("forbidden");
    });

    it("external_role key → 403 forbidden 信封", async () => {
      const externalRole = await seedExternalUserRole(prisma);
      const external = await prisma.user.create({
        data: {
          username: `open-api-tickets-external-${++seq}`,
          name: "外部",
          passwordHash: "dummy",
          roleId: externalRole.id,
          active: true,
        },
      });
      const token = await issueKey(external.id);
      const res = await getTickets(token);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("forbidden");
    });

    it("无 ticket.view_all → 只见 OR[assigneeId, creatorId]；view_all+export → 全量", async () => {
      const scoped = await scopedUserWith(["ticket.export"]);
      await createComplaintTicket(prisma, {
        assigneeId: scoped.id,
        createdAt: new Date("2026-08-01T00:00:00Z"),
      });
      await createComplaintTicket(prisma, {
        creatorId: scoped.id,
        createdAt: new Date("2026-08-02T00:00:00Z"),
      });
      await createComplaintTicket(prisma, {
        assigneeId: seeded.users.cs1.id,
        creatorId: seeded.users.manager.id,
        createdAt: new Date("2026-08-03T00:00:00Z"),
      });

      const scopedRes = await getTickets(await issueKey(scoped.id));
      expect(scopedRes.statusCode).toBe(200);
      const scopedRows = scopedRes.json().data;
      expect(scopedRows).toHaveLength(2);
      for (const row of scopedRows) {
        expect([row.assigneeId, row.creatorId]).toContain(scoped.id);
      }

      const adminRes = await getTickets(await issueKey(seeded.users.admin.id));
      expect(adminRes.statusCode).toBe(200);
      expect(adminRes.json().data).toHaveLength(3);
    });
  });

  describe("ad-hoc 分页", () => {
    it("createdAt desc/id desc 翻页到底：不重不漏，末页 hasMore=false 且 cursor/url 为 null", async () => {
      const t1 = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-01T00:00:00Z"),
      });
      const t2 = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-02T00:00:00Z"),
      });
      const t3 = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-03T00:00:00Z"),
      });
      const token = await issueKey(seeded.users.admin.id);

      const page1 = await getTickets(token, "?limit=2");
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json();
      expect(() => openApiTicketListResponseSchema.parse(body1)).not.toThrow();
      expect(body1.data.map((row: { id: string }) => row.id)).toEqual([t3.id, t2.id]);
      expect(body1.hasMore).toBe(true);
      expect(typeof body1.nextCursor).toBe("string");
      expect(body1.nextUrl.startsWith("/api/v1/tickets?")).toBe(true);
      expect(body1.nextUrl).toContain("cursor=");

      const followed = await app.inject({
        method: "GET",
        url: body1.nextUrl,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(followed.statusCode).toBe(200);
      const body2 = followed.json();
      expect(body2.data.map((row: { id: string }) => row.id)).toEqual([t1.id]);
      expect(body2.hasMore).toBe(false);
      expect(body2.nextCursor).toBeNull();
      expect(body2.nextUrl).toBeNull();
    });

    it("空结果页：data=[]、hasMore=false、nextCursor/nextUrl=null", async () => {
      const token = await issueKey(seeded.users.admin.id);
      const res = await getTickets(token);
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
        const res = await getTickets(token, bad);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("invalid_params");
      }
    });

    it("strict：未知 query 参数 → 400 invalid_params（小写 updatedsince 不静默切全量）", async () => {
      const token = await issueKey(seeded.users.admin.id);
      for (const bad of ["?updatedsince=2026-08-01T00:00:00Z", "?nope=1"]) {
        const res = await getTickets(token, bad);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("invalid_params");
        expect(res.json().error.message).not.toContain(": :");
      }
      const res = await getTickets(token, "?nope=1");
      expect(res.json().error.message).toContain("nope");
    });

    it("软删工单在 ad-hoc 模式不出现", async () => {
      await createComplaintTicket(prisma, { createdAt: new Date("2026-08-01T00:00:00Z") });
      const deleted = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-02T00:00:00Z"),
      });
      await prisma.ticket.update({
        where: { id: deleted.id },
        data: {
          deletedAt: new Date("2026-08-03T00:00:00Z"),
          updatedAt: new Date("2026-08-03T00:00:00Z"),
        },
      });

      const res = await getTickets(await issueKey(seeded.users.admin.id));
      expect(res.statusCode).toBe(200);
      const ids = res.json().data.map((row: { id: string }) => row.id);
      expect(ids).toHaveLength(1);
      expect(ids).not.toContain(deleted.id);
    });
  });

  describe("游标", () => {
    it("不可解码/形状非法的 cursor → 400 invalid_cursor", async () => {
      const token = await issueKey(seeded.users.admin.id);
      const garbage = await getTickets(token, "?cursor=%%%");
      expect(garbage.statusCode).toBe(400);
      expect(garbage.json().error.code).toBe("invalid_cursor");

      const wrongShape = await getTickets(
        token,
        `?cursor=${encodeURIComponent(encodeCursor({ hello: 1 }))}`,
      );
      expect(wrongShape.statusCode).toBe(400);
      expect(wrongShape.json().error.code).toBe("invalid_cursor");
    });

    it("模式混用：ad-hoc 游标带 updatedSince 再请求 → 400 invalid_cursor", async () => {
      for (let i = 1; i <= 2; i += 1) {
        await createComplaintTicket(prisma, {
          createdAt: new Date(`2026-08-0${i}T00:00:00Z`),
        });
      }
      const token = await issueKey(seeded.users.admin.id);
      const page1 = await getTickets(token, "?limit=1");
      const cursor = page1.json().nextCursor;
      expect(cursor).not.toBeNull();

      const mixed = await getTickets(
        token,
        `?limit=1&updatedSince=2026-07-01T00:00:00Z&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(mixed.statusCode).toBe(400);
      expect(mixed.json().error.code).toBe("invalid_cursor");
    });

    it("筛选混用：换筛选续翻 → 400 invalid_cursor；原样续翻 → 200", async () => {
      for (let i = 1; i <= 2; i += 1) {
        await createComplaintTicket(prisma, {
          createdAt: new Date(`2026-08-0${i}T00:00:00Z`),
        });
      }
      const token = await issueKey(seeded.users.admin.id);
      const page1 = await getTickets(token, "?limit=1&status=unassigned");
      const cursor = page1.json().nextCursor;
      expect(cursor).not.toBeNull();

      const changed = await getTickets(
        token,
        `?limit=1&status=assigned&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(changed.statusCode).toBe(400);
      expect(changed.json().error.code).toBe("invalid_cursor");

      const same = await getTickets(
        token,
        `?limit=1&status=unassigned&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(same.statusCode).toBe(200);
    });
  });

  describe("增量模式 (updatedSince)", () => {
    it("updatedAt asc/id asc 翻页：沿 nextUrl 到底不重不漏", async () => {
      const t1 = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-10T00:00:00Z"),
      });
      const t2 = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-02T00:00:00Z"),
        updatedAt: new Date("2026-08-11T00:00:00Z"),
      });
      const t3 = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-03T00:00:00Z"),
        updatedAt: new Date("2026-08-12T00:00:00Z"),
      });
      const token = await issueKey(seeded.users.admin.id);

      const page1 = await getTickets(token, "?updatedSince=2026-08-01T00:00:00Z&limit=2");
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json();
      expect(() => openApiTicketListResponseSchema.parse(body1)).not.toThrow();
      expect(body1.data.map((row: { id: string }) => row.id)).toEqual([t1.id, t2.id]);
      expect(body1.hasMore).toBe(true);

      const page2 = await app.inject({
        method: "GET",
        url: body1.nextUrl,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(page2.statusCode).toBe(200);
      const body2 = page2.json();
      expect(body2.data.map((row: { id: string }) => row.id)).toEqual([t3.id]);
      expect(body2.hasMore).toBe(false);
      expect(body2.nextCursor).toBeNull();
      expect(body2.nextUrl).toBeNull();
    });

    it("首页边界 inclusive：updatedSince 恰等于某行 updatedAt 时该行在列", async () => {
      await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-10T00:00:00Z"),
      });
      const t2 = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-02T00:00:00Z"),
        updatedAt: new Date("2026-08-11T00:00:00Z"),
      });
      const token = await issueKey(seeded.users.admin.id);
      const res = await getTickets(token, "?updatedSince=2026-08-11T00:00:00Z");
      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((row: { id: string }) => row.id)).toEqual([t2.id]);
    });

    it("增量空页：updatedSince 在未来 → data=[]、hasMore=false、cursor/url null", async () => {
      await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-10T00:00:00Z"),
      });
      const token = await issueKey(seeded.users.admin.id);
      const res = await getTickets(token, "?updatedSince=2030-01-01T00:00:00Z");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        data: [],
        hasMore: false,
        nextCursor: null,
        nextUrl: null,
      });
    });

    it("续页边界 exclusive：同 updatedAt 并列行按 id 断开，上一页末行不重出", async () => {
      const same = new Date("2026-08-10T00:00:00Z");
      const a = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: same,
      });
      const b = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-02T00:00:00Z"),
        updatedAt: same,
      });
      const first = a.id < b.id ? a : b;
      const second = a.id < b.id ? b : a;
      const token = await issueKey(seeded.users.admin.id);

      const page1 = await getTickets(token, "?updatedSince=2026-08-01T00:00:00Z&limit=1");
      expect(page1.json().data.map((row: { id: string }) => row.id)).toEqual([first.id]);
      const page2 = await app.inject({
        method: "GET",
        url: page1.json().nextUrl,
        headers: { authorization: `Bearer ${token}` },
      });
      const body2 = page2.json();
      expect(body2.data.map((row: { id: string }) => row.id)).toEqual([second.id]);
      expect(body2.hasMore).toBe(false);
    });

    it("软删行以 tombstone 最小形状流出；fields 投影不改变 tombstone", async () => {
      const live = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-10T00:00:00Z"),
      });
      const deleted = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-02T00:00:00Z"),
        updatedAt: new Date("2026-08-11T00:00:00Z"),
      });
      await prisma.ticket.update({
        where: { id: deleted.id },
        data: {
          deletedAt: new Date("2026-08-12T00:00:00Z"),
          updatedAt: new Date("2026-08-12T00:00:00Z"),
        },
      });
      const token = await issueKey(seeded.users.admin.id);

      const res = await getTickets(token, "?updatedSince=2026-08-01T00:00:00Z");
      expect(res.statusCode).toBe(200);
      const rows = res.json().data;
      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe(live.id);
      expect("tombstone" in rows[0]).toBe(false);

      const tombstone = rows[1];
      expect(() => openApiTicketTombstoneSchema.parse(tombstone)).not.toThrow();
      expect(Object.keys(tombstone).sort()).toEqual(
        ["deletedAt", "id", "tombstone", "updatedAt", "workOrderNumber"].sort(),
      );
      expect(tombstone).toMatchObject({
        id: deleted.id,
        workOrderNumber: deleted.workOrderNumber,
        deletedAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
        tombstone: true,
      });

      const projected = await getTickets(
        token,
        "?updatedSince=2026-08-01T00:00:00Z&fields=id,status",
      );
      const projectedRows = projected.json().data;
      expect(Object.keys(projectedRows[0]).sort()).toEqual(["id", "status"]);
      expect(Object.keys(projectedRows[1]).sort()).toEqual(
        ["deletedAt", "id", "tombstone", "updatedAt", "workOrderNumber"].sort(),
      );
    });

    it("真实 deleteTicket 路径：删除把 updatedAt 盖到删除时刻，updatedSince 卡在原值之后的消费者照样收到 tombstone", async () => {
      const ticket = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      });
      const deletedAt = new Date("2026-08-05T00:00:00Z");
      await deleteTicket(
        harness.depsAt(deletedAt),
        harness.authUserFor(seeded.users.admin, seeded.roles.admin),
        { ticketId: ticket.id },
      );

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(row.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
      expect(row.updatedAt.toISOString()).toBe(deletedAt.toISOString());

      const token = await issueKey(seeded.users.admin.id);
      const res = await getTickets(token, "?updatedSince=2026-08-02T00:00:00Z");
      expect(res.statusCode).toBe(200);
      const rows = res.json().data;
      expect(rows).toHaveLength(1);
      expect(() => openApiTicketTombstoneSchema.parse(rows[0])).not.toThrow();
      expect(rows[0]).toMatchObject({
        id: ticket.id,
        tombstone: true,
        deletedAt: deletedAt.toISOString(),
        updatedAt: deletedAt.toISOString(),
      });
    });

    it("真实 revokeImportBatch 路径：整批撤销把批内 updatedAt 盖到撤销时刻，updatedSince 卡在原值之后的消费者收到全部 tombstone", async () => {
      const importedAt = new Date("2026-08-01T00:00:00Z");
      const batch = await prisma.ticketImportBatch.create({
        data: {
          filename: `开放API撤销-${++seq}.xlsx`,
          importerId: seeded.users.admin.id,
          importedAt,
          rowCount: 2,
        },
      });
      const first = await createComplaintTicket(prisma, {
        source: "file_import",
        importBatchId: batch.id,
        createdAt: importedAt,
        updatedAt: importedAt,
      });
      const second = await createComplaintTicket(prisma, {
        source: "file_import",
        importBatchId: batch.id,
        createdAt: importedAt,
        updatedAt: importedAt,
      });

      const revokedAt = new Date("2026-08-05T00:00:00Z");
      await revokeImportBatch(
        harness.depsAt(revokedAt),
        harness.authUserFor(seeded.users.admin, seeded.roles.admin),
        { batchId: batch.id },
      );

      const rows = await prisma.ticket.findMany({ where: { importBatchId: batch.id } });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.deletedAt?.toISOString()).toBe(revokedAt.toISOString());
        expect(row.updatedAt.toISOString()).toBe(revokedAt.toISOString());
      }

      const token = await issueKey(seeded.users.admin.id);
      const res = await getTickets(token, "?updatedSince=2026-08-02T00:00:00Z");
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data).toHaveLength(2);
      expect(data.map((row: { id: string }) => row.id).sort()).toEqual(
        [first.id, second.id].sort(),
      );
      for (const row of data) {
        expect(() => openApiTicketTombstoneSchema.parse(row)).not.toThrow();
        expect(row).toMatchObject({
          tombstone: true,
          deletedAt: revokedAt.toISOString(),
          updatedAt: revokedAt.toISOString(),
        });
      }
    });
  });

  describe("来源与筛选", () => {
    it("source 缺省 = 全部来源（含 file_import）；显式过滤生效", async () => {
      const manual = await createComplaintTicket(prisma, {
        source: "manual",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      });
      const imported = await createComplaintTicket(prisma, {
        source: "file_import",
        createdAt: new Date("2026-08-02T00:00:00Z"),
      });
      const token = await issueKey(seeded.users.admin.id);

      const idsOf = (body: { data: Array<{ id: string }> }) =>
        body.data.map((row) => row.id).sort();

      const adhoc = await getTickets(token);
      expect(idsOf(adhoc.json())).toEqual([manual.id, imported.id].sort());

      const incremental = await getTickets(token, "?updatedSince=2026-01-01T00:00:00Z");
      expect(idsOf(incremental.json())).toEqual([manual.id, imported.id].sort());

      const onlyManual = await getTickets(token, "?source=manual");
      expect(idsOf(onlyManual.json())).toEqual([manual.id]);

      const onlyImported = await getTickets(token, "?source=file_import");
      expect(idsOf(onlyImported.json())).toEqual([imported.id]);
    });

    it("status（含计算态）/channelId/kindId/policyNumberState/createdFrom-createdTo/search 筛选", async () => {
      const complaintKindId = (
        await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } })
      ).id;
      const refundKindId = (
        await prisma.ticketKind.findUniqueOrThrow({ where: { key: "refund_exception" } })
      ).id;

      const overdue = await createComplaintTicket(
        prisma,
        {
          status: "assigned",
          assigneeId: seeded.users.cs1.id,
          dueAt: new Date("2020-01-01T00:00:00Z"),
          createdAt: new Date("2026-08-01T00:00:00Z"),
        },
        { channelId: harness.channelId("保司"), customerName: "筛选客户甲" },
      );
      const plain = await createComplaintTicket(
        prisma,
        { createdAt: new Date("2026-08-05T00:00:00Z") },
        { channelId: harness.channelId("经纪"), customerName: "筛选客户乙" },
      );
      const noPolicy = await createComplaintTicket(
        prisma,
        { createdAt: new Date("2026-08-06T00:00:00Z") },
        { noPolicyNumber: true },
      );
      const refund = await prisma.ticket.create({
        data: {
          source: "jb-insurance",
          kindId: refundKindId,
          slaAnchorAt: new Date("2026-08-07T00:00:00Z"),
          createdAt: new Date("2026-08-07T00:00:00Z"),
          updatedAt: new Date("2026-08-07T00:00:00Z"),
          refundDetail: {
            create: {
              platform: "jb-insurance",
              endorNo: "ENDOR-1",
              sysOrderId: "SYS-1",
              workOrderType: "卡异常-退费失败",
              expectedAmount: "100.00",
              refundCreateTime: new Date("2026-08-07T00:00:00Z"),
              refundTrades: [],
            },
          },
        },
      });
      const token = await issueKey(seeded.users.admin.id);
      const idsOf = (body: { data: Array<{ id: string }> }) => body.data.map((row) => row.id);

      expect(idsOf((await getTickets(token, "?status=overdue")).json())).toEqual([overdue.id]);
      expect(idsOf((await getTickets(token, "?status=unassigned")).json()).sort()).toEqual(
        [plain.id, noPolicy.id, refund.id].sort(),
      );
      expect(
        idsOf((await getTickets(token, `?channelId=${harness.channelId("保司")}`)).json()),
      ).toEqual([overdue.id]);
      expect(idsOf((await getTickets(token, `?kindId=${refundKindId}`)).json())).toEqual([
        refund.id,
      ]);
      expect(idsOf((await getTickets(token, `?kindId=${complaintKindId}`)).json()).sort()).toEqual(
        [overdue.id, plain.id, noPolicy.id].sort(),
      );
      expect(idsOf((await getTickets(token, "?policyNumberState=none")).json())).toEqual([
        noPolicy.id,
      ]);
      expect(
        idsOf((await getTickets(token, "?createdFrom=2026-08-03T00:00:00Z")).json()).sort(),
      ).toEqual([plain.id, noPolicy.id, refund.id].sort());
      expect(idsOf((await getTickets(token, "?createdTo=2026-08-03T00:00:00Z")).json())).toEqual([
        overdue.id,
      ]);
      expect(idsOf((await getTickets(token, "?search=客户甲")).json())).toEqual([overdue.id]);
    });

    it("fields 白名单投影：合法字段精确子集；非法字段 400 且 message 附合法清单", async () => {
      await createComplaintTicket(prisma, { createdAt: new Date("2026-08-01T00:00:00Z") });
      const token = await issueKey(seeded.users.admin.id);

      const ok = await getTickets(token, "?fields=id,workOrderNumber");
      expect(ok.statusCode).toBe(200);
      expect(Object.keys(ok.json().data[0]).sort()).toEqual(["id", "workOrderNumber"]);

      const bad = await getTickets(token, "?fields=id,nope");
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe("invalid_params");
      expect(bad.json().error.message).toContain("nope");
      expect(bad.json().error.message).toContain("workOrderNumber");
    });
  });

  describe("展平", () => {
    it("投诉单：侧表 complaint_ 前缀平铺、字典 id/name 双字段、refund_ 全 null、金额与数组原样", async () => {
      const completion = await prisma.completionStatus.findFirstOrThrow();
      const feedbackReceiveChannel = await prisma.feedbackReceiveChannel.findFirstOrThrow();
      const ticket = await createComplaintTicket(
        prisma,
        {
          contactPhone: "13900000000",
          slaPolicyId: harness.slaPolicyId("一般投诉"),
          followUpFrequency: "24小时累计1次",
          firstResponseRequirement: "120分钟内完成首次响应",
          status: "completed",
          assigneeId: seeded.users.cs1.id,
          assignedAt: new Date("2026-08-01T01:00:00Z"),
          dueAt: new Date("2026-08-03T00:00:00Z"),
          nextContactTime: new Date("2026-08-02T00:00:00Z"),
          contactCount: 2,
          completionTime: new Date("2026-08-02T12:00:00Z"),
          completionStatusId: completion.id,
          creatorId: seeded.users.manager.id,
          createdAt: new Date("2026-08-01T00:00:00Z"),
          updatedAt: new Date("2026-08-02T12:00:00Z"),
        },
        {
          feedbackTime: new Date("2026-07-31T08:00:00Z"),
          channelId: harness.channelId("保司"),
          project: "融盛",
          brokerageEntity: "东方大地",
          paymentChannel: "连连支付",
          internalOrderNumber: "ORD-1",
          policyNumbers: ["P1", "P2"],
          userFeedbackChannelId: harness.userFeedbackChannelId("保司400热线"),
          feedbackReceiveChannelId: feedbackReceiveChannel.id,
          customerName: "王小明",
          phone: "13800000000",
          customerRequest: "要求核实并回复",
          nuclearBodyStatus: "待核实",
          hasContacted: false,
          contactTime: new Date("2026-07-31T09:00:00Z"),
          contactId: "CALL-1",
          categoryId: harness.categoryId("理赔投诉"),
          priority: "high",
        },
      );
      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          operatorId: seeded.users.cs1.id,
          operatorName: "张客服",
          action: "comment",
          remark: "首次联系",
          at: new Date("2026-08-01T02:00:00Z"),
        },
      });
      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          operatorId: seeded.users.manager.id,
          operatorName: "李主管",
          action: "assign",
          remark: "分配",
          at: new Date("2026-08-01T03:00:00Z"),
        },
      });
      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          operatorId: seeded.users.cs1.id,
          operatorName: "张客服",
          action: "comment",
          remark: "二次跟进",
          at: new Date("2026-08-01T04:00:00Z"),
        },
      });

      const res = await getTickets(await issueKey(seeded.users.admin.id));
      expect(res.statusCode).toBe(200);
      const row = res.json().data[0];
      expect(() => openApiTicketSchema.parse(row)).not.toThrow();

      expect(row).toMatchObject({
        id: ticket.id,
        workOrderNumber: ticket.workOrderNumber,
        source: "manual",
        status: "completed",
        displayStatus: "completed",
        kindKey: "complaint",
        contactPhone: "13900000000",
        slaPolicyId: harness.slaPolicyId("一般投诉"),
        slaPolicyName: "一般投诉",
        assigneeId: seeded.users.cs1.id,
        assigneeName: "张客服",
        creatorId: seeded.users.manager.id,
        createdBy: "李主管",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T12:00:00.000Z",
        assignedAt: "2026-08-01T01:00:00.000Z",
        dueAt: "2026-08-03T00:00:00.000Z",
        nextContactTime: "2026-08-02T00:00:00.000Z",
        contactCount: 2,
        followUpFrequency: "24小时累计1次",
        firstResponseRequirement: "120分钟内完成首次响应",
        completionTime: "2026-08-02T12:00:00.000Z",
        completionStatusId: completion.id,
        completionStatusName: completion.name,
        complaint_feedbackTime: "2026-07-31T08:00:00.000Z",
        complaint_channelId: harness.channelId("保司"),
        complaint_channelName: "保司",
        complaint_project: "融盛",
        complaint_brokerageEntity: "东方大地",
        complaint_paymentChannel: "连连支付",
        complaint_internalOrderNumber: "ORD-1",
        complaint_policyNumbers: ["P1", "P2"],
        complaint_noPolicyNumber: false,
        complaint_userFeedbackChannelId: harness.userFeedbackChannelId("保司400热线"),
        complaint_userFeedbackChannelName: "保司400热线",
        complaint_feedbackReceiveChannelId: feedbackReceiveChannel.id,
        complaint_feedbackReceiveChannelName: feedbackReceiveChannel.name,
        complaint_customerName: "王小明",
        complaint_phone: "13800000000",
        complaint_customerRequest: "要求核实并回复",
        complaint_nuclearBodyStatus: "待核实",
        complaint_hasContacted: false,
        complaint_contactTime: "2026-07-31T09:00:00.000Z",
        complaint_contactId: "CALL-1",
        complaint_categoryId: harness.categoryId("理赔投诉"),
        complaint_categoryName: "理赔投诉",
        complaint_priority: "high",
      });
      expect(row.processLogsText).toBe(
        "[2026-08-01T02:00:00.000Z] 张客服：首次联系\n[2026-08-01T04:00:00.000Z] 张客服：二次跟进",
      );
      for (const [key, value] of Object.entries(row)) {
        if (key.startsWith("refund_")) {
          expect(value, key).toBeNull();
        }
      }
    });

    it("退费单：refund_ 前缀平铺原样（金额 String、refundTrades JSON 数组）、complaint_ 全 null", async () => {
      const refundKindId = (
        await prisma.ticketKind.findUniqueOrThrow({ where: { key: "refund_exception" } })
      ).id;
      const refundTrades = [{ period: 1, amount: "50.00" }];
      await prisma.ticket.create({
        data: {
          source: "jb-insurance",
          kindId: refundKindId,
          slaAnchorAt: new Date("2026-08-01T00:00:00Z"),
          createdAt: new Date("2026-08-01T00:00:00Z"),
          updatedAt: new Date("2026-08-01T00:00:00Z"),
          contactPhone: "13700000000",
          refundDetail: {
            create: {
              platform: "jb-insurance",
              endorNo: "ENDOR-1",
              sysOrderId: "SYS-1",
              workOrderType: "卡异常-退费失败",
              expectedAmount: "100.00",
              refundCreateTime: new Date("2026-07-31T00:00:00Z"),
              refundTrades,
              holderName: "张三",
              holderPhone: "13888888888",
              companyName: "泰康在线",
              productId: "P10001",
              productName: "泰康百万医疗险",
              policyNo: "POL-1",
              failureReason: "银行卡状态异常",
              pushedFields: ["expectedAmount"],
              compensationAmount: "5.50",
            },
          },
        },
      });

      const res = await getTickets(await issueKey(seeded.users.admin.id));
      expect(res.statusCode).toBe(200);
      const row = res.json().data[0];
      expect(() => openApiTicketSchema.parse(row)).not.toThrow();
      expect(row).toMatchObject({
        source: "jb-insurance",
        kindKey: "refund_exception",
        contactPhone: "13700000000",
        createdBy: "骏伯保险平台",
        refund_platform: "jb-insurance",
        refund_endorNo: "ENDOR-1",
        refund_sysOrderId: "SYS-1",
        refund_workOrderType: "卡异常-退费失败",
        refund_expectedAmount: "100.00",
        refund_refundCreateTime: "2026-07-31T00:00:00.000Z",
        refund_refundTrades: refundTrades,
        refund_holderName: "张三",
        refund_holderPhone: "13888888888",
        refund_companyName: "泰康在线",
        refund_productId: "P10001",
        refund_productName: "泰康百万医疗险",
        refund_policyNo: "POL-1",
        refund_failureReason: "银行卡状态异常",
        refund_pushedFields: ["expectedAmount"],
        refund_compensationAmount: "5.50",
      });
      for (const [key, value] of Object.entries(row)) {
        if (key.startsWith("complaint_")) {
          expect(value, key).toBeNull();
        }
      }
    });

    it("枚举列 raw 透传：库存未知取值原样返回不 500，displayStatus 仍走读时判定", async () => {
      const ticket = await createComplaintTicket(prisma, {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        dueAt: null,
      });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: "legacy_weird", source: "legacy_source" },
      });
      await prisma.ticketComplaintDetail.update({
        where: { ticketId: ticket.id },
        data: { priority: "p9_junk", nuclearBodyStatus: "旧核身值" },
      });

      const res = await getTickets(await issueKey(seeded.users.admin.id));
      expect(res.statusCode).toBe(200);
      const row = res.json().data[0];
      expect(() => openApiTicketSchema.parse(row)).not.toThrow();
      expect(row.status).toBe("legacy_weird");
      expect(row.source).toBe("legacy_source");
      expect(row.displayStatus).toBe("legacy_weird");
      expect(row.complaint_priority).toBe("p9_junk");
      expect(row.complaint_nuclearBodyStatus).toBe("旧核身值");
    });

    it("displayStatus 读时判定：已分配且处理时限已过 → overdue，status 原样", async () => {
      await createComplaintTicket(prisma, {
        status: "assigned",
        assigneeId: seeded.users.cs1.id,
        dueAt: new Date("2020-01-01T00:00:00Z"),
        createdAt: new Date("2026-08-01T00:00:00Z"),
      });
      const res = await getTickets(await issueKey(seeded.users.admin.id));
      const row = res.json().data[0];
      expect(row.status).toBe("assigned");
      expect(row.displayStatus).toBe("overdue");
    });

    it("createdBy 读时派生：外部来源取来源标签（飞书）", async () => {
      await createComplaintTicket(prisma, {
        source: "feishu_form",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      });
      const res = await getTickets(await issueKey(seeded.users.admin.id));
      expect(res.json().data[0].createdBy).toBe("飞书");
    });
  });

  describe("canonical 字段注册表", () => {
    it("响应 schema 字段集 = 金样（顺序即声明序）", () => {
      expect(Object.keys(openApiTicketSchema.shape)).toEqual([
        "id",
        "workOrderNumber",
        "source",
        "status",
        "displayStatus",
        "kindId",
        "kindKey",
        "contactPhone",
        "slaPolicyId",
        "slaPolicyName",
        "assigneeId",
        "assigneeName",
        "creatorId",
        "createdBy",
        "createdAt",
        "updatedAt",
        "assignedAt",
        "dueAt",
        "nextContactTime",
        "contactCount",
        "followUpFrequency",
        "firstResponseRequirement",
        "completionTime",
        "completionStatusId",
        "completionStatusName",
        "processLogsText",
        "complaint_feedbackTime",
        "complaint_channelId",
        "complaint_channelName",
        "complaint_project",
        "complaint_brokerageEntity",
        "complaint_paymentChannel",
        "complaint_internalOrderNumber",
        "complaint_policyNumbers",
        "complaint_noPolicyNumber",
        "complaint_userFeedbackChannelId",
        "complaint_userFeedbackChannelName",
        "complaint_feedbackReceiveChannelId",
        "complaint_feedbackReceiveChannelName",
        "complaint_customerName",
        "complaint_phone",
        "complaint_customerRequest",
        "complaint_nuclearBodyStatus",
        "complaint_hasContacted",
        "complaint_contactTime",
        "complaint_contactId",
        "complaint_categoryId",
        "complaint_categoryName",
        "complaint_priority",
        "refund_platform",
        "refund_endorNo",
        "refund_sysOrderId",
        "refund_workOrderType",
        "refund_expectedAmount",
        "refund_refundCreateTime",
        "refund_refundTrades",
        "refund_holderName",
        "refund_holderPhone",
        "refund_companyName",
        "refund_productId",
        "refund_productName",
        "refund_policyNo",
        "refund_failureReason",
        "refund_pushedFields",
        "refund_compensationAmount",
      ]);
    });

    it("API 字段集 ⊇ 既有 Excel 导出列集（导出端点行为不变：列头逐字对上金样）", async () => {
      // 每 sheet 的列头→canonical 字段映射；列头序即导出契约，逐字钉住
      const complaintHeaderToField: Record<string, string> = {
        工单号: "workOrderNumber",
        状态: "displayStatus",
        客户姓名: "complaint_customerName",
        客户电话: "complaint_phone",
        联系电话: "contactPhone",
        保单号: "complaint_policyNumbers",
        渠道: "complaint_channelName",
        时效策略: "slaPolicyName",
        分类: "complaint_categoryName",
        优先级: "complaint_priority",
        来源: "source",
        项目: "complaint_project",
        经纪主体: "complaint_brokerageEntity",
        支付渠道: "complaint_paymentChannel",
        内部订单号: "complaint_internalOrderNumber",
        用户反馈渠道: "complaint_userFeedbackChannelName",
        反馈信息接收渠道: "complaint_feedbackReceiveChannelName",
        客户诉求: "complaint_customerRequest",
        核体状态: "complaint_nuclearBodyStatus",
        是否已联系: "complaint_hasContacted",
        进线时间: "complaint_contactTime",
        联系ID: "complaint_contactId",
        责任人: "assigneeName",
        反馈时间: "complaint_feedbackTime",
        创建时间: "createdAt",
        分配时间: "assignedAt",
        处理时限: "dueAt",
        下次联系时间: "nextContactTime",
        联系次数: "contactCount",
        跟进频次: "followUpFrequency",
        首响要求: "firstResponseRequirement",
        跟进记录: "processLogsText",
        完结时间: "completionTime",
        完结状态: "completionStatusName",
      };
      const refundHeaderToField: Record<string, string> = {
        工单号: "workOrderNumber",
        状态: "displayStatus",
        客户姓名: "refund_holderName",
        客户电话: "refund_holderPhone",
        联系电话: "contactPhone",
        时效策略: "slaPolicyName",
        来源: "source",
        责任人: "assigneeName",
        创建时间: "createdAt",
        分配时间: "assignedAt",
        处理时限: "dueAt",
        下次联系时间: "nextContactTime",
        联系次数: "contactCount",
        跟进频次: "followUpFrequency",
        首响要求: "firstResponseRequirement",
        跟进记录: "processLogsText",
        完结时间: "completionTime",
        完结状态: "completionStatusName",
        退费异常原因: "refund_failureReason",
        应退金额: "refund_expectedAmount",
        补偿金: "refund_compensationAmount",
      };

      await createComplaintTicket(prisma, { createdAt: new Date("2026-08-01T00:00:00Z") });

      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: DEMO_PASSWORD },
      });
      const session = String(login.cookies.find((cookie) => cookie.name === "session")?.value);
      const exportRes = await app.inject({
        method: "GET",
        url: "/api/tickets/export?format=xlsx",
        cookies: { session },
      });
      expect(exportRes.statusCode).toBe(200);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(exportRes.rawPayload as unknown as ArrayBuffer);
      expect(workbook.worksheets).toHaveLength(2);

      const seenSheets = new Set<string>();
      for (const sheet of workbook.worksheets) {
        const headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(String);
        const mapping = headers.includes("退费异常原因")
          ? refundHeaderToField
          : complaintHeaderToField;
        seenSheets.add(mapping === refundHeaderToField ? "refund" : "complaint");
        expect(headers).toEqual(Object.keys(mapping));
        for (const field of Object.values(mapping)) {
          expect(OPEN_API_TICKET_FIELD_KEYS).toContain(field);
        }
      }
      expect(seenSheets).toEqual(new Set(["complaint", "refund"]));
    });
  });

  describe("增量同步规模与查询计划", () => {
    const AMPLIFIED_ROWS = 1200;

    async function seedAmplified(): Promise<{ liveIds: string[]; deletedIds: string[] }> {
      const base = new Date("2026-06-01T00:00:00Z").getTime();
      const ids = await createComplaintTickets(
        prisma,
        Array.from({ length: AMPLIFIED_ROWS }, (_, i) => ({
          core: {
            createdAt: new Date(base + i * 1000),
            updatedAt: new Date(base + i * 1000),
          },
        })),
      );
      const deletedIds = [ids[10], ids[500], ids[1199]].map((id) => {
        if (!id) throw new Error("seed 失败");
        return id;
      });
      for (const [index, id] of deletedIds.entries()) {
        const at = new Date(base + 2_000_000 + index * 1000);
        await prisma.ticket.update({ where: { id }, data: { deletedAt: at, updatedAt: at } });
      }
      return { liveIds: ids, deletedIds };
    }

    it("放大同步：1200 行 + 3 tombstone 逐页不重不漏，序与库内 (updatedAt,id) 一致", async () => {
      const { deletedIds } = await seedAmplified();
      const token = await issueKey(seeded.users.admin.id);

      const encounterOrder: string[] = [];
      const tombstoneIds: string[] = [];
      let url: string | null = "/api/v1/tickets?updatedSince=2026-05-01T00:00:00Z&limit=200";
      let pages = 0;
      while (url !== null) {
        pages += 1;
        expect(pages).toBeLessThanOrEqual(10);
        const res: Awaited<ReturnType<typeof app.inject>> = await app.inject({
          method: "GET",
          url,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        for (const row of body.data) {
          encounterOrder.push(row.id);
          if (row.tombstone === true) {
            tombstoneIds.push(row.id);
          }
        }
        if (body.hasMore) {
          expect(typeof body.nextCursor).toBe("string");
          expect(body.nextUrl.startsWith("/api/v1/tickets?")).toBe(true);
          url = body.nextUrl;
        } else {
          expect(body.nextCursor).toBeNull();
          expect(body.nextUrl).toBeNull();
          url = null;
        }
      }

      const truth = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM tickets ORDER BY "updatedAt" ASC, id ASC
      `;
      expect(encounterOrder).toEqual(truth.map((row) => row.id));
      expect(tombstoneIds.sort()).toEqual([...deletedIds].sort());
      expect(encounterOrder).toHaveLength(AMPLIFIED_ROWS);
    });

    it("EXPLAIN（SET enable_seqscan=off）：首页与游标页都走 tickets(updatedAt,id) 索引", async () => {
      await seedAmplified();
      await prisma.$executeRawUnsafe("ANALYZE tickets");

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
        const firstPage = await listOpenApiTickets({ prisma: probe, clock: systemClock }, viewer, {
          limit: 200,
          updatedSince: "2026-05-01T00:00:00Z",
        });
        const firstPageQuery = captured.find(
          (entry) => entry.text.includes('."tickets"') && entry.text.includes("ORDER BY"),
        );
        expect(firstPageQuery, "捕获首页 tickets 查询").toBeDefined();
        statements.push(firstPageQuery as { text: string; params: string });
        expect(firstPage.hasMore).toBe(true);

        captured.length = 0;
        await listOpenApiTickets({ prisma: probe, clock: systemClock }, viewer, {
          limit: 200,
          updatedSince: "2026-05-01T00:00:00Z",
          cursor: firstPage.nextCursor ?? undefined,
        });
        const cursorPageQuery = captured.find(
          (entry) => entry.text.includes('."tickets"') && entry.text.includes("ORDER BY"),
        );
        expect(cursorPageQuery, "捕获游标页 tickets 查询").toBeDefined();
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
        expect(plan).toContain("tickets_updatedAt_id_idx");
        expect(plan).not.toMatch(/Seq Scan on tickets/);
      }
    });
  });
});
