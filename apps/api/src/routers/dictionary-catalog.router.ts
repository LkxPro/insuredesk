import type { CatalogSchemas } from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.ts";
import {
  CatalogInUseError,
  CatalogNameConflictError,
  CatalogNotFoundError,
  CatalogPinnedError,
  type CatalogService,
} from "../services/dictionary-catalog.service.ts";
import { protectedProcedure, requirePermission, router } from "../trpc.ts";

/** 目录 domain errors → transport codes; anything else rethrows as-is. */
function translateError(error: unknown): never {
  if (
    error instanceof CatalogNameConflictError ||
    error instanceof CatalogInUseError ||
    error instanceof CatalogPinnedError
  ) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof CatalogNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
}

export function createCatalogRouter(service: CatalogService, schemas: CatalogSchemas) {
  const manageDictionaryProcedure = requirePermission("dictionary.manage");
  return router({
    list: manageDictionaryProcedure.query(() => service.list(prisma)),
    /** 建单/编辑/完结弹窗下拉的数据源：任何登录用户可读，只含启用项。 */
    options: protectedProcedure.query(() => service.listOptions(prisma)),
    /** 工单列表筛选的数据源：全目录含停用项，任何登录用户可读。 */
    filterOptions: protectedProcedure.query(() => service.listFilterOptions(prisma)),
    create: manageDictionaryProcedure
      .input(schemas.createInputSchema)
      .mutation(async ({ input }) => {
        try {
          return await service.create(prisma, input);
        } catch (error) {
          translateError(error);
        }
      }),
    update: manageDictionaryProcedure
      .input(schemas.updateInputSchema)
      .mutation(async ({ input }) => {
        try {
          return await service.update(prisma, input);
        } catch (error) {
          translateError(error);
        }
      }),
    setActive: manageDictionaryProcedure
      .input(schemas.setActiveInputSchema)
      .mutation(async ({ input }) => {
        try {
          return await service.setActive(prisma, input.id, input.active);
        } catch (error) {
          translateError(error);
        }
      }),
    delete: manageDictionaryProcedure
      .input(schemas.deleteInputSchema)
      .mutation(async ({ input }) => {
        try {
          return await service.delete(prisma, input.id);
        } catch (error) {
          translateError(error);
        }
      }),
  });
}
