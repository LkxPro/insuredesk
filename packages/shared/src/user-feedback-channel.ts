import type { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog.ts";

/** 用户反馈渠道目录 contracts；共同形状与措辞见 dictionary-catalog. */
export const userFeedbackChannelCatalogSchemas = createCatalogSchemas("渠道");

export const userFeedbackChannelCreateInputSchema =
  userFeedbackChannelCatalogSchemas.createInputSchema;
export type UserFeedbackChannelCreateInput = z.infer<typeof userFeedbackChannelCreateInputSchema>;

export const userFeedbackChannelUpdateInputSchema =
  userFeedbackChannelCatalogSchemas.updateInputSchema;
export type UserFeedbackChannelUpdateInput = z.infer<typeof userFeedbackChannelUpdateInputSchema>;

export const userFeedbackChannelSetActiveInputSchema =
  userFeedbackChannelCatalogSchemas.setActiveInputSchema;
export type UserFeedbackChannelSetActiveInput = z.infer<
  typeof userFeedbackChannelSetActiveInputSchema
>;

export const userFeedbackChannelDeleteInputSchema =
  userFeedbackChannelCatalogSchemas.deleteInputSchema;
export type UserFeedbackChannelDeleteInput = z.infer<typeof userFeedbackChannelDeleteInputSchema>;