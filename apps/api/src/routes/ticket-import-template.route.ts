import type { FastifyInstance } from "fastify";
import { prisma } from "../db.ts";
import { buildTicketImportTemplate } from "../services/ticket-import-template.service.ts";

/**
 * 批量导入 template download. REST rather than tRPC because the response is a
 * file — same reasoning and guard order as /api/tickets/export: 401
 * unauthenticated, 403 without ticket.import (UI 无入口、API 拒绝).
 */
export function registerTicketImportTemplateRoute(app: FastifyInstance) {
  app.get("/api/tickets/import-template", async (req, reply) => {
    const user = req.authenticatedUser;
    if (!user) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    if (!user.permissions.includes("ticket.import")) {
      return reply.code(403).send({ error: "Missing required permission: ticket.import" });
    }

    const file = await buildTicketImportTemplate(prisma);
    return reply
      .header("content-type", file.contentType)
      .header("content-disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  });
}
