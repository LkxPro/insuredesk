import type { Permission } from "@insuredesk/shared";
import { z } from "zod";
import { protectedProcedure, requirePermission, router } from "../trpc.ts";

/**
 * Demo router for testing RBAC guards.
 * Contains probe procedures that require specific permissions to test
 * that the requirePermission guard properly rejects unauthorized users.
 *
 * From acceptance criteria:
 * "Demo: admin vs 一线客服 me differ; guarded probe rejects the frontline user"
 */

const permissionProbeOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  user: z.string(),
  permission: z.string(),
});

/**
 * Build a probe procedure guarded by the given permission. Reaching the
 * handler means the guard passed, so it just echoes who got in and which
 * permission was checked.
 */
function permissionProbe(permission: Permission) {
  return requirePermission(permission)
    .output(permissionProbeOutput)
    .query(({ ctx }) => ({
      success: true,
      message: `You have ${permission} permission`,
      user: ctx.user.name,
      permission,
    }));
}

export const demoRouter = router({
  /**
   * Requires ticket.assign: frontline CS users (一线客服) lack it and are
   * rejected; managers and admins succeed.
   */
  assignProbe: permissionProbe("ticket.assign"),

  /**
   * Requires dashboard.view_all: frontline CS users lack it (they only see
   * their own data); managers, admins, and observers succeed.
   */
  viewAllDataProbe: permissionProbe("dashboard.view_all"),

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
