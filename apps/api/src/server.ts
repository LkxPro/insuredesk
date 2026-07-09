import { randomUUID } from "node:crypto";
import { type FastifyTRPCPluginOptions, fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import type { Env } from "./env";
import { type AppRouter, appRouter } from "./routers";
import { SessionService, PasswordAuthProvider } from "./services/auth.service";
import { prisma } from "./db";

/**
 * Build the Fastify app with tRPC mounted at /trpc. Logging is structured pino
 * (Fastify-native) with a per-request `traceId`; pretty-printed only in dev.
 * Extracted from the entrypoint so tests can build the app without listening.
 *
 * Enhanced with session-based authentication (issue #2):
 * - httpOnly session cookies
 * - Session extraction middleware that populates ctx.user
 * - REST endpoints for login/logout (easier cookie handling than tRPC)
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

  // Register cookie plugin for httpOnly session cookies
  app.register(fastifyCookie, {
    secret: env.SESSION_SECRET,
    hook: "onRequest",
  });

  // Session service for validating session tokens
  const sessionService = new SessionService(prisma, env.SESSION_MAX_AGE_SECONDS);
  const authProvider = new PasswordAuthProvider(prisma);

  // Session extraction middleware: read session cookie and populate request context
  app.addHook("onRequest", async (req, reply) => {
    const sessionToken = req.cookies.session;
    if (sessionToken) {
      const user = await sessionService.validateSession(sessionToken);
      if (user) {
        // Store user in request for tRPC context
        (req as any).authenticatedUser = user;
        (req as any).sessionToken = sessionToken;
      } else {
        // Invalid/expired session - clear the cookie
        reply.clearCookie("session");
      }
    }
  });

  // REST endpoint for login (easier cookie handling than tRPC)
  app.post("/api/auth/login", async (req, reply) => {
    const body = req.body as any;
    const { username, password } = body;

    if (!username || !password) {
      return reply.code(400).send({ error: "Username and password required" });
    }

    // Authenticate user
    const userId = await authProvider.authenticate({ username, password });

    if (!userId) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    // Create session
    const token = await sessionService.createSession(userId);
    const user = await sessionService.validateSession(token);

    if (!user) {
      return reply.code(500).send({ error: "Failed to create session" });
    }

    // Set httpOnly cookie
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

  // REST endpoint for logout
  app.post("/api/auth/logout", async (req, reply) => {
    const sessionToken = req.cookies.session;
    if (sessionToken) {
      await sessionService.deleteSession(sessionToken);
    }
    reply.clearCookie("session");
    return { success: true };
  });

  // No CORS plugin: the web app talks to the API same-origin — via the Vite
  // proxy in dev (see apps/web/vite.config.ts) and behind a shared reverse
  // proxy in prod. A cross-origin deployment would add @fastify/cors here.

  app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext: ({ req }) => {
        // Inject authenticated user from session middleware into tRPC context
        return {
          traceId: String(req.id),
          user: (req as any).authenticatedUser || null,
          sessionToken: (req as any).sessionToken || null,
        };
      },
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
