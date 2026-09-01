import { openApiErrorBody } from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { apiDb } from "../../db.ts";
import { effectivePermissions } from "../../services/auth.service.ts";

export function registerMeRoute(app: FastifyInstance) {
  app.get("/me", async (req, reply) => {
    const auth = req.apiKeyAuth;
    if (!auth?.user) {
      return reply.code(401).send(openApiErrorBody("unauthorized", "Invalid API key"));
    }
    const row = await apiDb.user.findUnique({
      where: { id: auth.user.id },
      include: { role: true },
    });
    if (!row?.active) {
      return reply.code(401).send(openApiErrorBody("unauthorized", "Invalid API key"));
    }
    const permissions = effectivePermissions(row.role);
    req.apiRowCount = 1;
    return {
      user: {
        id: row.id,
        username: row.username,
        name: row.name,
        email: row.email,
        team: row.team,
      },
      role: { id: row.role.id, name: row.role.name },
      permissions,
      dataScope: permissions.includes("ticket.view_all") ? "all" : "own",
    };
  });
}
