import {
  apiKeyCreatedSchema,
  apiKeyCreateInputSchema,
  apiKeyListInputSchema,
  apiKeyListItemSchema,
  apiKeyRevokeAllInputSchema,
  apiKeyRevokeInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "../db.ts";
import {
  ApiKeyLimitError,
  ApiKeyNotFoundError,
  createApiKey,
  listApiKeys,
  revokeAllApiKeysForUser,
  revokeApiKey,
} from "../services/api-key.service.ts";
import { requirePermission, router } from "../trpc.ts";

const deps = { prisma };

function toTRPCError(error: unknown): never {
  if (error instanceof ApiKeyLimitError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (error instanceof ApiKeyNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  throw error;
}

/** 自助管理面：list/create/revoke 全部钉死在 ctx.user 本人名下。 */
export const apiKeyRouter = router({
  list: requirePermission("api_key.manage")
    .input(apiKeyListInputSchema.optional())
    .output(z.array(apiKeyListItemSchema))
    .query(({ ctx, input }) => listApiKeys(deps, ctx.user, input?.includeRevoked)),

  create: requirePermission("api_key.manage")
    .input(apiKeyCreateInputSchema)
    .output(apiKeyCreatedSchema)
    .mutation(({ ctx, input }) =>
      createApiKey(deps, ctx.user, input, ctx.traceId).catch(toTRPCError),
    ),

  revoke: requirePermission("api_key.manage")
    .input(apiKeyRevokeInputSchema)
    .mutation(({ ctx, input }) =>
      revokeApiKey(deps, ctx.user, input, ctx.traceId).catch(toTRPCError),
    ),

  revokeAllForUser: requirePermission("api_key.revoke_all")
    .input(apiKeyRevokeAllInputSchema)
    .mutation(({ ctx, input }) =>
      revokeAllApiKeysForUser(deps, ctx.user.id, input, ctx.traceId).catch(toTRPCError),
    ),
});
