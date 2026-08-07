import { externalTicketExportInputSchema } from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { systemClock } from "../clock";
import { prisma } from "../db";
import { exportExternalTickets } from "../services/external-ticket-export.service";

function normalizeQuery(query: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...query };
  for (const key of ["status", "completionStatusId"] as const) {
    const value = normalized[key];
    if (typeof value === "string") normalized[key] = value.split(",").filter(Boolean);
  }
  return normalized;
}

export function registerExternalTicketExportRoute(app: FastifyInstance) {
  app.get("/api/external-tickets/export", async (request, reply) => {
    const user = request.authenticatedUser;
    if (!user) return reply.code(401).send({ error: "Authentication required" });
    if (!user.isExternal || !user.permissions.includes("ticket.create_external")) {
      return reply.code(403).send({ error: "External account required" });
    }

    const parsed = externalTicketExportInputSchema.safeParse(
      normalizeQuery(request.query as Record<string, unknown>),
    );
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid export query", zodError: parsed.error.flatten() });
    }

    const file = await exportExternalTickets(prisma, user, parsed.data, systemClock.now());
    return reply
      .header("content-type", file.contentType)
      .header("content-disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  });
}
