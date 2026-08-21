import type { Permission } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/routers/index.ts";
import type { AuthenticatedUser } from "../src/services/auth.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("TicketCategory filter options (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let seeded: IntegrationHarness["seeded"];

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
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
      isExternal: false,
    };
    return appRouter.createCaller({
      traceId: "ticket-category-filter-options-test",
      user: identity,
      sessionToken: null,
    });
  }

  const manager = () => callerWith(seeded.users.manager, ["dictionary.manage"] as Permission[]);
  const frontline = () => callerWith(seeded.users.cs1, ["ticket.view"] as Permission[]);

  it("returns the whole catalog with active flags — 停用 rows included, in display order", async () => {
    const kept = await manager().ticketCategory.create({ name: "筛选保留", displayOrder: 301 });
    const disabled = await manager().ticketCategory.create({ name: "筛选停用", displayOrder: 302 });
    await manager().ticketCategory.setActive({ id: disabled.id, active: false });

    const filterOptions = await frontline().ticketCategory.filterOptions();
    const tail = filterOptions.slice(-2);
    expect(tail).toEqual([
      { id: kept.id, name: "筛选保留", active: true },
      { id: disabled.id, name: "筛选停用", active: false },
    ]);

    const optionNames = (await frontline().ticketCategory.options()).map((o) => o.name);
    expect(optionNames).toContain("筛选保留");
    expect(optionNames).not.toContain("筛选停用");
  });
});
