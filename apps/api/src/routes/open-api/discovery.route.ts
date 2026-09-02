import type { FastifyInstance } from "fastify";
import type { Env } from "../../env.ts";

export function registerDiscoveryRoute(app: FastifyInstance, env: Env) {
  app.get("/", async () => ({
    name: "InsureDesk Open API",
    version: env.APP_VERSION,
    auth: {
      scheme: "bearer",
      header: "Authorization",
      format: "Bearer sk_…",
    },
    openapi: "/api/v1/openapi.json",
    meta: "/api/v1/meta",
    docs: "/docs/analytics",
  }));
}
