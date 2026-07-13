import { ticketExportInputSchema } from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { systemClock } from "../clock";
import { prisma } from "../db";
import { exportTickets } from "../services/ticket-export.service";

/**
 * 导出工单 download endpoint. REST rather than tRPC because the response is
 * a file, not JSON — same reasoning as the auth endpoints, and the route
 * reuses the same service + Zod schema. The session hook has already
 * populated req.authenticatedUser, so the guard order mirrors the tRPC
 * middlewares: 401 unauthenticated, 403 without ticket.export (UI 无入口、
 * API 拒绝), 400 on a query the shared schema rejects.
 */
export function registerTicketExportRoute(app: FastifyInstance) {
  app.get("/api/tickets/export", async (req, reply) => {
    const user = req.authenticatedUser;
    if (!user) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    if (!user.permissions.includes("ticket.export")) {
      return reply.code(403).send({ error: "Missing required permission: ticket.export" });
    }

    const parsed = ticketExportInputSchema.safeParse(req.query);
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
