import {
  type OpenApiTicketsQuery,
  openApiErrorBody,
  openApiTicketsInputSchema,
} from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { systemClock } from "../../clock.ts";
import { apiDb } from "../../db.ts";
import {
  listOpenApiTickets,
  OpenApiInvalidCursorError,
} from "../../services/open-api-ticket.service.ts";
import { splitMultiValueParams } from "../ticket-export.route.ts";

const MULTI_VALUE_PARAMS = [
  "status",
  "channelId",
  "categoryId",
  "completionStatusId",
  "slaPolicyId",
  "kindId",
  "policyNumberState",
  "source",
  "fields",
] as const;

function buildNextUrl(path: string, query: OpenApiTicketsQuery, nextCursor: string): string {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  if (query.updatedSince !== undefined) {
    params.set("updatedSince", query.updatedSince);
  }
  const multi: Array<[string, readonly string[] | undefined]> = [
    ["status", query.status],
    ["channelId", query.channelId],
    ["categoryId", query.categoryId],
    ["completionStatusId", query.completionStatusId],
    ["slaPolicyId", query.slaPolicyId],
    ["kindId", query.kindId],
    ["policyNumberState", query.policyNumberState],
    ["source", query.source],
  ];
  for (const [key, values] of multi) {
    if (values !== undefined) {
      params.set(key, values.join(","));
    }
  }
  if (query.search !== undefined) {
    params.set("search", query.search);
  }
  if (query.createdFrom !== undefined) {
    params.set("createdFrom", query.createdFrom);
  }
  if (query.createdTo !== undefined) {
    params.set("createdTo", query.createdTo);
  }
  if (query.fields !== undefined) {
    params.set("fields", query.fields.join(","));
  }
  params.set("cursor", nextCursor);
  return `${path}?${params.toString()}`;
}

export function registerTicketsRoute(app: FastifyInstance) {
  app.get("/tickets", async (req, reply) => {
    const user = req.apiKeyAuth?.user;
    if (!user) {
      return reply.code(401).send(openApiErrorBody("unauthorized", "Invalid API key"));
    }
    if (!user.permissions.includes("ticket.export")) {
      return reply
        .code(403)
        .send(openApiErrorBody("forbidden", "Missing required permission: ticket.export"));
    }

    const parsed = openApiTicketsInputSchema.safeParse(
      splitMultiValueParams(req.query as Record<string, unknown>, MULTI_VALUE_PARAMS),
    );
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      return reply
        .code(400)
        .send(openApiErrorBody("invalid_params", `Invalid query parameters: ${detail}`));
    }

    try {
      const result = await listOpenApiTickets(
        { prisma: apiDb, clock: systemClock },
        user,
        parsed.data,
      );
      req.apiRowCount = result.data.length;
      return {
        data: result.data,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        nextUrl:
          result.nextCursor === null
            ? null
            : buildNextUrl((req.raw.url ?? "").split("?")[0] ?? "", parsed.data, result.nextCursor),
      };
    } catch (error) {
      if (error instanceof OpenApiInvalidCursorError) {
        return reply.code(400).send(openApiErrorBody("invalid_cursor", error.message));
      }
      throw error;
    }
  });
}
