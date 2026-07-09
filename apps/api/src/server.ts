import { randomUUID } from "node:crypto";
import { type FastifyTRPCPluginOptions, fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import type { Env } from "./env";
import { type AppRouter, appRouter } from "./routers";
import { createContext } from "./trpc";

/**
 * Build the Fastify app with tRPC mounted at /trpc. Logging is structured pino
 * (Fastify-native) with a per-request `traceId`; pretty-printed only in dev.
 * Extracted from the entrypoint so tests can build the app without listening.
 */
export function buildServer(env: Env) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
            },
          }
        : {}),
    },
    // A unique id per request; reused as the traceId on the request logger.
    genReqId: () => randomUUID(),
    requestIdHeader: "x-request-id",
  });

  // Surface the per-request id as `traceId` on every request-scoped log line.
  app.addHook("onRequest", (req, _reply, done) => {
    req.log = req.log.child({ traceId: req.id });
    done();
  });

  // No CORS plugin: the web app talks to the API same-origin — via the Vite
  // proxy in dev (see apps/web/vite.config.ts) and behind a shared reverse
  // proxy in prod. A cross-origin deployment would add @fastify/cors here.

  app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error, ctx }) {
        // ctx.traceId ties the failure line back to the request's log stream.
        app.log.error({ path, traceId: ctx?.traceId, err: error.message }, "tRPC request failed");
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  // Plain HTTP liveness endpoint for infra/load-balancer probes.
  app.get("/healthz", () => ({ status: "ok" }));

  return app;
}
