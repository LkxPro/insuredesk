import { z } from "zod";

export const DASHBOARD_PERMISSIONS = [
  "dashboard.view",
  "dashboard.view_all",
  "dashboard.export",
] as const;

export const TICKET_PERMISSIONS = [
  "ticket.view",
  "ticket.view_all", // without this, only see tickets assigned to or created by oneself
  "ticket.create",
  "ticket.edit",
  "ticket.process",
  "ticket.assign",
  "ticket.batch_assign",
  "ticket.export",
  "ticket.import",
  "ticket.delete",
  "ticket.create_external",
  "ticket.process_external",
] as const;

export const USER_PERMISSIONS = [
  "user.view",
  "user.create",
  "user.edit",
  "user.delete",
  "user.assign_role",
] as const;

export const EXTERNAL_ACCOUNT_PERMISSIONS = ["external_account.manage"] as const;

export const OPEN_API_PERMISSIONS = ["api_key.manage", "api_key.revoke_all"] as const;

/**
 * Points that mark a role as belonging to an 外部账号 rather than an
 * internal one — holding either makes the role an 外部角色. 同时是外部口子的
 * 专用点：管理端 checklist 不出售，普通角色配上也无入口。外部角色的权限数组
 * 由种子维护，不经角色管理。
 */
export const EXTERNAL_ROLE_PERMISSIONS = [
  "ticket.create_external",
  "ticket.process_external",
] as const;

/**
 * 外部角色判定. Never feed this the expanded permission set of a system role:
 * 管理员 expands to every positive point (external ones included) yet is an
 * internal account — pass the role's stored array, and treat system roles as
 * internal outright.
 */
export function isExternalRole(role: { system: boolean; permissions: readonly string[] }): boolean {
  if (role.system) {
    return false;
  }
  return EXTERNAL_ROLE_PERMISSIONS.some((permission) => role.permissions.includes(permission));
}

export const ROLE_PERMISSIONS = [
  "role.view",
  "role.create",
  "role.edit",
  "role.delete",
  "role.edit_permission",
] as const;

export const SYSTEM_PERMISSIONS = [
  "schedule.view",
  "schedule.edit",
  "schedule.manage_shifts",
  "sla.view",
  "sla.edit",
  "dictionary.manage",
] as const;

// Restrictive permissions: checked = forbidden, the inverse of every other
// point. Kept in their own list so positive-permission consumers (admin
// expansion, menu gating) can exclude them wholesale.
export const RESTRICTIVE_PERMISSIONS = ["user.forbid_change_own_password"] as const;

// All positive (grant-type) permissions — what the 管理员 system role expands
// to. Must never include restrictive points, or admin would be auto-forbidden.
export const POSITIVE_PERMISSIONS = [
  ...DASHBOARD_PERMISSIONS,
  ...TICKET_PERMISSIONS,
  ...USER_PERMISSIONS,
  ...ROLE_PERMISSIONS,
  ...SYSTEM_PERMISSIONS,
  ...EXTERNAL_ACCOUNT_PERMISSIONS,
  ...OPEN_API_PERMISSIONS,
] as const;

export const ALL_PERMISSIONS = [...POSITIVE_PERMISSIONS, ...RESTRICTIVE_PERMISSIONS] as const;

export const permissionSchema = z.enum(ALL_PERMISSIONS);
export type Permission = (typeof ALL_PERMISSIONS)[number];

/**
 * Human-readable labels for the 权限点清单, used by the 角色权限 checklist UI.
 * user.delete is labelled 禁用/启用 rather than "删除用户": accounts are never
 * hard deleted (they anchor tickets, logs, and rosters), so the label says what
 * the permission actually grants.
 */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "dashboard.view": "访问数据看板",
  "dashboard.view_all": "查看全部数据",
  "dashboard.export": "导出数据报表",
  "ticket.view": "访问工单列表",
  "ticket.view_all": "查看全部工单",
  "ticket.create": "新增工单",
  "ticket.edit": "编辑工单基本信息",
  "ticket.process": "处理工单",
  "ticket.assign": "分配工单",
  "ticket.batch_assign": "批量分配",
  "ticket.export": "导出工单",
  "ticket.import": "导入工单",
  "ticket.delete": "删除工单",
  "ticket.create_external": "提交外部工单",
  "ticket.process_external": "添加外部留言",
  "user.view": "访问用户管理",
  "user.create": "新增用户",
  "user.edit": "编辑用户",
  "user.delete": "禁用/启用用户",
  "user.assign_role": "分配角色",
  "role.view": "访问角色管理",
  "role.create": "新增角色",
  "role.edit": "编辑角色",
  "role.delete": "删除角色",
  "role.edit_permission": "编辑权限配置",
  "schedule.view": "访问排班配置",
  "schedule.edit": "编辑排班",
  "schedule.manage_shifts": "管理班次定义",
  "sla.view": "访问 SLA 策略",
  "sla.edit": "编辑 SLA 策略",
  "dictionary.manage": "管理字典目录",
  "external_account.manage": "管理外部账号",
  "api_key.manage": "管理自己的 API key",
  "api_key.revoke_all": "吊销用户的全部 API key",
  "user.forbid_change_own_password": "禁止修改自己的密码",
};

/**
 * 权限点清单 checklist grouping and display order. Restrictive groups
 * (`restrictive: true`) carry 勾选=禁止 semantics and must be visually marked
 * as such wherever the checklist renders.
 */
export const PERMISSION_GROUPS = [
  { label: "数据看板", permissions: DASHBOARD_PERMISSIONS, restrictive: false },
  { label: "工单管理", permissions: TICKET_PERMISSIONS, restrictive: false },
  { label: "用户管理", permissions: USER_PERMISSIONS, restrictive: false },
  { label: "角色权限", permissions: ROLE_PERMISSIONS, restrictive: false },
  { label: "系统配置", permissions: SYSTEM_PERMISSIONS, restrictive: false },
  { label: "外部账号", permissions: EXTERNAL_ACCOUNT_PERMISSIONS, restrictive: false },
  { label: "开放 API", permissions: OPEN_API_PERMISSIONS, restrictive: false },
  { label: "限制类权限", permissions: RESTRICTIVE_PERMISSIONS, restrictive: true },
] as const;

/**
 * Management-surface permission groups: PERMISSION_GROUPS minus the
 * external-only permission points. 角色管理 uses this to keep external points
 * out of the checklist, preventing new external roles from being created
 * through the UI.
 */
export const MANAGEMENT_PERMISSION_GROUPS = PERMISSION_GROUPS.map((group) => {
  if (group.label === "工单管理") {
    return {
      ...group,
      permissions: group.permissions.filter(
        (p) => !EXTERNAL_ROLE_PERMISSIONS.includes(p as (typeof EXTERNAL_ROLE_PERMISSIONS)[number]),
      ),
    };
  }
  return group;
});
