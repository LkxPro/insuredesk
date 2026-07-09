import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { PRESET_ROLES } from "@insuredesk/shared";
import * as bcrypt from "bcryptjs";
import { PasswordAuthProvider, SessionService, hasPermission } from "../src/services/auth.service";
import { applyTicketDataScope, applyDashboardDataScope } from "../src/services/data-scope.service";

/**
 * Integration tests for authentication and RBAC using Testcontainers.
 * Tests the full auth flow with a real Postgres database.
 *
 * From acceptance criteria:
 * - RBAC guard + data-scope helper covered by Testcontainers tests
 * - Demo: admin vs 一线客服 me differ; guarded probe rejects the frontline user
 */

describe("Authentication and RBAC (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let authProvider: PasswordAuthProvider;
  let sessionService: SessionService;

  beforeAll(async () => {
    // Start PostgreSQL container
    container = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("test")
      .withUsername("test")
      .withPassword("test")
      .start();

    const connectionString = container.getConnectionUri();

    // Initialize Prisma client
    prisma = new PrismaClient({
      datasources: { db: { url: connectionString } },
    });

    // Run migrations
    const { execSync } = await import("node:child_process");
    execSync("pnpm prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: connectionString },
    });

    // Seed test data
    await seedTestData(prisma);

    // Initialize services
    authProvider = new PasswordAuthProvider(prisma);
    sessionService = new SessionService(prisma, 86400);
  }, 60000); // 60s timeout for container startup

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  describe("Password Authentication", () => {
    it("authenticates valid credentials", async () => {
      const userId = await authProvider.authenticate({
        username: "admin",
        password: "password123",
      });

      expect(userId).toBeTruthy();
      expect(typeof userId).toBe("string");
    });

    it("rejects invalid username", async () => {
      const userId = await authProvider.authenticate({
        username: "nonexistent",
        password: "password123",
      });

      expect(userId).toBeNull();
    });

    it("rejects invalid password", async () => {
      const userId = await authProvider.authenticate({
        username: "admin",
        password: "wrongpassword",
      });

      expect(userId).toBeNull();
    });

    it("rejects inactive users", async () => {
      // Create inactive user
      const role = await prisma.role.findFirst({ where: { name: "一线客服" } });
      const passwordHash = await bcrypt.hash("password123", 10);

      await prisma.user.create({
        data: {
          username: "inactive",
          passwordHash,
          name: "Inactive User",
          email: "inactive@test.com",
          roleId: role!.id,
          active: false,
        },
      });

      const userId = await authProvider.authenticate({
        username: "inactive",
        password: "password123",
      });

      expect(userId).toBeNull();
    });
  });

  describe("Session Management", () => {
    it("creates and validates sessions", async () => {
      // Get a user
      const user = await prisma.user.findUnique({ where: { username: "admin" } });
      expect(user).toBeTruthy();

      // Create session
      const token = await sessionService.createSession(user!.id);
      expect(token).toBeTruthy();
      expect(token.length).toBe(64); // 32 bytes hex = 64 chars

      // Validate session
      const authenticatedUser = await sessionService.validateSession(token);
      expect(authenticatedUser).toBeTruthy();
      expect(authenticatedUser!.username).toBe("admin");
      expect(authenticatedUser!.roleName).toBe("管理员");
      expect(authenticatedUser!.permissions).toContain("ticket.view_all");
    });

    it("rejects expired sessions", async () => {
      const user = await prisma.user.findUnique({ where: { username: "admin" } });

      // Create session with very short expiry
      const shortSessionService = new SessionService(prisma, 1);
      const token = await shortSessionService.createSession(user!.id);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should be invalid
      const authenticatedUser = await sessionService.validateSession(token);
      expect(authenticatedUser).toBeNull();
    });

    it("deletes sessions on logout", async () => {
      const user = await prisma.user.findUnique({ where: { username: "admin" } });
      const token = await sessionService.createSession(user!.id);

      // Validate it works
      let authenticatedUser = await sessionService.validateSession(token);
      expect(authenticatedUser).toBeTruthy();

      // Delete session
      await sessionService.deleteSession(token);

      // Should be invalid now
      authenticatedUser = await sessionService.validateSession(token);
      expect(authenticatedUser).toBeNull();
    });
  });

  describe("RBAC - Permission Resolution", () => {
    it("admin has all permissions", async () => {
      const user = await prisma.user.findUnique({
        where: { username: "admin" },
        include: { role: true },
      });

      expect(user!.role.permissions).toHaveLength(PRESET_ROLES.ADMIN.permissions.length);
      expect(user!.role.permissions).toContain("ticket.view_all");
      expect(user!.role.permissions).toContain("ticket.assign");
      expect(user!.role.permissions).toContain("user.create");
    });

    it("frontline CS has limited permissions", async () => {
      const user = await prisma.user.findUnique({
        where: { username: "cs1" },
        include: { role: true },
      });

      expect(user!.role.permissions).toHaveLength(3);
      expect(user!.role.permissions).toContain("dashboard.view");
      expect(user!.role.permissions).toContain("ticket.view");
      expect(user!.role.permissions).toContain("ticket.process");

      // Should NOT have these permissions
      expect(user!.role.permissions).not.toContain("ticket.view_all");
      expect(user!.role.permissions).not.toContain("ticket.assign");
      expect(user!.role.permissions).not.toContain("user.create");
    });

    it("hasPermission helper works correctly", async () => {
      // Get admin session
      const admin = await prisma.user.findUnique({ where: { username: "admin" } });
      const adminToken = await sessionService.createSession(admin!.id);
      const adminUser = await sessionService.validateSession(adminToken);

      // Get frontline CS session
      const cs = await prisma.user.findUnique({ where: { username: "cs1" } });
      const csToken = await sessionService.createSession(cs!.id);
      const csUser = await sessionService.validateSession(csToken);

      // Admin should have ticket.assign
      expect(hasPermission(adminUser!, "ticket.assign")).toBe(true);

      // Frontline CS should NOT have ticket.assign
      expect(hasPermission(csUser!, "ticket.assign")).toBe(false);

      // Both should have ticket.view
      expect(hasPermission(adminUser!, "ticket.view")).toBe(true);
      expect(hasPermission(csUser!, "ticket.view")).toBe(true);
    });
  });

  describe("Data Scope Helper", () => {
    it("ticket data scope: admin sees all tickets", async () => {
      const admin = await prisma.user.findUnique({ where: { username: "admin" } });
      const adminToken = await sessionService.createSession(admin!.id);
      const adminUser = await sessionService.validateSession(adminToken);

      const scope = applyTicketDataScope(adminUser);

      // Admin should have no restrictions (empty filter)
      expect(scope).toEqual({});
    });

    it("ticket data scope: frontline CS only sees own tickets", async () => {
      const cs = await prisma.user.findUnique({ where: { username: "cs1" } });
      const csToken = await sessionService.createSession(cs!.id);
      const csUser = await sessionService.validateSession(csToken);

      const scope = applyTicketDataScope(csUser);

      // Should filter to assigneeId = user.id
      expect(scope).toEqual({ assigneeId: csUser!.id });
    });

    it("ticket data scope: unauthenticated user sees nothing", async () => {
      const scope = applyTicketDataScope(null);

      // Should return impossible filter
      expect(scope).toHaveProperty("id");
      expect(scope.id).toHaveProperty("equals", "__impossible__");
    });

    it("dashboard data scope: admin sees all data", async () => {
      const admin = await prisma.user.findUnique({ where: { username: "admin" } });
      const adminToken = await sessionService.createSession(admin!.id);
      const adminUser = await sessionService.validateSession(adminToken);

      const scope = applyDashboardDataScope(adminUser);

      expect(scope).toEqual({});
    });

    it("dashboard data scope: frontline CS only sees own data", async () => {
      const cs = await prisma.user.findUnique({ where: { username: "cs1" } });
      const csToken = await sessionService.createSession(cs!.id);
      const csUser = await sessionService.validateSession(csToken);

      const scope = applyDashboardDataScope(csUser);

      expect(scope).toEqual({ assigneeId: csUser!.id });
    });
  });
});

/**
 * Seed test data - creates preset roles and sample users
 */
async function seedTestData(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash("password123", 10);

  // Create preset roles
  const adminRole = await prisma.role.create({
    data: {
      name: PRESET_ROLES.ADMIN.name,
      permissions: PRESET_ROLES.ADMIN.permissions,
      preset: true,
    },
  });

  const csManagerRole = await prisma.role.create({
    data: {
      name: PRESET_ROLES.CS_MANAGER.name,
      permissions: PRESET_ROLES.CS_MANAGER.permissions,
      preset: true,
    },
  });

  const frontlineRole = await prisma.role.create({
    data: {
      name: PRESET_ROLES.FRONTLINE_CS.name,
      permissions: PRESET_ROLES.FRONTLINE_CS.permissions,
      preset: true,
    },
  });

  const readOnlyRole = await prisma.role.create({
    data: {
      name: PRESET_ROLES.READ_ONLY.name,
      permissions: PRESET_ROLES.READ_ONLY.permissions,
      preset: true,
    },
  });

  // Create sample users
  await prisma.user.create({
    data: {
      username: "admin",
      passwordHash,
      name: "系统管理员",
      email: "admin@test.com",
      roleId: adminRole.id,
      active: true,
    },
  });

  await prisma.user.create({
    data: {
      username: "manager",
      passwordHash,
      name: "李主管",
      email: "manager@test.com",
      roleId: csManagerRole.id,
      active: true,
    },
  });

  await prisma.user.create({
    data: {
      username: "cs1",
      passwordHash,
      name: "张客服",
      email: "cs1@test.com",
      roleId: frontlineRole.id,
      active: true,
    },
  });

  await prisma.user.create({
    data: {
      username: "observer",
      passwordHash,
      name: "王观察员",
      email: "observer@test.com",
      roleId: readOnlyRole.id,
      active: true,
    },
  });
}
