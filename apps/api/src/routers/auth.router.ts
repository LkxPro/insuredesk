import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

/**
 * Authentication router - handles identity queries.
 * Login/logout are handled via REST endpoints in server.ts for easier cookie handling.
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
});

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
    };
  }),
});
