import type { FastifyInstance } from "fastify";
import type { Env } from "../../env.ts";
import { buildOpenApiDocument } from "../../services/openapi-doc.service.ts";

export function registerOpenapiJsonRoute(app: FastifyInstance, env: Env) {
  const document = buildOpenApiDocument(env);
  app.get("/openapi.json", async () => document);
}
