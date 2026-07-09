import { initTRPC } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { ZodError } from "zod";

/**
 * Per-request context. Carries the request-level traceId so procedures and the
 * error formatter can correlate to the structured logs. DB-backed procedures
 * will add their dependencies here as the domain features land.
 */
export type Context = {
  traceId: string;
};

export function createContext({ req }: CreateFastifyContextOptions): Context {
  return { traceId: String(req.id) };
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
export const publicProcedure = t.procedure;
