import {
  openApiProcessLogListResponseSchema,
  openApiProcessLogsInputSchema,
  openApiTicketListResponseSchema,
  openApiTicketsInputSchema,
} from "@insuredesk/shared";
import { Validator } from "@seriousme/openapi-schema-validator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { parseEnv } from "../src/env.ts";
import { openApiMetaResponseSchema } from "../src/routes/open-api/meta.route.ts";
import { buildServer } from "../src/server.ts";
import { buildOpenApiDocument } from "../src/services/openapi-doc.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

const env = parseEnv({
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
  SESSION_SECRET: "insuredesk-openapi-doc-secret-0123456789abcde",
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  OPEN_API_ENABLED: "true",
});

const doc = buildOpenApiDocument(env) as Record<string, unknown>;

type JsonSchemaNode = Record<string, unknown>;

function stripMeta(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripMeta);
  }
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as JsonSchemaNode)
        .filter(([key]) => key !== "$schema" && key !== "description")
        .map(([key, value]) => [key, stripMeta(value)]),
    );
  }
  return node;
}

function responseJsonSchema(operation: unknown): JsonSchemaNode {
  const op = operation as {
    responses: Record<string, { content: { "application/json": { schema: JsonSchemaNode } } }>;
  };
  return op.responses["200"]?.content["application/json"].schema as JsonSchemaNode;
}

describe("openapi-doc.service 生成物契约", () => {
  it("过 @seriousme/openapi-schema-validator（OpenAPI 3.1）", async () => {
    const validator = new Validator();
    const result = await validator.validate(doc);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("路径覆盖三个数据端点且均为 GET", () => {
    const paths = doc.paths as Record<string, Record<string, unknown>>;
    expect(Object.keys(paths).sort()).toEqual([
      "/api/v1/meta",
      "/api/v1/process-logs",
      "/api/v1/tickets",
    ]);
    for (const pathItem of Object.values(paths)) {
      expect(Object.keys(pathItem)).toEqual(["get"]);
    }
  });

  it("info.description 含契约演化声明「只加字段、不改类型、不删字段、breaking 走 /api/v2」", () => {
    const info = doc.info as { description: string; version: string };
    expect(info.description).toContain("只加字段");
    expect(info.description).toContain("不改类型");
    expect(info.description).toContain("不删字段");
    expect(info.description).toContain("/api/v2");
    expect(info.version).toBe(env.APP_VERSION);
  });

  it("响应 schema 剥掉 describe 后与 zod 源逐一深等（zod 是契约唯一来源）", () => {
    const paths = doc.paths as Record<string, { get: unknown }>;
    const cases: Array<[string, unknown]> = [
      ["/api/v1/tickets", openApiTicketListResponseSchema],
      ["/api/v1/process-logs", openApiProcessLogListResponseSchema],
      ["/api/v1/meta", openApiMetaResponseSchema],
    ];
    for (const [path, source] of cases) {
      const generated = stripMeta(responseJsonSchema(paths[path]?.get));
      const fromSource = stripMeta(z.toJSONSchema(source as never));
      expect(generated, path).toEqual(fromSource);
    }
  });

  it("query 参数 schema 剥掉 describe 后与 zod 源 input 侧一致", () => {
    const paths = doc.paths as Record<
      string,
      { get: { parameters: Array<{ name: string; schema: unknown }> } }
    >;
    const cases: Array<[string, unknown]> = [
      ["/api/v1/tickets", openApiTicketsInputSchema],
      ["/api/v1/process-logs", openApiProcessLogsInputSchema],
    ];
    for (const [path, source] of cases) {
      const parameters = paths[path]?.get.parameters ?? [];
      const generated = Object.fromEntries(
        parameters.map((param) => [param.name, stripMeta(param.schema)]),
      );
      const fromSource = stripMeta(z.toJSONSchema(source as never, { io: "input" })) as {
        properties: Record<string, unknown>;
      };
      expect(generated, path).toEqual(fromSource.properties);
    }
  });

  it("字段级 describe 覆盖率：文档内每个属性/参数都有非空中文 description", () => {
    const violations: string[] = [];
    const cjk = /[一-鿿]/;

    const walk = (node: unknown, trail: string): void => {
      if (Array.isArray(node)) {
        for (const [index, item] of node.entries()) {
          walk(item, `${trail}[${index}]`);
        }
        return;
      }
      if (node === null || typeof node !== "object") {
        return;
      }
      const record = node as JsonSchemaNode;
      if (record.properties !== null && typeof record.properties === "object") {
        for (const [name, prop] of Object.entries(record.properties as JsonSchemaNode)) {
          const description = (prop as JsonSchemaNode).description;
          if (typeof description !== "string" || !cjk.test(description)) {
            violations.push(`${trail}.${name}`);
          }
          walk(prop, `${trail}.${name}`);
        }
      }
      for (const key of ["items", "additionalProperties"] as const) {
        if (record[key] !== null && typeof record[key] === "object") {
          walk(record[key], `${trail}.${key}`);
        }
      }
      for (const key of ["anyOf", "oneOf", "allOf"] as const) {
        if (Array.isArray(record[key])) {
          walk(record[key], `${trail}.${key}`);
        }
      }
      if (record.content !== null && typeof record.content === "object") {
        for (const [mediaType, media] of Object.entries(record.content as JsonSchemaNode)) {
          const schema = (media as JsonSchemaNode).schema;
          if (schema !== null && typeof schema === "object") {
            walk(schema, `${trail}.content.${mediaType}`);
          }
        }
      }
    };

    const paths = doc.paths as Record<
      string,
      {
        get: {
          parameters?: Array<{ name: string; description?: unknown }>;
          responses: Record<string, unknown>;
        };
      }
    >;
    for (const [path, pathItem] of Object.entries(paths)) {
      for (const param of pathItem.get.parameters ?? []) {
        if (typeof param.description !== "string" || !cjk.test(param.description)) {
          violations.push(`${path} 参数 ${param.name}`);
        }
      }
      for (const [status, response] of Object.entries(pathItem.get.responses)) {
        walk(response, `${path} 响应 ${status}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("每个 operation 带 summary 与中文 description，bearer 安全要求齐备", () => {
    const paths = doc.paths as Record<
      string,
      { get: { summary?: unknown; description?: unknown; security?: unknown } }
    >;
    for (const [path, pathItem] of Object.entries(paths)) {
      expect(typeof pathItem.get.summary, path).toBe("string");
      expect(/[一-鿿]/.test(String(pathItem.get.description)), path).toBe(true);
      expect(pathItem.get.security, path).toEqual([{ bearerAuth: [] }]);
    }
  });
});

describe("/api/v1/openapi.json 与 /docs/analytics (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let app: FastifyInstance;
  let appDisabled: FastifyInstance;

  beforeAll(async () => {
    harness = await startIntegrationHarness();
    const baseEnv = {
      DATABASE_URL: harness.databaseUrl,
      SESSION_SECRET: "insuredesk-openapi-doc-secret-0123456789abcde",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    };
    app = buildServer(parseEnv({ ...baseEnv, OPEN_API_ENABLED: "true" }));
    appDisabled = buildServer(parseEnv({ ...baseEnv, OPEN_API_ENABLED: "false" }));
    await Promise.all([app.ready(), appDisabled.ready()]);
  }, 180_000);

  afterAll(async () => {
    await Promise.all([app?.close(), appDisabled?.close()]);
    await harness?.stop();
  });

  it("/api/v1/openapi.json 公开可达：无 bearer 200，body 与注册表生成物一致", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(Object.keys(body.paths).sort()).toEqual([
      "/api/v1/meta",
      "/api/v1/process-logs",
      "/api/v1/tickets",
    ]);
  });

  it("OPEN_API_ENABLED=false 时 /api/v1/openapi.json 与 /docs/analytics 一并 404", async () => {
    const spec = await appDisabled.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(spec.statusCode).toBe(404);
    const docs = await appDisabled.inject({ method: "GET", url: "/docs/analytics/" });
    expect(docs.statusCode).toBe(404);
  });

  it("/docs/analytics 301 → /docs/analytics/ 200，HTML 指向 /api/v1/openapi.json", async () => {
    const bare = await app.inject({ method: "GET", url: "/docs/analytics" });
    expect(bare.statusCode).toBe(301);

    const res = await app.inject({ method: "GET", url: "/docs/analytics/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("/api/v1/openapi.json");
  });

  it("/docs 骏伯回归不变：301 → 200 且仍指向 workorder-api.yaml", async () => {
    const bare = await app.inject({ method: "GET", url: "/docs" });
    expect(bare.statusCode).toBe(301);

    const res = await app.inject({ method: "GET", url: "/docs/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("/openapi/workorder-api.yaml");
  });
});
