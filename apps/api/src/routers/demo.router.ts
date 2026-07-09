import { z } from "zod";
import { protectedProcedure, requirePermission, router } from "../trpc";

/**
 * Demo router for testing RBAC guards.
 * Contains probe procedures that require specific permissions to test
 * that the requirePermission guard properly rejects unauthorized users.
 *
 * From acceptance criteria:
 * "Demo: admin vs 一线客服 me differ; guarded probe rejects the frontline user"
 */

export const demoRouter = router({
  /**
   * Probe endpoint that requires ticket.assign permission.
   * Frontline CS users (一线客服) lack this permission and should be rejected.
   * Managers and admins have this permission and should succeed.
   */
  assignProbe: requirePermission("ticket.assign")
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
        user: z.string(),
        permission: z.string(),
      }),
    )
    .query(({ ctx }) => {
      return {
        success: true,
        message: "You have ticket.assign permission",
        user: ctx.user.name,
        permission: "ticket.assign",
      };
    }),

  /**
   * Probe endpoint that requires dashboard.view_all permission.
   * Frontline CS users lack this permission (they can only see their own data).
   * Managers, admins, and observers have this permission.
   */
  viewAllDataProbe: requirePermission("dashboard.view_all")
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
        user: z.string(),
        permission: z.string(),
      }),
    )
    .query(({ ctx }) => {
      return {
        success: true,
        message: "You have dashboard.view_all permission",
        user: ctx.user.name,
        permission: "dashboard.view_all",
      };
    }),

  /**
   * Probe endpoint that any authenticated user can access.
   * Tests that protectedProcedure works without permission checks.
   */
  authenticatedProbe: protectedProcedure
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
        user: z.string(),
        roleId: z.string(),
        roleName: z.string(),
      }),
    )
    .query(({ ctx }) => {
      return {
        success: true,
        message: "You are authenticated",
        user: ctx.user.name,
        roleId: ctx.user.roleId,
        roleName: ctx.user.roleName,
      };
    }),
});
