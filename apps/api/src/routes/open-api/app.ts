import { type OpenApiErrorCode, openApiErrorBody } from "@insuredesk/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { apiDb } from "../../db.ts";
import type { Env } from "../../env.ts";
import { writeApiAccessLog } from "../../services/api-access-log.service.ts";
import {
  hashApiKey,
  type ValidateApiKeyResult,
  validateApiKey,
} from "../../services/api-key.service.ts";
import {
  ApiRateLimiter,
  FailedAuthAttempts,
  OPEN_API_FAILED_AUTH_RATE_LIMIT,
  OPEN_API_RATE_LIMIT,
} from "../../services/api-rate-limit.service.ts";
import type { AuthenticatedUser } from "../../services/auth.service.ts";
import { registerDiscoveryRoute } from "./discovery.route.ts";
import { registerMeRoute } from "./me.route.ts";
import { registerMetaRoute } from "./meta.route.ts";
import { registerOpenapiJsonRoute } from "./openapi-json.route.ts";
import { registerProcessLogsRoute } from "./process-logs.route.ts";
import { registerTicketsRoute } from "./tickets.route.ts";

export const OPEN_API_PREFIX = "/api/v1";

export interface ApiKeyAuthContext {
  keyId: string;
  userId: string;
  user?: AuthenticatedUser;
  at: Date;
}

declare module "fastify" {
  interface FastifyRequest {
    apiKeyAuth?: ApiKeyAuthContext;
    apiRowCount?: number;
  }
}

export interface OpenApiErrorMapping {
  statusCode: number;
  code: OpenApiErrorCode;
  message: string;
}

function matchesInChain(
  error: unknown,
  predicate: (entry: { code?: unknown; message?: unknown }) => boolean,
): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (predicate(current)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// PrismaPg 对未特判的 PG 错误原样包 DriverAdapterError（cause.code 保留 sqlstate），
// $queryRaw 路径则改包 P2010、sqlstate 只留在消息文本里——两种形态都要认。
function isPgStatementTimeout(error: unknown): boolean {
  return matchesInChain(
    error,
    (entry) =>
      entry.code === "57014" ||
      (typeof entry.message === "string" &&
        (entry.message.includes("57014") || entry.message.includes("statement timeout"))),
  );
}

// pg-pool 取连接超时是不带 code 的裸 Error，只能认消息文本。
function isPoolAcquireTimeout(error: unknown): boolean {
  return matchesInChain(
    error,
    (entry) =>
      typeof entry.message === "string" &&
      entry.message.includes("timeout exceeded when trying to connect"),
  );
}

export function mapOpenApiError(error: unknown): OpenApiErrorMapping {
  if (isPoolAcquireTimeout(error)) {
    return { statusCode: 503, code: "concurrency_limit", message: "Too many concurrent requests" };
  }
  if (isPgStatementTimeout(error)) {
    return { statusCode: 504, code: "query_timeout", message: "Query exceeded time limit" };
  }
  if ((error as { statusCode?: unknown }).statusCode === 400) {
    return { statusCode: 400, code: "invalid_params", message: "Invalid request parameters" };
  }
  return { statusCode: 500, code: "internal_error", message: "Internal server error" };
}

const PUBLIC_REQUESTS = new Set([
  `GET ${OPEN_API_PREFIX}`,
  `GET ${OPEN_API_PREFIX}/`,
  `GET ${OPEN_API_PREFIX}/openapi.json`,
]);

function requestPath(req: FastifyRequest): string {
  return (req.raw.url ?? "").split("?")[0] ?? "";
}

function isPublicRequest(req: FastifyRequest): boolean {
  return PUBLIC_REQUESTS.has(`${req.method} ${requestPath(req)}`);
}

function endpointOf(req: FastifyRequest): string {
  return `${req.method} ${req.routeOptions.url ?? requestPath(req)}`;
}

async function bearerAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  failedAuthLimiter: ApiRateLimiter,
  failedAuthAttempts: FailedAuthAttempts,
): Promise<unknown> {
  if (isPublicRequest(req)) {
    return undefined;
  }
  // 失败认证按来源 IP 限流，gate 先于 token 解析：缺失/畸形 Authorization 的 401
  // 同样耗桶。扣减在同步调用内完成（Node 单线程），check/consume 分离会在
  // 查库的 await 间隙被并发无效请求整体穿透。桶空直接 429（fail-closed：锁定期
  // 同 IP 的有效 key 一并 429），无限探测打不到 api_keys 表。日志永不带 token 本身。
  const gate = failedAuthLimiter.consume(req.ip);
  if (!gate.allowed) {
    req.log.warn(
      {
        endpoint: endpointOf(req),
        ip: req.ip,
        failedAttempts: failedAuthAttempts.peek(req.ip),
      },
      "open api rejected: failed auth rate limited",
    );
    return reply
      .code(429)
      .header("Retry-After", String(gate.retryAfterSeconds))
      .send(openApiErrorBody("rate_limited", "Too many failed authentication attempts"));
  }
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
  if (!token) {
    const failedAttempts = failedAuthAttempts.bump(req.ip);
    req.log.warn(
      { endpoint: endpointOf(req), ip: req.ip, failedAttempts },
      "open api rejected: no bearer token",
    );
    return reply
      .code(401)
      .header("WWW-Authenticate", "Bearer")
      .send(openApiErrorBody("unauthorized", "Missing or malformed Authorization header"));
  }
  // 预扣的 token 在认证通过（含 external_role 的有效 key）或查库异常时回补：
  // 净效果只有认证失败耗桶。
  let result: ValidateApiKeyResult;
  try {
    result = await validateApiKey(apiDb, token);
  } catch (error) {
    failedAuthLimiter.refund(req.ip);
    throw error;
  }
  if (result.ok) {
    failedAuthLimiter.refund(req.ip);
    req.apiKeyAuth = {
      keyId: result.keyId,
      userId: result.user.id,
      user: result.user,
      at: new Date(),
    };
    return undefined;
  }
  if (result.reason === "external_role") {
    failedAuthLimiter.refund(req.ip);
    const key = await apiDb.apiKey.findUnique({
      where: { keyHash: hashApiKey(token) },
      select: { id: true, userId: true },
    });
    if (key) {
      req.apiKeyAuth = { keyId: key.id, userId: key.userId, at: new Date() };
    }
    req.log.warn({ endpoint: endpointOf(req) }, "open api rejected: external role key");
    return reply
      .code(403)
      .send(openApiErrorBody("forbidden", "API key is not permitted on the open API"));
  }
  const failedAttempts = failedAuthAttempts.bump(req.ip);
  req.log.warn(
    { endpoint: endpointOf(req), reason: result.reason, ip: req.ip, failedAttempts },
    "open api rejected: invalid key",
  );
  return reply
    .code(401)
    .header("WWW-Authenticate", "Bearer")
    .send(
      openApiErrorBody(
        "unauthorized",
        result.reason === "expired" ? "API key expired" : "Invalid or revoked API key",
      ),
    );
}

async function rateLimitByKey(
  req: FastifyRequest,
  reply: FastifyReply,
  limiter: ApiRateLimiter,
): Promise<unknown> {
  const auth = req.apiKeyAuth;
  if (!auth?.user) {
    return undefined;
  }
  const decision = limiter.consume(auth.keyId);
  if (!decision.allowed) {
    return reply
      .code(429)
      .header("Retry-After", String(decision.retryAfterSeconds))
      .send(openApiErrorBody("rate_limited", "Rate limit exceeded"));
  }
  return undefined;
}

async function auditOnSend(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = req.apiKeyAuth;
  if (!auth) {
    return;
  }
  const statusCode = reply.statusCode;
  // 401 不落库（认证失败无 key 可归因）；已认证请求的 400/404 同样留痕。
  if (statusCode === 401) {
    return;
  }
  await writeApiAccessLog(
    { prisma: apiDb },
    {
      keyId: auth.keyId,
      userId: auth.userId,
      endpoint: endpointOf(req),
      statusCode,
      durationMs: Math.round(reply.elapsedTime),
      rowCount: req.apiRowCount ?? 0,
      ip: req.ip,
      requestId: String(req.id),
      at: auth.at,
    },
    req.log,
  );
}

export function registerOpenApi(app: FastifyInstance, env: Env): void {
  if (!env.OPEN_API_ENABLED) {
    return;
  }
  app.register(
    async (scope) => {
      const rateLimiter = new ApiRateLimiter(OPEN_API_RATE_LIMIT);
      const failedAuthLimiter = new ApiRateLimiter(OPEN_API_FAILED_AUTH_RATE_LIMIT);
      const failedAuthAttempts = new FailedAuthAttempts();

      scope.setErrorHandler((error, req, reply) => {
        const mapped = mapOpenApiError(error);
        req.log[mapped.statusCode >= 500 ? "error" : "warn"](
          { err: error, code: mapped.code },
          "open api request failed",
        );
        if (mapped.statusCode === 503) {
          reply.header("Retry-After", "1");
        }
        return reply.code(mapped.statusCode).send(openApiErrorBody(mapped.code, mapped.message));
      });

      scope.addHook("onRequest", (req, reply) =>
        bearerAuth(req, reply, failedAuthLimiter, failedAuthAttempts),
      );
      scope.addHook("onRequest", (req, reply) => rateLimitByKey(req, reply, rateLimiter));
      // 审计挂在 onSend（发送前被 await）：onResponse 时客户端已拿到响应，
      // 异步写库与请求生命周期脱钩，审计会丢。
      scope.addHook("onSend", async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        await auditOnSend(req, reply);
      });
      // scope 级 setNotFoundHandler 是 hook 进入未命中路径的唯一入口：缺了它，
      // /api/v1/* 的 404 走根默认 handler，认证/no-store 全部旁路。
      scope.setNotFoundHandler((req, reply) =>
        reply
          .code(404)
          .send(openApiErrorBody("not_found", `Route ${req.method}:${req.url} not found`)),
      );

      registerDiscoveryRoute(scope, env);
      registerMeRoute(scope);
      registerTicketsRoute(scope);
      registerProcessLogsRoute(scope);
      registerMetaRoute(scope, env);
      registerOpenapiJsonRoute(scope, env);
    },
    { prefix: OPEN_API_PREFIX },
  );
}
