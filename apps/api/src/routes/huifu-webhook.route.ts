import { HUIFU_WEBHOOK_PATH } from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import type { Env } from "../env.ts";
import { HuifuWebhookError, receiveHuifuWebhook } from "../services/huifu-webhook.service.ts";

export function registerHuifuWebhookRoute(app: FastifyInstance, env: Env) {
  app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
      done(null, body);
    });
    scope.post<{ Querystring: { sign?: string } }>(
      HUIFU_WEBHOOK_PATH,
      { bodyLimit: 256 * 1024 },
      async (req, reply) => {
        const merchantIds = (env.HUIFU_WEBHOOK_MERCHANT_IDS ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        const secret = env.HUIFU_WEBHOOK_SECRET;
        if (!secret || merchantIds.length === 0) {
          return reply.code(503).send("webhook not configured");
        }
        const headerSign = req.headers.sign;
        const querySign = req.query.sign;
        if (
          (headerSign !== undefined && typeof headerSign !== "string") ||
          (querySign !== undefined && typeof querySign !== "string") ||
          (headerSign && querySign && headerSign.toLowerCase() !== querySign.toLowerCase())
        ) {
          return reply.code(401).send("invalid signature");
        }
        if (typeof req.body !== "string") return reply.code(400).send("invalid body");
        try {
          await receiveHuifuWebhook(
            { prisma, clock: systemClock },
            { rawBody: req.body, sign: headerSign ?? querySign, secret, merchantIds },
          );
          return reply.type("text/plain").send("success");
        } catch (error) {
          if (error instanceof HuifuWebhookError) {
            return reply.code(error.statusCode).send(error.message);
          }
          req.log.error("huifu webhook persistence failed");
          return reply.code(503).send("temporarily unavailable");
        }
      },
    );
  });
}
