import {
  type Permission,
  TICKET_CREATE_FIELD_KEYS,
  type TicketCreateInput,
  type TicketEditInput,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/routers/index.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

/**
 * 角色建单必填字段集验证：按请求者角色强制必填集，缺失字段一次性报错，
 * 三态字段必须明确选择，编辑不受约束，外部来源不适用，清单外 key 防御性忽略。
 */
describe("role required ticket fields (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let roleWithRequired: Role;
  let userWithRequired: User;
  let channelBaosi: { id: string };

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "slaPolicies", "channels"],
    });
    prisma = harness.prisma;
    seeded = harness.seeded;
    channelBaosi = { id: harness.channelId("保司") };

    roleWithRequired = await prisma.role.create({
      data: {
        name: "必填测试角色",
        permissions: ["ticket.create", "ticket.view", "ticket.view_all", "ticket.edit"],
        requiredTicketFields: ["customerName", "phone", "channelId", "hasContacted"],
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
    await harness?.stop();
  });

  function callerFor(user: User, role: Role) {
    return appRouter.createCaller({
      traceId: "required-test",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        team: user.team,
        roleId: role.id,
        roleName: role.name,
        permissions: role.permissions as Permission[],
        requiredTicketFields: [],
        isExternal: false,
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
        team: user.team,
        roleId: user.roleId,
        roleName,
        permissions,
        requiredTicketFields: [],
        isExternal: false,
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

  const validInput = (): TicketCreateInput & { allowDuplicate?: boolean } => ({
    feedbackTime: "2026-07-15T10:00:00.000Z",
    channelId: channelBaosi.id,
    customerName: "张三",
    phone: "13900000000",
    hasContacted: true,
    complaintLevel: "一般投诉" as const,
    // fixture 有意复用相同手机号，绕过提交兜底查重
    allowDuplicate: true,
  });

  describe("role.updateRequiredFields", () => {
    it("updates requiredTicketFields for a non-admin role", async () => {
      const result = await admin().role.updateRequiredFields({
        id: seeded.roles.frontline.id,
        requiredTicketFields: ["customerName", "channelId"],
      });
      expect(result.requiredTicketFields).toEqual(["customerName", "channelId"]);

      const updated = await prisma.role.findUnique({
        where: { id: seeded.roles.frontline.id },
        select: { requiredTicketFields: true },
      });
      expect(updated?.requiredTicketFields).toEqual(["customerName", "channelId"]);
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
        requiredTicketFields: ["customerName", "channelId", "customerName"],
      });
      expect(result.requiredTicketFields).toEqual(["customerName", "channelId"]);
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
      const result = await requiredUser().ticket.create(validInput());
      expect(result.workOrderNumber).toMatch(/^WO\d{6,}$/);

      const detail = await requiredUser().ticket.detail({ id: result.id });
      expect(detail.customerName).toBe("张三");
      expect(detail.phone).toBe("13900000000");
      expect(detail.channel?.name).toBe("保司");
      expect(detail.hasContacted).toBe(true);
    });

    it("rejects when missing one required field", async () => {
      const input = { ...validInput(), customerName: null };
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
      expect(error.message).toContain("客户电话（投保人）");
      expect(error.message).toContain("反馈渠道");
      expect(error.message).toContain("客户曾进线");
    });

    it("rejects tri-state field when left as null (hasContacted)", async () => {
      const input = { ...validInput(), hasContacted: null };
      await expect(requiredUser().ticket.create(input)).rejects.toThrow(
        /以下字段为必填项：客户曾进线/,
      );
    });

    it("accepts tri-state field when explicitly set to false", async () => {
      const input = { ...validInput(), hasContacted: false };
      const result = await requiredUser().ticket.create(input);
      const detail = await requiredUser().ticket.detail({ id: result.id });
      expect(detail.hasContacted).toBe(false);
    });

    it("rejects required 保单号 left empty or absent (多值字段空数组＝未填写)", async () => {
      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: { requiredTicketFields: ["policyNumbers"] },
      });

      await expect(
        requiredUser().ticket.create({ ...validInput(), policyNumbers: [] }),
      ).rejects.toThrow(/以下字段为必填项：保单号/);
      await expect(requiredUser().ticket.create(validInput())).rejects.toThrow(
        /以下字段为必填项：保单号/,
      );

      const result = await requiredUser().ticket.create({
        ...validInput(),
        policyNumbers: ["P2026-118"],
      });
      const detail = await requiredUser().ticket.detail({ id: result.id });
      expect(detail.policyNumbers).toEqual(["P2026-118"]);
    });

    it("required 保单号可用「无保单号」表态满足", async () => {
      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: { requiredTicketFields: ["policyNumbers"] },
      });

      const result = await requiredUser().ticket.create({
        ...validInput(),
        policyNumbers: [],
        noPolicyNumber: true,
      });
      const detail = await requiredUser().ticket.detail({ id: result.id });
      expect(detail.noPolicyNumber).toBe(true);
      expect(detail.policyNumbers).toEqual([]);
    });

    it("required 投诉等级可用 slaPolicyId 引用满足（双轨）", async () => {
      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: { requiredTicketFields: ["complaintLevel"] },
      });
      try {
        const { complaintLevel: _dropped, ...withoutLevel } = validInput();
        await expect(requiredUser().ticket.create(withoutLevel)).rejects.toThrow(
          /以下字段为必填项：投诉等级/,
        );

        const policy = await prisma.slaPolicy.findUniqueOrThrow({
          where: { complaintLevel: "一般投诉" },
        });
        const result = await requiredUser().ticket.create({
          ...withoutLevel,
          slaPolicyId: policy.id,
        });
        const detail = await requiredUser().ticket.detail({ id: result.id });
        expect(detail.slaPolicyId).toBe(policy.id);
        expect(detail.complaintLevel).toBe("一般投诉");
      } finally {
        await prisma.role.update({
          where: { id: roleWithRequired.id },
          data: { requiredTicketFields: ["customerName", "phone", "channelId", "hasContacted"] },
        });
      }
    });

    it("enforces categoryId as a required field against the catalog shape", async () => {
      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: {
          requiredTicketFields: [
            "customerName",
            "phone",
            "channelId",
            "hasContacted",
            "categoryId",
          ],
        },
      });
      const category = await prisma.ticketCategory.create({
        data: { name: "必填用类别", displayOrder: 1 },
      });

      await expect(requiredUser().ticket.create(validInput())).rejects.toThrow(
        /以下字段为必填项：客诉类别/,
      );

      const result = await requiredUser().ticket.create({
        ...validInput(),
        categoryId: category.id,
      });
      const detail = await requiredUser().ticket.detail({ id: result.id });
      expect(detail.category?.name).toBe("必填用类别");

      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: { requiredTicketFields: ["customerName", "phone", "channelId", "hasContacted"] },
      });
    });

    it("enforces 进线时间/投诉信息接收渠道 when configured required", async () => {
      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: {
          requiredTicketFields: [
            "customerName",
            "phone",
            "channelId",
            "hasContacted",
            "contactTime",
            "complaintReceiveChannel",
          ],
        },
      });

      const error = await requiredUser()
        .ticket.create(validInput())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).message).toContain("以下字段为必填项");
      expect((error as TRPCError).message).toContain("进线时间");
      expect((error as TRPCError).message).toContain("投诉信息接收渠道");

      const result = await requiredUser().ticket.create({
        ...validInput(),
        contactTime: "2026-07-14T02:00:00.000Z",
        complaintReceiveChannel: "邮箱接收",
      });
      const detail = await requiredUser().ticket.detail({ id: result.id });
      expect(detail.contactTime).toBe("2026-07-14T02:00:00.000Z");
      expect(detail.complaintReceiveChannel).toBe("邮箱接收");

      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: { requiredTicketFields: ["customerName", "phone", "channelId", "hasContacted"] },
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
        data: { requiredTicketFields: ["customerName", "unknownField", "channelId"] },
      });

      const input = {
        ...validInput(),
        customerName: "李四",
      };
      const result = await requiredUser().ticket.create(input);
      expect(result.workOrderNumber).toMatch(/^WO\d{6,}$/);
    });
  });

  describe("ticket.edit (不受必填约束)", () => {
    it("allows editing to clear a required field", async () => {
      const created = await requiredUser().ticket.create(validInput());

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
      const created = await requiredUser().ticket.create(validInput());

      const allNull = {
        ticketId: created.id,
        ...Object.fromEntries(TICKET_CREATE_FIELD_KEYS.map((key) => [key, null])),
      } as TicketEditInput;

      const edited = await requiredUser().ticket.edit(allNull);
      expect(edited).toBeDefined();
    });
  });

  describe("role.list includes requiredTicketFields", () => {
    it("returns requiredTicketFields in role list", async () => {
      // Reset the role to original state after previous tests modified it
      await prisma.role.update({
        where: { id: roleWithRequired.id },
        data: { requiredTicketFields: ["customerName", "phone", "channelId", "hasContacted"] },
      });

      const roles = await admin().role.list();
      const testRole = roles.find((r) => r.id === roleWithRequired.id);
      expect(testRole?.requiredTicketFields).toContain("customerName");
      expect(testRole?.requiredTicketFields).toContain("phone");
      expect(testRole?.requiredTicketFields).toContain("channelId");
      expect(testRole?.requiredTicketFields).toContain("hasContacted");
    });

    it("shows empty array for roles without required fields", async () => {
      const roles = await admin().role.list();
      const adminRole = roles.find((r) => r.id === seeded.roles.admin.id);
      expect(adminRole?.requiredTicketFields).toEqual([]);
    });
  });
});
