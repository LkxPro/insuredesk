import type { Permission } from "@insuredesk/shared";
import { z } from "zod";
import { protectedProcedure, requirePermission, router } from "../trpc.ts";

const permissionProbeOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  user: z.string(),
  permission: z.string(),
});

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
  assignProbe: permissionProbe("ticket.assign"),

  viewAllDataProbe: permissionProbe("dashboard.view_all"),

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
