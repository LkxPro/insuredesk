import { randomBytes } from "node:crypto";
import { type Permission, POSITIVE_PERMISSIONS } from "@insuredesk/shared";
import * as bcrypt from "bcryptjs";
import type { PrismaClient } from "../generated/prisma/client";

/**
 * bcrypt cost factor for all password hashing (seeding and future user
 * management). Single knob so a cost bump is one edit, not a hunt.
 */
export const BCRYPT_ROUNDS = 10;

/**
 * Hash a plaintext password with the service-wide bcrypt cost factor.
 */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * The permission set a role actually grants. 系统角色不受权限配置约束:
 * 不读库中数组,恒为当前代码的全量正向权限点,新增权限点无需迁移即生效。
 * 限制类权限(勾选=禁止)必须排除,否则 admin 会被自动禁止对应操作。
 * 判定与展示必须同走这里,不得直接读 role.permissions。
 */
export function effectivePermissions(role: {
  system: boolean;
  permissions: string[];
}): Permission[] {
  return role.system ? [...POSITIVE_PERMISSIONS] : (role.permissions as Permission[]);
}

/**
 * Pluggable authentication abstraction. Current implementation supports password
 * login; future Feishu SSO will add a second implementation that calls the same
 * session-establishment path.
 */
export interface AuthProvider {
  /**
   * Authenticate a user and return their userId, or null if authentication fails.
   * @returns userId on success, null on failure
   */
  authenticate(credentials: unknown): Promise<string | null>;
}

/**
 * Password-based authentication provider (current implementation).
 * Verifies username + password against the User table.
 */
export class PasswordAuthProvider implements AuthProvider {
  constructor(private readonly prisma: PrismaClient) {}

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

/**
 * Session management service. Handles session creation, validation, and cleanup.
 * Sessions are stored in Postgres (not Redis) this phase.
 */
export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessionMaxAgeSeconds: number,
  ) {}

  /**
   * Create a new session for the given userId.
   * @returns session token (to be stored in httpOnly cookie)
   */
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

  /**
   * Validate a session token and return the authenticated user with their role
   * and resolved permission set, or null if invalid/expired.
   */
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
      roleId: session.user.roleId,
      roleName: session.user.role.name,
      permissions: effectivePermissions(session.user.role),
      requiredTicketFields: session.user.role.requiredTicketFields,
    };
  }

  /**
   * Delete a session (logout).
   */
  async deleteSession(token: SessionToken): Promise<void> {
    await this.prisma.session.delete({ where: { token } }).catch(() => {
      // Ignore if session doesn't exist
    });
  }

  /**
   * Clean up expired sessions (to be called periodically in production).
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}

/**
 * Authenticated user information with resolved permissions.
 */
export interface AuthenticatedUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  roleId: string;
  roleName: string;
  permissions: Permission[];
  requiredTicketFields: string[];
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
