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

export const API_KEY_TOKEN_PREFIX = "sk_live_";
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
  expiresAt: Date;
  lastUsedAt: Date | null;
  createdAt: Date;
}): ApiKeyListItem {
  return {
    id: row.id,
    name: row.name,
    status: row.status as ApiKeyListItem["status"],
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listApiKeys(
  { prisma }: Deps,
  user: AuthenticatedUser,
): Promise<ApiKeyListItem[]> {
  const rows = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
): Promise<ApiKeyCreated> {
  const token = `${API_KEY_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  const keyHash = hashApiKey(token);

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
    const existing = await tx.apiKey.count({ where: { userId: user.id, status: "active" } });
    if (existing >= API_KEY_LIMIT_PER_USER) {
      throw new ApiKeyLimitError();
    }
    return tx.apiKey.create({
      data: {
        name: input.name,
        keyHash,
        userId: user.id,
        expiresAt: new Date(input.expiresAt),
      },
    });
  });
  return { ...toListItem(created), key: token };
}

/** 吊销幂等：已吊销照报成功；他人 key 与不存在同按 404 拒绝（不泄露存在性）。 */
export async function revokeApiKey(
  { prisma }: Deps,
  user: AuthenticatedUser,
  input: ApiKeyRevokeInput,
): Promise<{ id: string }> {
  const key = await prisma.apiKey.findFirst({
    where: { id: input.id, userId: user.id },
    select: { id: true, status: true },
  });
  if (!key) {
    throw new ApiKeyNotFoundError();
  }
  if (key.status === "active") {
    await prisma.apiKey.update({ where: { id: key.id }, data: { status: "revoked" } });
  }
  return { id: key.id };
}

export async function revokeAllApiKeysForUser(
  { prisma }: Deps,
  input: ApiKeyRevokeAllInput,
): Promise<{ revoked: number }> {
  const result = await prisma.apiKey.updateMany({
    where: { userId: input.userId, status: "active" },
    data: { status: "revoked" },
  });
  return { revoked: result.count };
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
  if (key.expiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }
  if (!key.user.active) {
    return { ok: false, reason: "user_disabled" };
  }
  // 读角色库中存的权限数组：管理员展开后含外部权限点却是内部账号
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
