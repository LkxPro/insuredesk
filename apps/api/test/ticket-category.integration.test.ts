import {
  type Permission,
  TICKET_CREATE_FIELD_KEYS,
  type TicketCreateInput,
} from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import type { AuthenticatedUser } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * TicketCategory catalog smoke tests (issue #93). Full lifecycle coverage now lives
 * in dictionary-catalog.integration.test.ts; this suite only verifies
 * category-specific quirks: factory seed, basic CRUD, and deletion guard.
 */
describe("TicketCategory catalog smoke (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let seeded: IntegrationHarness["seeded"];

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "slaPolicies", "categories"],
    });
    seeded = harness.seeded;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  function callerWith(user: User, permissions: Permission[]) {
    const identity: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      team: user.team,
      roleId: "role-under-test",
      roleName: "目录管理员",
      permissions,
      requiredTicketFields: [],
    };
    return appRouter.createCaller({
      traceId: "category-smoke",
      user: identity,
      sessionToken: null,
    });
  }

  const manager = () =>
    callerWith(seeded.users.manager, [
      "dictionary.manage",
      "ticket.view",
      "ticket.view_all",
      "ticket.create",
      "ticket.edit",
      "ticket.delete",
    ] as Permission[]);

  it("seeds the 17 factory categories once", async () => {
    const categories = await manager().ticketCategory.list();
    expect(categories.length).toBe(17);
    expect(categories.map((c) => c.name)).toContain("监管投诉-引导性");
    expect(categories.map((c) => c.name)).toContain("其他");
  });

  it("creates a new category", async () => {
    const created = await manager().ticketCategory.create({
      name: "测试新增类别",
      displayOrder: 90,
    });
    expect(created).toMatchObject({
      name: "测试新增类别",
      displayOrder: 90,
      active: true,
    });
  });

  it("renames a category", async () => {
    const created = await manager().ticketCategory.create({
      name: "待重命名类别",
      displayOrder: 100,
    });
    const updated = await manager().ticketCategory.update({
      id: created.id,
      name: "已重命名类别",
      displayOrder: 100,
    });
    expect(updated.name).toBe("已重命名类别");
  });

  it("disables a category", async () => {
    const created = await manager().ticketCategory.create({
      name: "待停用类别",
      displayOrder: 110,
    });
    await manager().ticketCategory.setActive({ id: created.id, active: false });
    const categories = await manager().ticketCategory.list();
    const disabled = categories.find((c) => c.id === created.id);
    expect(disabled?.active).toBe(false);
  });

  it("rejects deletion of a referenced category", async () => {
    const category = await manager().ticketCategory.create({
      name: "被引用类别",
      displayOrder: 120,
    });
    await manager().ticket.create({
      ...Object.fromEntries(TICKET_CREATE_FIELD_KEYS.map((key) => [key, null])),
      categoryId: category.id,
    } as TicketCreateInput);

    await expect(manager().ticketCategory.delete({ id: category.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该类别已被 1 张工单使用，无法删除，可改为停用",
    });
  });
});
