import type { Permission } from "@insuredesk/shared";
import { ALL_PERMISSIONS } from "@insuredesk/shared";

/**
 * Permission-set personas for tests: an all-permissions admin plus three
 * typical staff profiles (mirroring the factory roles the api seeds). Roles
 * are runtime configuration, so tests pin their own sets here instead of
 * reading anything from the seed.
 */
export const TEST_ROLES = {
  ADMIN: {
    name: "管理员",
    permissions: [...ALL_PERMISSIONS] as Permission[],
  },
  CS_MANAGER: {
    name: "客服主管",
    permissions: [
      "dashboard.view",
      "dashboard.view_all",
      "dashboard.export",
      "ticket.view",
      "ticket.view_all",
      "ticket.create",
      "ticket.edit",
      "ticket.process",
      "ticket.assign",
      "ticket.batch_assign",
      "ticket.export",
      "schedule.view",
      "schedule.edit",
    ] as Permission[],
  },
  FRONTLINE_CS: {
    name: "一线客服",
    permissions: ["dashboard.view", "ticket.view", "ticket.process"] as Permission[],
  },
  READ_ONLY: {
    name: "只读观察",
    permissions: [
      "dashboard.view",
      "dashboard.view_all",
      "ticket.view",
      "ticket.view_all",
    ] as Permission[],
  },
} as const;
