import { PRESET_ROLES, type Permission } from "@insuredesk/shared";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, visibleNavItems } from "./navigation";

/**
 * Menu visibility per preset role — the PRD §5.1 page-permission matrix.
 * Each menu entry maps 1:1 to a page permission point; an entry only shows
 * when the role holds that permission.
 */

function visiblePaths(permissions: readonly Permission[]): string[] {
  return visibleNavItems(permissions).map((item) => item.path);
}

describe("NAV_ITEMS", () => {
  it("covers the five page permissions, one menu entry each", () => {
    expect(NAV_ITEMS.map((item) => item.permission)).toEqual([
      "dashboard.view",
      "ticket.view",
      "user.view",
      "role.view",
      "schedule.view",
    ]);
  });
});

describe("visibleNavItems", () => {
  it("管理员 sees all five menu entries", () => {
    expect(visiblePaths(PRESET_ROLES.ADMIN.permissions)).toEqual([
      "/dashboard",
      "/tickets",
      "/users",
      "/roles",
      "/schedule",
    ]);
  });

  it("客服主管 sees dashboard, tickets and schedule", () => {
    expect(visiblePaths(PRESET_ROLES.CS_MANAGER.permissions)).toEqual([
      "/dashboard",
      "/tickets",
      "/schedule",
    ]);
  });

  it("一线客服 sees dashboard and tickets only", () => {
    expect(visiblePaths(PRESET_ROLES.FRONTLINE_CS.permissions)).toEqual(["/dashboard", "/tickets"]);
  });

  it("只读观察 sees dashboard and tickets only", () => {
    expect(visiblePaths(PRESET_ROLES.READ_ONLY.permissions)).toEqual(["/dashboard", "/tickets"]);
  });

  it("returns nothing for a role with no page permissions", () => {
    expect(visiblePaths([])).toEqual([]);
  });

  it("ignores non-page permissions", () => {
    expect(visiblePaths(["ticket.process", "schedule.edit"])).toEqual([]);
  });
});
