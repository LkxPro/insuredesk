import {
  channelCreateInputSchema,
  channelDeleteInputSchema,
  channelSetActiveInputSchema,
  channelUpdateInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db";
import {
  ChannelInUseError,
  ChannelNameConflictError,
  ChannelNotFoundError,
  createChannel,
  deleteChannel,
  listChannelFilterOptions,
  listChannelOptions,
  listChannels,
  setChannelActive,
  updateChannel,
} from "../services/channel.service";
import { protectedProcedure, requirePermission, router } from "../trpc";

function translateError(error: unknown): never {
  if (error instanceof ChannelNameConflictError || error instanceof ChannelInUseError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof ChannelNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
}

const manageDictionaryProcedure = requirePermission("dictionary.manage");

export const channelRouter = router({
  list: manageDictionaryProcedure.query(() => listChannels(prisma)),
  /** 建单/编辑下拉的数据源：任何登录用户可读，只含启用项。 */
  options: protectedProcedure.query(() => listChannelOptions(prisma)),
  /** 工单列表筛选的数据源：全目录含停用项，任何登录用户可读。 */
  filterOptions: protectedProcedure.query(() => listChannelFilterOptions(prisma)),
  create: manageDictionaryProcedure.input(channelCreateInputSchema).mutation(async ({ input }) => {
    try {
      return await createChannel(prisma, input);
    } catch (error) {
      translateError(error);
    }
  }),
  update: manageDictionaryProcedure.input(channelUpdateInputSchema).mutation(async ({ input }) => {
    try {
      return await updateChannel(prisma, input);
    } catch (error) {
      translateError(error);
    }
  }),
  setActive: manageDictionaryProcedure
    .input(channelSetActiveInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await setChannelActive(prisma, input.id, input.active);
      } catch (error) {
        translateError(error);
      }
    }),
  delete: manageDictionaryProcedure.input(channelDeleteInputSchema).mutation(async ({ input }) => {
    try {
      return await deleteChannel(prisma, input.id);
    } catch (error) {
      translateError(error);
    }
  }),
});
