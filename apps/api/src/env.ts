import { z } from "zod";

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
  SESSION_SECRET: z.string().min(32),
  SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400), // 24 hours
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
