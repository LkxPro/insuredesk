import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import type { PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 角色建单必填字段集验证（issue #63）：按请求者角色强制必填集，缺失字段一次性报错，
 * 三态字段必须明确选择，编辑不受约束，外部来源不适用，清单外 key 防御性忽略。
 */
describe("role required ticket fields (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let seeded: {
    roles: { admin: Role; csManager: Role; frontline: Role; readOnly: Role };
    users: { admin: User; manager: User; cs1: User; observer: User };
  };
  let roleWithRequired: Role;
  let userWithRequired: User;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = container.getConnectionUri();

    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    process.env.DATABASE_URL = databaseUrl;

    const [{ prisma: appPrisma }, seedData, routers] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
      import("../src/routers/index"),
    ]);
    prisma = appPrisma;
    appRouter = routers.appRouter;

    seeded = await seedData.seedFactoryRolesAndDemoUsers(prisma);
    await seedData.seedSlaPolicies(prisma);

    roleWithRequired = await prisma.role.create({
      data: {
        name: "必填测试角色",
        permissions: ["ticket.create", "ticket.view", "ticket.view_all", "ticket.edit"],
        requiredTicketFields: ["customerName", "phone", "channel", "hasContacted"],
      },
    });

    userWithRequired = await prisma.user.create({
      data: {
        username: "required_user",
        name: "必填用户",
        roleId: roleWithRequired.id,
        active: true,
      },
    });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  function callerFor(user: User, role: Role) {
    return appRouter.createCaller({
      traceId: "required-test",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        roleId: role.id,
        roleName: role.name,
        permissions: role.permissions as Permission[],
        requiredTicketFields: [],
      },
      sessionToken: null,
    });
  }

  function callerWithPermissions(user: User, roleName: string, permissions: Permission[]) {
    return appRouter.createCaller({
      traceId: "required-test",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        roleId: user.roleId,
        roleName,
        permissions,
        requiredTicketFields: [],
      },
      sessionToken: null,
    });
  }

  function admin() {
    return callerWithPermissions(seeded.users.admin, "管理员", [
      "role.view",
      "role.edit_permission",
      "role.edit",
      "role.create",
      "role.delete",
    ]);
  }

  function manager() {
    return callerFor(seeded.users.manager, seeded.roles.csManager);
  }

  function requiredUser() {
    return callerFor(userWithRequired, roleWithRequired);
  }

  const validInput = {
    feedbackTime: "2026-07-15T10:00:00.000Z",
    channel: "保司" as const,
    customerName: "张三",
    phone: "13900000000",
    hasContacted: true,
    complaintLevel: "一般投诉" as const,
  } satisfies TicketCreateInput;

  describe("role.updateRequiredFields", () => {
    it("updates requiredTicketFields for a non-admin role", async () => {
      const result = await admin().role.updateRequiredFields({
        id: seeded.roles.frontline.id,
        requiredTicketFields: ["customerName", "channel"],
      });
      expect(result.requiredTicketFields).toEqual(["customerName", "channel"]);

      const updated = await prisma.role.findUnique({
        where: { id: seeded.roles.frontline.id },
        select: { requiredTicketFields: true },
      });
      expect(updated?.requiredTicketFields).toEqual(["customerName", "channel"]);
    });

    it("rejects updating admin role (system role protected)", async () => {
      await expect(
        admin().role.updateRequiredFields({
          id: seeded.roles.admin.id,
          requiredTicketFields: ["customerName"],
        }),
      ).rejects.toThrow(/管理员是系统角色/);
    });

    it("deduplicates requiredTicketFields", async () => {
      const result = await admin().role.updateRequiredFields({
        id: seeded.roles.frontline.id,
        requiredTicketFields: ["customerName", "channel", "customerName"],
      });
      expect(result.requiredTicketFields).toEqual(["customerName", "channel"]);
    });

    it("accepts empty array (全非必填)", async () => {
      const result = await admin().role.updateRequiredFields({
        id: seeded.roles.frontline.id,
        requiredTicketFields: [],
      });
      expect(result.requiredTicketFields).toEqual([]);
    });
  });

  describe("ticket.create with required fields", () => {
    it("accepts ticket when all required fields are provided", async () => {
      const result = await requiredUser().ticket.create(validInput);
      expect(result.workOrderNumber).toMatch(/^WO\d{6,}$/);

      const detail = await requiredUser().ticket.detail({ id: result.id });
      expect(detail.customerName).toBe("张三");
      expect(detail.phone).toBe("13900000000");
      expect(detail.channel).toBe("保司");
      expect(detail.hasContacted).toBe(true);
    });

    it("rejects when missing one required field", async () => {
      const input = { ...validInput, customerName: null };
      await expect(requiredUser().ticket.create(input)).rejects.toThrow(
        /以下字段为必填项：客户姓名/,
      );
    });

    it("rejects when missing multiple required fields and lists them all", async () => {
      const input = {
        feedbackTime: "2026-07-15T10:00:00.000Z",
        complaintLevel: "一般投诉",
      } satisfies TicketCreateInput;

      const error = await requiredUser()
        .ticket.create(input)
        .catch((e) => e);
      expect(error).toBeInstanceOf(TRPCError);
      expect(error.message).toContain("以下字段为必填项");
      expect(error.message).toContain("客户姓名");
      expect(error.message).toContain("手机号");
      expect(error.message).toContain("业务渠道");
      expect(error.message).toContain("是否已联系");
    });

    it("rejects tri-state field when left as null (hasContacted)", async () => {
      const input = { ...validInput, hasContacted: null };
      await expect(requiredUser().ticket.create(input)).rejects.toThrow(
        /以下字段为必填项：是否已联系/,
      );
    });

    it("accepts tri-state field when explicitly set to false", async () => {
      const input = { ...validInput, hasContacted: false };
      const result = await requiredUser().ticket.create(input);
      const detail = await requiredUser().ticket.detail({ id: result.id });
      expect(detail.hasContacted).toBe(false);
    });

    it("enforces categoryId as a required field against the catalog shape", async () => {
      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: {
          requiredTicketFields: ["customerName", "phone", "channel", "hasContacted", "categoryId"],
        },
      });
      const category = await prisma.ticketCategory.create({
        data: { name: "必填用类别", displayOrder: 1 },
      });

      await expect(requiredUser().ticket.create(validInput)).rejects.toThrow(
        /以下字段为必填项：分类/,
      );

      const result = await requiredUser().ticket.create({
        ...validInput,
        categoryId: category.id,
      });
      const detail = await requiredUser().ticket.detail({ id: result.id });
      expect(detail.category?.name).toBe("必填用类别");

      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: { requiredTicketFields: ["customerName", "phone", "channel", "hasContacted"] },
      });
    });

    it("allows ticket creation when role has empty requiredTicketFields", async () => {
      const input = {
        complaintLevel: "一般投诉",
      } satisfies TicketCreateInput;
      const result = await manager().ticket.create(input);
      expect(result.workOrderNumber).toMatch(/^WO\d{6,}$/);
    });

    it("ignores unknown keys in requiredTicketFields (defensive against field rename)", async () => {
      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: { requiredTicketFields: ["customerName", "unknownField", "channel"] },
      });

      const input = {
        ...validInput,
        customerName: "李四",
        channel: "保司" as const,
      };
      const result = await requiredUser().ticket.create(input);
      expect(result.workOrderNumber).toMatch(/^WO\d{6,}$/);
    });
  });

  describe("ticket.edit (不受必填约束)", () => {
    it("allows editing to clear a required field", async () => {
      const created = await requiredUser().ticket.create(validInput);

      const edited = await requiredUser().ticket.edit({
        ticketId: created.id,
        customerName: null,
        phone: null,
      });
      expect(edited).toBeDefined();

      const detail = await requiredUser().ticket.detail({ id: created.id });
      expect(detail.customerName).toBeNull();
      expect(detail.phone).toBeNull();
    });

    it("allows editing with all fields null", async () => {
      const created = await requiredUser().ticket.create(validInput);

      const allNull = {
        ticketId: created.id,
        feedbackTime: null,
        channel: null,
        project: null,
        brokerageEntity: null,
        paymentChannel: null,
        internalOrderNumber: null,
        policyNumber: null,
        userComplaintChannel: null,
        customerName: null,
        phone: null,
        contactPhone: null,
        customerRequest: null,
        nuclearBodyStatus: null,
        hasContacted: null,
        contactId: null,
        categoryId: null,
        complaintLevel: null,
        priority: null,
      };

      const edited = await requiredUser().ticket.edit(allNull);
      expect(edited).toBeDefined();
    });
  });

  describe("role.list includes requiredTicketFields", () => {
    it("returns requiredTicketFields in role list", async () => {
      // Reset the role to original state after previous tests modified it
      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: { requiredTicketFields: ["customerName", "phone", "channel", "hasContacted"] },
      });

      const roles = await admin().role.list();
      const testRole = roles.find((r) => r.id === roleWithRequired.id);
      expect(testRole?.requiredTicketFields).toContain("customerName");
      expect(testRole?.requiredTicketFields).toContain("phone");
      expect(testRole?.requiredTicketFields).toContain("channel");
      expect(testRole?.requiredTicketFields).toContain("hasContacted");
    });

    it("shows empty array for roles without required fields", async () => {
      const roles = await admin().role.list();
      const adminRole = roles.find((r) => r.id === seeded.roles.admin.id);
      expect(adminRole?.requiredTicketFields).toEqual([]);
    });
  });
});
