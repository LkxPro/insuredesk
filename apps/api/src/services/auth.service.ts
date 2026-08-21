import { randomBytes } from "node:crypto";
import { isExternalRole, type Permission, POSITIVE_PERMISSIONS } from "@insuredesk/shared";
import * as bcrypt from "bcryptjs";
import type { PrismaClient } from "../generated/prisma/client.ts";

export const BCRYPT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * 系统角色不受权限配置约束: 不读库中数组,恒为当前代码的全量正向权限点,新增权限点无需迁移即生效。
 * 限制类权限(勾选=禁止)必须排除,否则 admin 会被自动禁止对应操作。
 * 判定与展示必须同走这里,不得直接读 role.permissions。
 */
export function effectivePermissions(role: {
  system: boolean;
  permissions: string[];
}): Permission[] {
  return role.system ? [...POSITIVE_PERMISSIONS] : (role.permissions as Permission[]);
}

export class IncorrectOldPasswordError extends Error {
  constructor() {
    super("旧密码不正确");
    this.name = "IncorrectOldPasswordError";
  }
}

export class NoPasswordAccountError extends Error {
  constructor() {
    super("该账号未设置密码，无法修改密码");
    this.name = "NoPasswordAccountError";
  }
}

/**
 * 自助改密 (profile page). Verifies the old credential before rotating.
 * Accounts without a passwordHash are refused — this is a rotation, not a
 * first-time set. Every OTHER session dies in the same transaction (whoever
 * held the old password must not keep riding a live session), while the
 * caller's own session survives — they just proved the credential.
 */
export async function changeOwnPassword(
  prisma: PrismaClient,
  userId: string,
  currentSessionToken: SessionToken | null,
  input: { oldPassword: string; newPassword: string },
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user.passwordHash) {
    throw new NoPasswordAccountError();
  }
  if (!(await bcrypt.compare(input.oldPassword, user.passwordHash))) {
    throw new IncorrectOldPasswordError();
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.deleteMany({
      // A caller without a session token (tests via createCaller) kicks all.
      where: {
        userId,
        ...(currentSessionToken ? { token: { not: currentSessionToken } } : {}),
      },
    }),
  ]);
}

export interface AuthProvider {
  authenticate(credentials: unknown): Promise<string | null>;
}

export class PasswordAuthProvider implements AuthProvider {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async authenticate(credentials: unknown): Promise<string | null> {
    if (!isPasswordCredentials(credentials)) {
      return null;
    }

    const { username, password } = credentials;

    const user = await this.prisma.user.findUnique({
      where: { username, active: true },
      select: { id: true, passwordHash: true },
    });

    if (!user?.passwordHash) {
      return null;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user.id : null;
  }
}

interface PasswordCredentials {
  username: string;
  password: string;
}

function isPasswordCredentials(obj: unknown): obj is PasswordCredentials {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "username" in obj &&
    "password" in obj &&
    typeof obj.username === "string" &&
    typeof obj.password === "string"
  );
}

declare const sessionTokenBrand: unique symbol;

/**
 * Branded string for session tokens, so a token can't be silently confused
 * with other strings (user ids, cookie names, …). Mint one via
 * `SessionService.createSession`; brand inbound cookie values at the HTTP
 * boundary with `toSessionToken`.
 */
export type SessionToken = string & { readonly [sessionTokenBrand]: true };

/**
 * Brand a raw string (e.g. a cookie value) as a SessionToken at the system
 * boundary. Compile-time marker only — validity is still decided by
 * `SessionService.validateSession`.
 */
export function toSessionToken(raw: string): SessionToken {
  return raw as SessionToken;
}

export class SessionService {
  private readonly prisma: PrismaClient;
  private readonly sessionMaxAgeSeconds: number;

  constructor(prisma: PrismaClient, sessionMaxAgeSeconds: number) {
    this.prisma = prisma;
    this.sessionMaxAgeSeconds = sessionMaxAgeSeconds;
  }

  async createSession(userId: string): Promise<SessionToken> {
    const token = toSessionToken(randomBytes(32).toString("hex"));
    const expiresAt = new Date(Date.now() + this.sessionMaxAgeSeconds * 1000);

    await this.prisma.session.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });

    return token;
  }

  async validateSession(token: SessionToken): Promise<AuthenticatedUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { token },
      include: {
        user: {
          include: { role: true },
        },
      },
    });

    if (!session || session.expiresAt < new Date() || !session.user.active) {
      return null;
    }

    return {
      id: session.user.id,
      username: session.user.username,
      name: session.user.name,
      email: session.user.email,
      team: session.user.team,
      roleId: session.user.roleId,
      roleName: session.user.role.name,
      permissions: effectivePermissions(session.user.role),
      requiredTicketFields: session.user.role.requiredTicketFields,
      // 内外部之分读角色库中存的权限数组：管理员展开后含外部权限点却是内部账号
      isExternal: isExternalRole(session.user.role),
    };
  }

  async deleteSession(token: SessionToken): Promise<void> {
    await this.prisma.session.delete({ where: { token } }).catch(() => {});
  }

  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  team: string | null;
  roleId: string;
  roleName: string;
  permissions: Permission[];
  requiredTicketFields: string[];
  /** true = 外部账号：仅见自己提交的工单，管理界面不出现"角色"概念。 */
  isExternal: boolean;
}

export function hasPermission(user: AuthenticatedUser, permission: Permission): boolean {
  return user.permissions.includes(permission);
}

export function hasAllPermissions(user: AuthenticatedUser, permissions: Permission[]): boolean {
  return permissions.every((p) => user.permissions.includes(p));
}

export function hasAnyPermission(user: AuthenticatedUser, permissions: Permission[]): boolean {
  return permissions.some((p) => user.permissions.includes(p));
}
