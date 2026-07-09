import { z } from "zod";

/**
 * Minimum length for SESSION_SECRET: 32 chars of random material (128 bits
 * if hex) is enough for cookie signing.
 */
export const SESSION_SECRET_MIN_LENGTH = 32;

/**
 * Environment contract. Validated once at startup; a missing or malformed var
 * crashes the process rather than letting a misconfigured server boot.
 */
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Session configuration for httpOnly cookie-based auth
  SESSION_SECRET: z.string().min(SESSION_SECRET_MIN_LENGTH),
  SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400), // 24 hours
  // Absolute (or cwd-relative) path to the built web assets (apps/web/dist).
  // Only consulted in production, where the API serves the SPA via @fastify/static.
  // Left empty in dev — Vite owns the dev server, so no static serving is wired up.
  WEB_DIST_PATH: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables. Throws with a readable, multi-line
 * message listing every offending variable. Accepts an explicit source so it is
 * unit-testable without mutating `process.env`.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
