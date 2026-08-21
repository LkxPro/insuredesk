import { ticketExportInputSchema } from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import { exportTickets } from "../services/ticket-export.service.ts";

/** Querystring 是扁平字符串：多选筛选按列表页 URL 约定以逗号分隔，拆分后交给 schema。 */
const MULTI_VALUE_PARAMS = [
  "status",
  "channelId",
  "categoryId",
  "completionStatusId",
  "slaPolicyId",
  "source",
] as const;

export function splitMultiValueParams(
  query: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const result = { ...query };
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "string") {
      result[key] = value.split(",").filter(Boolean);
    }
  }
  return result;
}

export function registerTicketExportRoute(app: FastifyInstance) {
  app.get("/api/tickets/export", async (req, reply) => {
    const user = req.authenticatedUser;
    if (!user) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    if (!user.permissions.includes("ticket.export")) {
      return reply.code(403).send({ error: "Missing required permission: ticket.export" });
    }

    const parsed = ticketExportInputSchema.safeParse(
      splitMultiValueParams(req.query as Record<string, unknown>, MULTI_VALUE_PARAMS),
    );
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid export query", zodError: parsed.error.flatten() });
    }

    const file = await exportTickets({ prisma, clock: systemClock }, user, parsed.data);
    return reply
      .header("content-type", file.contentType)
      .header("content-disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  });
}
