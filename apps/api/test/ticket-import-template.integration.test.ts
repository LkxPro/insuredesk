import {
  TICKET_IMPORT_HEADERS as EXPECTED_HEADERS,
  TICKET_FIELD_DESCRIPTORS,
  type TicketFieldDescriptor,
} from "@insuredesk/shared";
import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed-data.ts";
import { parseEnv } from "../src/env.ts";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { buildServer } from "../src/server.ts";
import { hashPassword } from "../src/services/auth.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

/**
 * Acceptance tests for the 批量导入 template download, over the real HTTP
 * surface like the export tests:
 *
 * - ticket.import guard: 401 unauthenticated, 403 without the permission —
 *   including factory roles, which are seeded once and never backfilled
 * - the sheet carries the 建单表单 columns plus the 完结状态/完结备注
 *   pair, Chinese headers in form order
 * - enum/catalog columns carry Excel data-validation dropdowns; 渠道/客诉
 *   类别/完结状态 options are the ACTIVE catalog rows at download time
 *   (停用后重新下载即消失)
 * - a 填写说明 sheet documents per-column rules, the 2000-row limit, and the
 *   完结 pair's 同填同空 rule
 */
describe("ticket import template (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "channels", "categories", "slaPolicies"],
    });
    prisma = harness.prisma;
    const databaseUrl = harness.databaseUrl;

    // No factory role holds ticket.import (存量角色默认没有、需手动勾选)
    const importerRole = await prisma.role.create({
      data: { name: "导入员", permissions: ["ticket.view", "ticket.import"] },
    });
    await prisma.user.create({
      data: {
        username: "importer",
        name: "导入员一号",
        email: "importer@example.com",
        roleId: importerRole.id,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        active: true,
      },
    });

    const env = parseEnv({
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: "insuredesk-import-template-test-secret-01",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    });
    app = buildServer(env);
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await harness?.stop();
  });

  /** Log in over the real endpoint; returns the session cookie value. */
  async function sessionFor(username: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username, password: DEMO_PASSWORD },
    });
    const cookie = res.cookies.find((c) => c.name === "session");
    expect(cookie, `login as ${username}`).toBeDefined();
    return String(cookie?.value);
  }

  function templateRequest(session: string | null) {
    return app.inject({
      method: "GET",
      url: "/api/tickets/import-template",
      ...(session ? { cookies: { session } } : {}),
    });
  }

  async function downloadWorkbook(session: string): Promise<ExcelJS.Workbook> {
    const res = await templateRequest(session);
    expect(res.statusCode).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    return workbook;
  }

  describe("权限校验 (guard order mirrors 导出)", () => {
    it("401 without a session, 403 without ticket.import", async () => {
      const anonymous = await templateRequest(null);
      expect(anonymous.statusCode).toBe(401);

      // Factory roles are seeded once and never backfilled — even 客服主管
      // (who exports) lacks ticket.import until someone勾选 it.
      const manager = await sessionFor("manager");
      const forbidden = await templateRequest(manager);
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().error).toContain("ticket.import");

      const observer = await sessionFor("observer");
      expect((await templateRequest(observer)).statusCode).toBe(403);
    });

    it("200 for a role granted ticket.import, and for 管理员 (全量权限点自动获得)", async () => {
      const importer = await sessionFor("importer");
      const res = await templateRequest(importer);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(res.headers["content-disposition"]).toMatch(
        /attachment; filename="ticket-import-template\.xlsx"/,
      );

      const admin = await sessionFor("admin");
      expect((await templateRequest(admin)).statusCode).toBe(200);
    });
  });

  describe("模板结构", () => {
    it("carries the 建单表单 + 完结迁移对 columns with Chinese headers in form order", async () => {
      const workbook = await downloadWorkbook(await sessionFor("importer"));
      const sheet = workbook.getWorksheet("工单");
      expect(sheet).toBeDefined();

      const headers = EXPECTED_HEADERS.map((_, index) => sheet?.getRow(1).getCell(index + 1).value);
      expect(headers).toEqual(EXPECTED_HEADERS);
      // no extra columns ride along
      expect(sheet?.getRow(1).cellCount).toBe(EXPECTED_HEADERS.length);
    });

    it("includes a 填写说明 sheet with the date format and the 2000-row limit", async () => {
      const workbook = await downloadWorkbook(await sessionFor("importer"));
      const sheet = workbook.getWorksheet("填写说明");
      expect(sheet).toBeDefined();

      const text: string[] = [];
      sheet?.eachRow((row) => {
        row.eachCell((cell) => {
          text.push(String(cell.value ?? ""));
        });
      });
      const combined = text.join("\n");
      expect(combined).toContain("yyyy-MM-dd HH:mm");
      expect(combined).toContain("2000");
      // every column is documented
      for (const header of EXPECTED_HEADERS) {
        expect(combined).toContain(header);
      }
      // 完结 pair: 同填同空 rule and the 导入即完结 semantics
      expect(combined).toContain("同时填写或同时留空");
      expect(combined).toContain("已完结");
    });
  });

  describe("枚举/目录列下拉", () => {
    /** Column letter (1-indexed) for a header name on the 工单 sheet. */
    function columnOf(header: string): number {
      const index = EXPECTED_HEADERS.indexOf(header);
      expect(index, header).toBeGreaterThanOrEqual(0);
      return index + 1;
    }

    it("static enum columns validate against the create form's options", async () => {
      const workbook = await downloadWorkbook(await sessionFor("importer"));
      const sheet = workbook.getWorksheet("工单");
      const options = workbook.getWorksheet("选项");
      expect(options).toBeDefined();
      // the option feed is bookkeeping, not part of the fill-in surface
      expect(options?.state).not.toBe("visible");

      const enumFields = TICKET_FIELD_DESCRIPTORS.filter(
        (descriptor): descriptor is Extract<TicketFieldDescriptor, { type: "enum" }> =>
          descriptor.type === "enum" && !("formOnly" in descriptor && descriptor.formOnly),
      );
      for (const { label: header } of enumFields) {
        const validation = sheet?.getRow(2).getCell(columnOf(header)).dataValidation;
        expect(validation?.type, header).toBe("list");
        expect(validation?.allowBlank, header).toBe(true);
        expect(validation?.formulae?.[0], header).toContain("选项");
      }

      const optionColumns: string[][] = [];
      options?.eachRow((row) => {
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          optionColumns[col] ??= [];
          optionColumns[col].push(String(cell.value ?? ""));
        });
      });
      const allOptions = optionColumns.flat();
      for (const value of enumFields.flatMap((field) =>
        field.options.map((option) => option.label),
      )) {
        expect(allOptions).toContain(value);
      }
    });

    it("渠道/客诉类别/完结状态 dropdowns hold the active catalog rows of the download instant", async () => {
      const importer = await sessionFor("importer");

      const disabledChannel = await prisma.channel.create({
        data: { name: "已停用渠道", active: false, displayOrder: 99 },
      });
      const disabledCategory = await prisma.ticketCategory.create({
        data: { name: "已停用类别", active: false, displayOrder: 99 },
      });
      const disabledCompletion = await prisma.completionStatus.create({
        data: { name: "已停用完结状态", active: false, displayOrder: 99 },
      });

      const first = await downloadWorkbook(importer);
      const collect = (workbook: ExcelJS.Workbook) => {
        const values: string[] = [];
        workbook.getWorksheet("选项")?.eachRow((row) => {
          row.eachCell((cell) => values.push(String(cell.value ?? "")));
        });
        return values;
      };

      const firstOptions = collect(first);
      expect(firstOptions).toContain("保司"); // seeded active channel
      expect(firstOptions).toContain("已达成一致"); // 迁移种子的启用完结状态
      expect(firstOptions).not.toContain(disabledChannel.name);
      expect(firstOptions).not.toContain(disabledCategory.name);
      expect(firstOptions).not.toContain(disabledCompletion.name);

      const channelColumn = columnOf("反馈渠道");
      const sheet = first.getWorksheet("工单");
      const channelValidation = sheet?.getRow(2).getCell(channelColumn).dataValidation;
      expect(channelValidation?.type).toBe("list");
      const categoryValidation = sheet?.getRow(2).getCell(columnOf("客诉类别")).dataValidation;
      expect(categoryValidation?.type).toBe("list");
      const completionValidation = sheet?.getRow(2).getCell(columnOf("完结状态")).dataValidation;
      expect(completionValidation?.type).toBe("list");
      expect(completionValidation?.allowBlank).toBe(true);

      // 停用后重新下载即消失
      const victim = await prisma.channel.findFirstOrThrow({ where: { name: "支付" } });
      const completionVictim = await prisma.completionStatus.findFirstOrThrow({
        where: { name: "正常完结" },
      });
      await prisma.channel.update({ where: { id: victim.id }, data: { active: false } });
      await prisma.completionStatus.update({
        where: { id: completionVictim.id },
        data: { active: false },
      });
      try {
        const second = collect(await downloadWorkbook(importer));
        expect(second).not.toContain("支付");
        expect(second).not.toContain("正常完结");
        expect(second).toContain("保司");
        expect(second).toContain("已达成一致");
      } finally {
        await prisma.channel.update({ where: { id: victim.id }, data: { active: true } });
        await prisma.completionStatus.update({
          where: { id: completionVictim.id },
          data: { active: true },
        });
      }
    });
    it("时效策略 dropdown 取下载时刻的启用策略（停用后重新下载即消失）", async () => {
      const importer = await sessionFor("importer");
      const first = await downloadWorkbook(importer);
      const collect = (workbook: ExcelJS.Workbook) => {
        const values: string[] = [];
        workbook.getWorksheet("选项")?.eachRow((row) => {
          row.eachCell((cell) => values.push(String(cell.value ?? "")));
        });
        return values;
      };

      expect(collect(first)).toContain("特急投诉");

      const victim = await prisma.slaPolicy.findFirstOrThrow({ where: { name: "特急投诉" } });
      await prisma.slaPolicy.update({ where: { id: victim.id }, data: { active: false } });
      try {
        const second = collect(await downloadWorkbook(importer));
        expect(second).not.toContain("特急投诉");
        expect(second).toContain("一般投诉");
      } finally {
        await prisma.slaPolicy.update({ where: { id: victim.id }, data: { active: true } });
      }

      const sheet = first.getWorksheet("工单");
      const validation = sheet?.getRow(2).getCell(columnOf("时效策略")).dataValidation;
      expect(validation?.type).toBe("list");
      expect(validation?.allowBlank).toBe(true);
    });
  });
});
