import type { Permission } from "@insuredesk/shared";
import { describe, expect, it } from "vitest";
import { TEST_ROLES } from "@/test/roles";
import { NAV_ITEMS, visibleNavItems } from "./navigation";

function visiblePaths(permissions: readonly Permission[]): string[] {
  return visibleNavItems(permissions).map((item) => item.path);
}

describe("NAV_ITEMS", () => {
  it("covers the ten page permissions, one menu entry each", () => {
    expect(NAV_ITEMS.map((item) => item.permission)).toEqual([
      "dashboard.view",
      "ticket.create_external",
      "ticket.view",
      "user.view",
      "external_account.manage",
      "role.view",
      "schedule.view",
      "schedule.manage_shifts",
      "sla.view",
      "dictionary.manage",
    ]);
  });
});

describe("visibleNavItems", () => {
  it("管理员 sees all nine menu entries", () => {
    expect(visiblePaths(TEST_ROLES.ADMIN.permissions)).toEqual([
      "/dashboard",
      "/tickets",
      "/users",
      "/external-accounts",
      "/roles",
      "/schedule",
      "/shift-types",
      "/sla",
      "/dictionary",
    ]);
  });

  it("客服主管 sees dashboard, tickets, and schedule", () => {
    expect(visiblePaths(TEST_ROLES.CS_MANAGER.permissions)).toEqual([
      "/dashboard",
      "/tickets",
      "/schedule",
    ]);
  });

  it("一线客服 sees dashboard and tickets only", () => {
    expect(visiblePaths(TEST_ROLES.FRONTLINE_CS.permissions)).toEqual(["/dashboard", "/tickets"]);
  });

  it("只读观察 sees dashboard and tickets only", () => {
    expect(visiblePaths(TEST_ROLES.READ_ONLY.permissions)).toEqual(["/dashboard", "/tickets"]);
  });

  it("returns nothing for a role with no page permissions", () => {
    expect(visiblePaths([])).toEqual([]);
  });

  it("ignores non-page permissions", () => {
    expect(visiblePaths(["ticket.process", "schedule.edit"])).toEqual([]);
  });
});

/**
 * 内外部二分靠 isExternal，不靠权限点：管理员展开后同样持有
 * ticket.create_external，却必须看到 工单管理 而不是 我的工单。
 */
describe("外部账号的菜单", () => {
  const externalPermissions: Permission[] = ["ticket.create_external", "ticket.process_external"];

  it("外部账号 sees 我的工单 only", () => {
    expect(visibleNavItems(externalPermissions, true).map((item) => item.path)).toEqual([
      "/external-tickets",
    ]);
  });

  it("外部账号 with ticket.view still never gets 工单管理", () => {
    const paths = visibleNavItems([...externalPermissions, "ticket.view"], true).map(
      (item) => item.path,
    );
    expect(paths).toEqual(["/external-tickets"]);
  });

  it("管理员 holding the external permission stays on 工单管理", () => {
    const paths = visibleNavItems(TEST_ROLES.ADMIN.permissions).map((item) => item.path);
    expect(paths).toContain("/tickets");
    expect(paths).not.toContain("/external-tickets");
  });
});
