import { createHash, randomBytes } from "node:crypto";
import {
  type ApiKeyCreateData,
  type ApiKeyCreated,
  type ApiKeyListItem,
  type ApiKeyRevokeAllInput,
  type ApiKeyRevokeInput,
  isExternalRole,
} from "@insuredesk/shared";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { type AuthenticatedUser, effectivePermissions } from "./auth.service.ts";

export const API_KEY_TOKEN_PREFIX = "sk_";
export const API_KEY_LIMIT_PER_USER = 10;
const LAST_USED_THROTTLE_MS = 60_000;

export class ApiKeyLimitError extends Error {
  constructor() {
    super(`API key 数量已达上限（${API_KEY_LIMIT_PER_USER}）`);
    this.name = "ApiKeyLimitError";
  }
}

export class ApiKeyNotFoundError extends Error {
  constructor() {
    super("API key 不存在");
    this.name = "ApiKeyNotFoundError";
  }
}

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

interface Deps {
  prisma: PrismaClient;
}

function toListItem(row: {
  id: string;
  name: string;
  status: string;
  keyPreview: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}): ApiKeyListItem {
  const now = new Date();
  const derivedStatus =
    row.status === "active" && row.expiresAt && row.expiresAt < now ? "expired" : row.status;
  return {
    id: row.id,
    name: row.name,
    status: derivedStatus as ApiKeyListItem["status"],
    keyPreview: row.keyPreview,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listApiKeys(
  { prisma }: Deps,
  user: AuthenticatedUser,
  includeRevoked = false,
): Promise<ApiKeyListItem[]> {
  const rows = await prisma.apiKey.findMany({
    where: {
      userId: user.id,
      ...(includeRevoked ? {} : { status: { not: "revoked" } }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return rows.map(toListItem);
}

/**
 * 明文只活在返回值里：库内落 sha256，响应离开进程后无任何途径再取回。
 * 上限按「未吊销」计数：并发 create 在 READ COMMITTED 下互相看不见对方的
 * 未提交行，裸 count+insert 会超发——先按 userId 取事务级咨询锁把计数串行化。
 */
export async function createApiKey(
  { prisma }: Deps,
  user: AuthenticatedUser,
  input: ApiKeyCreateData,
  requestId?: string,
): Promise<ApiKeyCreated> {
  const token = `${API_KEY_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  const keyHash = hashApiKey(token);
  const keyPreview = token.slice(-8);

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
    const existing = await tx.apiKey.count({ where: { userId: user.id, status: "active" } });
    if (existing >= API_KEY_LIMIT_PER_USER) {
      throw new ApiKeyLimitError();
    }
    const row = await tx.apiKey.create({
      data: {
        name: input.name,
        keyHash,
        keyPreview,
        userId: user.id,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    await tx.apiKeyAuditLog.create({
      data: {
        actorId: user.id,
        action: "create",
        targetKeyId: row.id,
        targetUserId: user.id,
        keyName: row.name,
        keyPreview: row.keyPreview,
        requestId,
      },
    });
    return row;
  });
  return { ...toListItem(created), key: token };
}

/** 吊销幂等：已吊销照报成功；他人 key 与不存在同按 404 拒绝（不泄露存在性）。 */
export async function revokeApiKey(
  { prisma }: Deps,
  user: AuthenticatedUser,
  input: ApiKeyRevokeInput,
  requestId?: string,
): Promise<{ id: string }> {
  const key = await prisma.apiKey.findFirst({
    where: { id: input.id, userId: user.id },
    select: { id: true, status: true, name: true, keyPreview: true },
  });
  if (!key) {
    throw new ApiKeyNotFoundError();
  }
  if (key.status === "active") {
    await prisma.$transaction(async (tx) => {
      // 并发重复吊销由条件更新兜住：只有把 active 翻成 revoked 的那次记审计。
      const { count } = await tx.apiKey.updateMany({
        where: { id: key.id, status: "active" },
        data: { status: "revoked" },
      });
      if (count === 1) {
        await tx.apiKeyAuditLog.create({
          data: {
            actorId: user.id,
            action: "revoke",
            targetKeyId: key.id,
            targetUserId: user.id,
            keyName: key.name,
            keyPreview: key.keyPreview,
            requestId,
          },
        });
      }
    });
  }
  return { id: key.id };
}

export async function revokeAllApiKeysForUser(
  { prisma }: Deps,
  actorId: string,
  input: ApiKeyRevokeAllInput,
  requestId?: string,
): Promise<{ revoked: number }> {
  const revoked = await prisma.$transaction(async (tx) => {
    const keys = await tx.apiKey.findMany({
      where: { userId: input.userId, status: "active" },
      select: { id: true, name: true, keyPreview: true },
    });
    // 逐行条件更新：与并发 revoke/revokeAll 撞车时只有翻转成功的那方记审计，
    // 返回计数也是实际翻转数。行数受 API_KEY_LIMIT_PER_USER 上界，循环可控。
    let count = 0;
    for (const key of keys) {
      const updated = await tx.apiKey.updateMany({
        where: { id: key.id, status: "active" },
        data: { status: "revoked" },
      });
      if (updated.count === 1) {
        count += 1;
        await tx.apiKeyAuditLog.create({
          data: {
            actorId,
            action: "revoke_all",
            targetKeyId: key.id,
            targetUserId: input.userId,
            keyName: key.name,
            keyPreview: key.keyPreview,
            requestId,
          },
        });
      }
    }
    return count;
  });
  return { revoked };
}

/**
 * HTTP 映射（由 open-api-foundation 票的 bearer hook 执行）：
 * external_role → 403，其余失败 → 401。
 * 每请求查库（对齐 validateSession）：吊销/禁用即刻生效，无缓存窗口。
 */
export type ValidateApiKeyResult =
  | { ok: true; keyId: string; user: AuthenticatedUser }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "user_disabled" | "external_role" };

export async function validateApiKey(
  prisma: PrismaClient,
  token: string,
): Promise<ValidateApiKeyResult> {
  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(token) },
    include: { user: { include: { role: true } } },
  });
  if (!key) {
    return { ok: false, reason: "invalid" };
  }
  if (key.status !== "active") {
    return { ok: false, reason: "revoked" };
  }
  if (key.expiresAt && key.expiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }
  if (!key.user.active) {
    return { ok: false, reason: "user_disabled" };
  }
  if (isExternalRole(key.user.role)) {
    return { ok: false, reason: "external_role" };
  }

  // lastUsedAt 节流：窗口内的重复命中由 WHERE 守卫直接挡下，不产生写。
  const now = new Date();
  await prisma.apiKey.updateMany({
    where: {
      id: key.id,
      OR: [
        { lastUsedAt: null },
        { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } },
      ],
    },
    data: { lastUsedAt: now },
  });

  return {
    ok: true,
    keyId: key.id,
    user: {
      id: key.user.id,
      username: key.user.username,
      name: key.user.name,
      email: key.user.email,
      team: key.user.team,
      roleId: key.user.roleId,
      roleName: key.user.role.name,
      permissions: effectivePermissions(key.user.role),
      requiredTicketFields: key.user.role.requiredTicketFields,
      isExternal: false,
    },
  };
}
