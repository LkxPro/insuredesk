import type { Permission } from "@insuredesk/shared";
import { POSITIVE_PERMISSIONS } from "@insuredesk/shared";

/**
 * Permission-set personas for tests: an admin holding every positive
 * permission (mirroring the server's system-role expansion, which excludes
 * restrictive points) plus three typical staff profiles (mirroring the
 * factory roles the api seeds). Roles are runtime configuration, so tests
 * pin their own sets here instead of reading anything from the seed.
 */
export const TEST_ROLES = {
  ADMIN: {
    name: "管理员",
    permissions: [...POSITIVE_PERMISSIONS] as Permission[],
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
  /**
   * 外部账号：提交/留言两点（种子缺省）。内外部之分另由 isExternal
   * 决定（见 renderApp 的 isExternal 参数），权限集只是必要条件。
   */
  EXTERNAL: {
    name: "外部用户",
    permissions: ["ticket.create_external", "ticket.process_external"] as Permission[],
  },
} as const;
