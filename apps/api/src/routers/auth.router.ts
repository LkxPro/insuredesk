import { changeOwnPasswordInputSchema } from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "../db";
import {
  changeOwnPassword,
  IncorrectOldPasswordError,
  NoPasswordAccountError,
} from "../services/auth.service";
import { protectedProcedure, requireNotForbidden, router } from "../trpc";

/**
 * Authentication router - handles identity queries and self-service
 * credential changes. Login/logout are handled via REST endpoints in
 * server.ts for easier cookie handling.
 */

const meOutputSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  team: z.string().nullable(),
  roleId: z.string(),
  roleName: z.string(),
  permissions: z.array(z.string()),
  requiredTicketFields: z.array(z.string()),
  /** true = 外部账号；导航菜单按此二分内外部视图，不靠权限点反推。 */
  isExternal: z.boolean(),
});

/** Domain error → transport code. */
function toTRPCError(error: unknown): never {
  if (error instanceof IncorrectOldPasswordError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (error instanceof NoPasswordAccountError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
  }
  throw error;
}

export const authRouter = router({
  /**
   * Get current authenticated user identity and resolved permission set.
   * This is the "me" query from the acceptance criteria.
   *
   * Returns the authenticated user's profile and their full permission list
   * resolved from their role. Used by the frontend to determine what UI
   * elements to show and what actions are allowed.
   *
   * 包含当前用户角色的建单必填字段集，用于动态生成表单校验。
   */
  me: protectedProcedure.output(meOutputSchema).query(({ ctx }) => {
    return {
      id: ctx.user.id,
      username: ctx.user.username,
      name: ctx.user.name,
      email: ctx.user.email,
      team: ctx.user.team,
      roleId: ctx.user.roleId,
      roleName: ctx.user.roleName,
      permissions: ctx.user.permissions,
      requiredTicketFields: ctx.user.requiredTicketFields,
      isExternal: ctx.user.isExternal,
    };
  }),

  /** 自助改密 — kicks every other session, keeps the caller's own. */
  changeOwnPassword: requireNotForbidden("user.forbid_change_own_password")
    .input(changeOwnPasswordInputSchema)
    .mutation(({ ctx, input }) =>
      changeOwnPassword(prisma, ctx.user.id, ctx.sessionToken, input).catch(toTRPCError),
    ),
});
