import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { loginBodySchema } from "@insuredesk/shared";
import { type FastifyTRPCPluginOptions, fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "./db.ts";
import type { Env } from "./env.ts";
import { type AppRouter, appRouter } from "./routers/index.ts";
import { registerExternalTicketExportRoute } from "./routes/external-ticket-export.route.ts";
import { registerTicketExportRoute } from "./routes/ticket-export.route.ts";
import { registerTicketImportRoute } from "./routes/ticket-import.route.ts";
import { registerTicketImportTemplateRoute } from "./routes/ticket-import-template.route.ts";
import { PasswordAuthProvider, SessionService, toSessionToken } from "./services/auth.service.ts";
import { createContext } from "./trpc.ts";

/**
 * Build the Fastify app with tRPC mounted at /trpc. Logging is structured pino
 * (Fastify-native) with a per-request `traceId`; pretty-printed only in dev.
 * Extracted from the entrypoint so tests can build the app without listening.
 */
export function buildServer(env: Env) {
  const app = Fastify({
    // httpBatchLink packs every procedure name of a batch into ONE path
    // segment; Fastify's 100-char default rejects those with a 414 whose body
    // isn't a tRPC envelope, so the client surfaces "Unable to transform
    // response from server" instead of anything actionable. 工单管理 alone
    // batches 5 procedures / 111 chars.
    routerOptions: { maxParamLength: 5000 },
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

  app.register(fastifyCookie, {
    secret: env.SESSION_SECRET,
    hook: "onRequest",
  });

  const sessionService = new SessionService(prisma, env.SESSION_MAX_AGE_SECONDS);
  const authProvider = new PasswordAuthProvider(prisma);

  // Session extraction middleware: read session cookie and populate request context
  app.addHook("onRequest", async (req, reply) => {
    const rawCookie = req.cookies.session;
    if (!rawCookie) {
      return;
    }
    const sessionToken = toSessionToken(rawCookie);
    const user = await sessionService.validateSession(sessionToken);
    if (user) {
      // Store user on the request for the tRPC context (see createContext)
      req.authenticatedUser = user;
      req.sessionToken = sessionToken;
    } else {
      reply.clearCookie("session");
    }
  });

  // REST endpoint for login (easier cookie handling than tRPC)
  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Username and password required" });
    }
    const { username, password } = parsed.data;

    const userId = await authProvider.authenticate({ username, password });

    if (!userId) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    const token = await sessionService.createSession(userId);
    const user = await sessionService.validateSession(token);

    if (!user) {
      return reply.code(500).send({ error: "Failed to create session" });
    }

    reply.setCookie("session", token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: env.SESSION_MAX_AGE_SECONDS,
      path: "/",
    });

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        roleId: user.roleId,
        roleName: user.roleName,
        permissions: user.permissions,
      },
    };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    // Only set by the session hook when the cookie held a *valid* session;
    // deleting a stale token is a no-op anyway.
    if (req.sessionToken) {
      await sessionService.deleteSession(req.sessionToken);
    }
    reply.clearCookie("session");
    return { success: true };
  });

  // File downloads/uploads for 导出工单 / 导入模板 / 批量导入 — REST like the
  // auth endpoints.
  registerTicketExportRoute(app);
  registerExternalTicketExportRoute(app);
  registerTicketImportTemplateRoute(app);
  registerTicketImportRoute(app);

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

  // In production the API also serves the built SPA: a single
  // container fronts both the tRPC API and the static frontend, behind the
  // host's nginx. In dev this is skipped — Vite owns the dev server.
  if (env.NODE_ENV === "production") {
    registerStaticFrontend(app, env);
  }

  return app;
}

/**
 * Resolve the built web assets directory. Prefer the explicit WEB_DIST_PATH
 * (set in the container / prod env); otherwise fall back to the monorepo
 * layout relative to this source file (apps/api/src → apps/web/dist).
 */
function resolveWebDistPath(env: Env): string {
  if (env.WEB_DIST_PATH) {
    return resolve(env.WEB_DIST_PATH);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "web", "dist");
}

/**
 * Serve apps/web/dist and fall back to index.html for client-side routes.
 *
 * `wildcard: false` makes @fastify/static register a route per real file
 * instead of a catch-all `/*`, so it never shadows `/trpc/*` or `/healthz`.
 * Anything left unmatched (a deep SPA link like /tickets/123) reaches the
 * notFound handler, which returns the SPA shell — but only for GET navigations
 * that aren't API calls, so unknown `/trpc` paths still get tRPC's JSON 404.
 */
function registerStaticFrontend(app: FastifyInstance, env: Env) {
  const root = resolveWebDistPath(env);

  app.register(fastifyStatic, {
    root,
    wildcard: false,
    index: ["index.html"],
  });

  app.setNotFoundHandler((req, reply) => {
    const isApiPath = req.url.startsWith("/trpc") || req.url.startsWith("/api");
    if (req.method === "GET" && !isApiPath) {
      return reply.code(200).type("text/html").sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not Found" });
  });
}
