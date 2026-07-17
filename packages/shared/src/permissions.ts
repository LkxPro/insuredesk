import { z } from "zod";

/**
 * Flat permission-point string enum covering all access controls in the system.
 * Permission points are organized by feature area but stored as flat strings.
 * Roles are collections of permission points, managed in the database.
 */

// Dashboard permissions
export const DASHBOARD_PERMISSIONS = [
  "dashboard.view", // Access data dashboard (page permission)
  "dashboard.view_all", // View all data (data permission)
  "dashboard.export", // Export data reports (operation permission)
] as const;

// Ticket management permissions
export const TICKET_PERMISSIONS = [
  "ticket.view", // Access ticket list (page permission)
  "ticket.view_all", // View all tickets (data permission) - without this, only see tickets assigned to or created by oneself
  "ticket.create", // Create new ticket (operation permission)
  "ticket.edit", // Edit ticket basic info (operation permission)
  "ticket.process", // Process ticket - add comments/follow-ups (operation permission)
  "ticket.assign", // Assign ticket to user (operation permission)
  "ticket.batch_assign", // Batch assign tickets (operation permission)
  "ticket.export", // Export tickets (operation permission)
  "ticket.import", // Batch import tickets (operation permission)
  "ticket.delete", // Delete ticket - dangerous (operation permission)
] as const;

// User management permissions
export const USER_PERMISSIONS = [
  "user.view", // Access user management (page permission)
  "user.create", // Create new user (operation permission)
  "user.edit", // Edit user (operation permission)
  "user.delete", // Delete user (operation permission)
  "user.assign_role", // Assign role to user (operation permission)
] as const;

// Role permissions
export const ROLE_PERMISSIONS = [
  "role.view", // Access role management (page permission)
  "role.create", // Create new role (operation permission)
  "role.edit", // Edit role (operation permission)
  "role.delete", // Delete role (operation permission)
  "role.edit_permission", // Edit permission configuration (operation permission)
] as const;

// System configuration permissions
// sla.view / sla.edit / dictionary.manage are absent from the PRD permission
// matrix; they exist because SLA policies and the dictionary catalogs need
// their own pages + operation points. Out of the factory only 管理员
// holds them.
export const SYSTEM_PERMISSIONS = [
  "schedule.view", // Access schedule configuration (page permission)
  "schedule.edit", // Edit schedule (operation permission)
  "schedule.manage_shifts", // Manage shift definitions (admin configuration)
  "sla.view", // Access SLA policy configuration (page permission)
  "sla.edit", // Edit SLA policies (operation permission)
  "dictionary.manage", // Manage the dictionary catalogs (admin configuration)
] as const;

// All permissions combined
export const ALL_PERMISSIONS = [
  ...DASHBOARD_PERMISSIONS,
  ...TICKET_PERMISSIONS,
  ...USER_PERMISSIONS,
  ...ROLE_PERMISSIONS,
  ...SYSTEM_PERMISSIONS,
] as const;

export const permissionSchema = z.enum(ALL_PERMISSIONS);
export type Permission = (typeof ALL_PERMISSIONS)[number];

/**
 * Human-readable labels for the 权限点清单, used by the 角色权限 checklist UI.
 * Wording follows the PRD except user.delete: the PRD names the point
 * "删除用户" but its operation is 禁用/启用 — accounts are never hard deleted
 * (they anchor tickets, logs, and rosters), so the label says what the
 * permission actually grants.
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
};

/** 权限点清单 checklist grouping, in PRD document order. */
export const PERMISSION_GROUPS = [
  { label: "数据看板", permissions: DASHBOARD_PERMISSIONS },
  { label: "工单管理", permissions: TICKET_PERMISSIONS },
  { label: "用户管理", permissions: USER_PERMISSIONS },
  { label: "角色权限", permissions: ROLE_PERMISSIONS },
  { label: "系统配置", permissions: SYSTEM_PERMISSIONS },
] as const;
