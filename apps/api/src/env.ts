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
  WEB_DIST_PATH: z.string().optional(),
  OPENAPI_WORKORDER_PATH: z.string().optional(),
  // 版本由镜像构建注入，不由服务器配置；生产环境出现 dev 表示注入失败。
  APP_VERSION: z.string().min(1).default("dev"),
  JB_INSURANCE_PUSH_TOKEN: z.string().optional(),
  JB_INSURANCE_CALLBACK_URL: z.string().url().optional(),
  JB_INSURANCE_CALLBACK_SECRET: z.string().optional(),
  HUIFU_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9]{32}$/)
    .optional(),
  HUIFU_WEBHOOK_MERCHANT_IDS: z.string().optional(),
  HUIFU_WEBHOOK_SLA_POLICY_ID: z.string().min(1).optional(),
  OPEN_API_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
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
