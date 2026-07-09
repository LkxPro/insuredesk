import { z } from "zod";

/**
 * Flat permission-point string enum covering all access controls in the system.
 * See PRD §5.1 for the complete permission matrix and role mappings.
 *
 * Permission points are organized by feature area but stored as flat strings.
 * Roles are collections of permission points, managed in the database.
 */

// Dashboard permissions
export const DASHBOARD_PERMISSIONS = [
  "dashboard.view",       // Access data dashboard (page permission)
  "dashboard.view_all",   // View all data (data permission)
  "dashboard.export",     // Export data reports (operation permission)
] as const;

// Ticket management permissions
export const TICKET_PERMISSIONS = [
  "ticket.view",          // Access ticket list (page permission)
  "ticket.view_all",      // View all tickets (data permission) - without this, only see assigned tickets
  "ticket.create",        // Create new ticket (operation permission)
  "ticket.edit",          // Edit ticket basic info (operation permission)
  "ticket.process",       // Process ticket - add comments/follow-ups (operation permission)
  "ticket.assign",        // Assign ticket to user (operation permission)
  "ticket.batch_assign",  // Batch assign tickets (operation permission)
  "ticket.export",        // Export tickets (operation permission)
  "ticket.delete",        // Delete ticket - dangerous (operation permission)
] as const;

// User management permissions
export const USER_PERMISSIONS = [
  "user.view",            // Access user management (page permission)
  "user.create",          // Create new user (operation permission)
  "user.edit",            // Edit user (operation permission)
  "user.delete",          // Delete user (operation permission)
  "user.assign_role",     // Assign role to user (operation permission)
] as const;

// Role permissions
export const ROLE_PERMISSIONS = [
  "role.view",            // Access role management (page permission)
  "role.create",          // Create new role (operation permission)
  "role.edit",            // Edit role (operation permission)
  "role.delete",          // Delete role (operation permission)
  "role.edit_permission", // Edit permission configuration (operation permission)
] as const;

// System configuration permissions
export const SYSTEM_PERMISSIONS = [
  "schedule.view",        // Access schedule configuration (page permission)
  "schedule.edit",        // Edit schedule (operation permission)
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

// Preset role permission mappings (used in seed data)
// See PRD §5.2 for role descriptions

export const PRESET_ROLES = {
  /**
   * 管理员 (Admin) - Full system access
   */
  ADMIN: {
    name: "管理员",
    permissions: [...ALL_PERMISSIONS],
  },

  /**
   * 客服主管 (CS Manager) - Can view all data, assign tickets, export reports
   */
  CS_MANAGER: {
    name: "客服主管",
    permissions: [
      // Dashboard - full access
      "dashboard.view",
      "dashboard.view_all",
      "dashboard.export",
      // Tickets - full access except delete
      "ticket.view",
      "ticket.view_all",
      "ticket.create",
      "ticket.edit",
      "ticket.process",
      "ticket.assign",
      "ticket.batch_assign",
      "ticket.export",
      // Schedule - view and edit
      "schedule.view",
      "schedule.edit",
    ] as Permission[],
  },

  /**
   * 一线客服 (Frontline CS) - Can only view and process their own assigned tickets
   */
  FRONTLINE_CS: {
    name: "一线客服",
    permissions: [
      // Dashboard - view only
      "dashboard.view",
      // Tickets - view and process own tickets only (no ticket.view_all)
      "ticket.view",
      "ticket.process",
    ] as Permission[],
  },

  /**
   * 只读观察 (Read-only Observer) - Can view all data but no operations
   */
  READ_ONLY: {
    name: "只读观察",
    permissions: [
      // Dashboard - view all data
      "dashboard.view",
      "dashboard.view_all",
      // Tickets - view all tickets only
      "ticket.view",
      "ticket.view_all",
    ] as Permission[],
  },
} as const;
