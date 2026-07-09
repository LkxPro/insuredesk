import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { ZodError } from "zod";
import type { AuthenticatedUser } from "./services/auth.service";
import type { Permission } from "@insuredesk/shared";

/**
 * Per-request context. Carries the request-level traceId so procedures and the
 * error formatter can correlate to the structured logs. After authentication,
 * also carries the authenticated user information.
 */
export type Context = {
  traceId: string;
  user: AuthenticatedUser | null;
  sessionToken: string | null;
};

export function createContext({ req }: CreateFastifyContextOptions): Context {
  // User will be set by authentication middleware in server.ts
  return {
    traceId: String(req.id),
    user: null,
    sessionToken: null,
  };
}

const t = initTRPC.context<Context>().create({
  // Standardize Zod validation failures: every error response carries a
  // field-level `zodError` alongside the default shape (ADR 0006 error handling).
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;

/**
 * Public procedure - no authentication required.
 */
export const publicProcedure = t.procedure;

/**
 * Protected procedure - requires authentication.
 * Throws UNAUTHORIZED if user is not logged in.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user, // Type refinement: user is non-null in protected procedures
    },
  });
});

/**
 * Permission-guarded procedure factory.
 * Requires authentication AND the specified permission.
 *
 * @example
 * const procedure = requirePermission("ticket.create");
 */
export function requirePermission(permission: Permission) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.user.permissions.includes(permission)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Missing required permission: ${permission}`,
      });
    }
    return next({ ctx });
  });
}
