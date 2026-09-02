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

function buildNextUrl(path: string, query: OpenApiProcessLogsQuery, nextCursor: string): string {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  if (query.ticketId !== undefined) {
    params.set("ticketId", query.ticketId);
  }
  if (query.since !== undefined) {
    params.set("since", query.since);
  }
  params.set("cursor", nextCursor);
  return `${path}?${params.toString()}`;
}

export function registerProcessLogsRoute(app: FastifyInstance) {
  app.get("/process-logs", async (req, reply) => {
    const user = req.apiKeyAuth?.user;
    if (!user) {
      return reply.code(401).send(openApiErrorBody("unauthorized", "Invalid API key"));
    }
    if (!user.permissions.includes("ticket.export")) {
      return reply
        .code(403)
        .send(openApiErrorBody("forbidden", "Missing required permission: ticket.export"));
    }

    const parsed = openApiProcessLogsInputSchema.safeParse(req.query);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      return reply
        .code(400)
        .send(openApiErrorBody("invalid_params", `Invalid query parameters: ${detail}`));
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
