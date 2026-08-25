import { externalTicketExportInputSchema } from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import { exportExternalTickets } from "../services/external-ticket-export.service.ts";
import { splitMultiValueParams } from "./ticket-export.route.ts";

export function registerExternalTicketExportRoute(app: FastifyInstance) {
  app.get("/api/external-tickets/export", async (req, reply) => {
    const user = req.authenticatedUser;
    if (!user) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    if (!user.isExternal) {
      return reply.code(403).send({ error: "该入口仅限外部账号使用" });
    }

    const parsed = externalTicketExportInputSchema.safeParse(
      splitMultiValueParams(req.query as Record<string, unknown>, ["status"]),
    );
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid export query", zodError: parsed.error.flatten() });
    }

    const file = await exportExternalTickets({ prisma, clock: systemClock }, user, parsed.data);
    return reply
      .header("content-type", file.contentType)
      .header("content-disposition", `attachment; filename="${file.filename}"`)
      .send(file.body);
  });
}
