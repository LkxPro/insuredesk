import type { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog.ts";

/** 反馈信息接收渠道目录 contracts；共同形状与措辞见 dictionary-catalog. */
export const feedbackReceiveChannelCatalogSchemas = createCatalogSchemas("渠道");

export const feedbackReceiveChannelCreateInputSchema =
  feedbackReceiveChannelCatalogSchemas.createInputSchema;
export type FeedbackReceiveChannelCreateInput = z.infer<
  typeof feedbackReceiveChannelCreateInputSchema
>;

export const feedbackReceiveChannelUpdateInputSchema =
  feedbackReceiveChannelCatalogSchemas.updateInputSchema;
export type FeedbackReceiveChannelUpdateInput = z.infer<
  typeof feedbackReceiveChannelUpdateInputSchema
>;

export const feedbackReceiveChannelSetActiveInputSchema =
  feedbackReceiveChannelCatalogSchemas.setActiveInputSchema;
export type FeedbackReceiveChannelSetActiveInput = z.infer<
  typeof feedbackReceiveChannelSetActiveInputSchema
>;

export const feedbackReceiveChannelDeleteInputSchema =
  feedbackReceiveChannelCatalogSchemas.deleteInputSchema;
export type FeedbackReceiveChannelDeleteInput = z.infer<
  typeof feedbackReceiveChannelDeleteInputSchema
>;