import {
  type OpenApiProcessLogsQuery,
  openApiErrorBody,
  openApiProcessLogsInputSchema,
} from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { apiDb } from "../../db.ts";
import {
  listOpenApiProcessLogs,
  OpenApiInvalidCursorError,
} from "../../services/open-api-process-log.service.ts";
import { formatQueryIssues } from "./format-query-issues.ts";

function buildNextUrl(path: string, query: OpenApiProcessLogsQuery, nextCursor: string): string {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  if (query.ticketId !== undefined) {
    params.set("ticketId", query.ticketId);
  }
  if (query.updatedSince !== undefined) {
    params.set("updatedSince", query.updatedSince);
  }
  params.set("cursor", nextCursor);
  return `${path}?${params.toString()}`;
}

export function registerProcessLogsRoute(app: FastifyInstance) {
  app.get("/process-logs", async (req, reply) => {
    const user = req.apiKeyAuth?.user;
    if (!user) {
      return reply
        .code(401)
        .header("WWW-Authenticate", "Bearer")
        .send(openApiErrorBody("unauthorized", "Invalid API key"));
    }
    if (!user.permissions.includes("ticket.export")) {
      return reply
        .code(403)
        .send(openApiErrorBody("forbidden", "Missing required permission: ticket.export"));
    }

    const parsed = openApiProcessLogsInputSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          openApiErrorBody(
            "invalid_params",
            `Invalid query parameters: ${formatQueryIssues(parsed.error)}`,
          ),
        );
    }

    try {
      const result = await listOpenApiProcessLogs({ prisma: apiDb }, user, parsed.data);
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
