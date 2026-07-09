import type { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Permission } from "@insuredesk/shared";

/**
 * Pluggable authentication abstraction. Current implementation supports password
 * login; future Feishu SSO will add a second implementation that calls the same
 * session-establishment path.
 *
 * See ADR 0006 for the pluggable auth design.
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

    // Find active user by username
    const user = await this.prisma.user.findUnique({
      where: { username, active: true },
      select: { id: true, passwordHash: true },
    });

    if (!user || !user.passwordHash) {
      return null;
    }

    // Verify password
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
  async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString("hex");
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
  async validateSession(token: string): Promise<AuthenticatedUser | null> {
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
      permissions: session.user.role.permissions as Permission[],
    };
  }

  /**
   * Delete a session (logout).
   */
  async deleteSession(token: string): Promise<void> {
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
}

/**
 * Check if a user has a specific permission.
 */
export function hasPermission(user: AuthenticatedUser, permission: Permission): boolean {
  return user.permissions.includes(permission);
}

/**
 * Check if a user has ALL of the given permissions.
 */
export function hasAllPermissions(user: AuthenticatedUser, permissions: Permission[]): boolean {
  return permissions.every((p) => user.permissions.includes(p));
}

/**
 * Check if a user has ANY of the given permissions.
 */
export function hasAnyPermission(user: AuthenticatedUser, permissions: Permission[]): boolean {
  return permissions.some((p) => user.permissions.includes(p));
}
