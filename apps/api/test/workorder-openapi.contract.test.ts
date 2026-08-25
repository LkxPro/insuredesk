import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  callbackPlaintextSchema,
  refundTradePushSchema,
  workOrderPushSchema,
} from "@insuredesk/shared";
import { Validator } from "@seriousme/openapi-schema-validator";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, "../../../docs/退费异常类工单/workorder-api.openapi.yaml");

describe("workorder openapi contract", () => {
  it("is valid OpenAPI 3.1", async () => {
    const raw = parse(await readFile(specPath, "utf8"));
    const validator = new Validator();
    const result = await validator.validate(raw as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  it("keeps request/response schemas aligned with shared zod contracts", async () => {
    const raw = parse(await readFile(specPath, "utf8"));
    const validator = new Validator();
    const resolved = validator.resolveRefs({ specification: raw as Record<string, unknown> });
    const openapiSchemas = (resolved.components as Record<string, unknown>).schemas as Record<
      string,
      unknown
    >;

    expect(openapiSchemas.WorkOrderPush).toMatchObject(toOpenApiShape(workOrderPushSchema));
    expect(openapiSchemas.RefundTrade).toMatchObject(toOpenApiShape(refundTradePushSchema));
    expect(openapiSchemas.CallbackPlaintext).toMatchObject(toOpenApiShape(callbackPlaintextSchema));
  });
});

function toOpenApiShape(schema: unknown) {
  const json = z.toJSONSchema(schema as never, { target: "draft-7", io: "input" }) as Record<
    string,
    unknown
  >;
  return {
    type: json.type,
    required: json.required,
    properties: Object.fromEntries(
      Object.entries(json.properties ?? {}).map(([key, value]) => {
        const prop = value as Record<string, unknown>;
        const out: Record<string, unknown> = { type: prop.type };
        if (prop.pattern) out.pattern = prop.pattern;
        if (prop.minItems !== undefined) out.minItems = prop.minItems;
        if (prop.maxItems !== undefined) out.maxItems = prop.maxItems;
        if (prop.items && typeof prop.items === "object") {
          const items = prop.items as Record<string, unknown>;
          if ("$ref" in items) out.items = items;
        }
        return [key, out];
      }),
    ),
  };
}
