import { z } from "zod";

export const SESSION_SECRET_MIN_LENGTH = 32;

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SESSION_SECRET: z.string().min(SESSION_SECRET_MIN_LENGTH),
  SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),
  // Absolute (or cwd-relative) path to the built web assets (apps/web/dist).
  // Only consulted in production, where the API serves the SPA via @fastify/static.
  // Left empty in dev — Vite owns the dev server, so no static serving is wired up.
  WEB_DIST_PATH: z.string().optional(),
  // Release tag baked into the image at build time (Docker build-arg), never a
  // server-side config knob. The literal "dev" marks an un-injected build —
  // seeing it in production means the injection pipeline broke.
  APP_VERSION: z.string().min(1).default("dev"),
});

export type Env = z.infer<typeof envSchema>;

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
