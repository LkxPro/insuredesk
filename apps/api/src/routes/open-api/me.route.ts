import { openApiErrorBody } from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { apiDb } from "../../db.ts";
import { effectivePermissions } from "../../services/auth.service.ts";

export const openApiMeResponseSchema = z
  .object({
    user: z
      .object({
        id: z.string(),
        username: z.string(),
        name: z.string(),
        email: z.string().nullable(),
        team: z.string().nullable(),
      })
      .strict(),
    role: z.object({ id: z.string(), name: z.string() }).strict(),
    permissions: z.array(z.string()),
    dataScope: z.enum(["all", "own"]),
  })
  .strict();

export type OpenApiMeResponse = z.infer<typeof openApiMeResponseSchema>;

export function registerMeRoute(app: FastifyInstance) {
  app.get("/me", async (req, reply) => {
    const auth = req.apiKeyAuth;
    if (!auth?.user) {
      return reply
        .code(401)
        .header("WWW-Authenticate", "Bearer")
        .send(openApiErrorBody("unauthorized", "Invalid API key"));
    }
    const row = await apiDb.user.findUnique({
      where: { id: auth.user.id },
      include: { role: true },
    });
    if (!row?.active) {
      return reply
        .code(401)
        .header("WWW-Authenticate", "Bearer")
        .send(openApiErrorBody("unauthorized", "Invalid API key"));
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
    } satisfies OpenApiMeResponse;
  });
}
