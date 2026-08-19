import type { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog.ts";

/** 用户投诉渠道目录 contracts；共同形状与措辞见 dictionary-catalog. */
export const userComplaintChannelCatalogSchemas = createCatalogSchemas("渠道");

export const userComplaintChannelCreateInputSchema =
  userComplaintChannelCatalogSchemas.createInputSchema;
export type UserComplaintChannelCreateInput = z.infer<typeof userComplaintChannelCreateInputSchema>;

export const userComplaintChannelUpdateInputSchema =
  userComplaintChannelCatalogSchemas.updateInputSchema;
export type UserComplaintChannelUpdateInput = z.infer<typeof userComplaintChannelUpdateInputSchema>;

export const userComplaintChannelSetActiveInputSchema =
  userComplaintChannelCatalogSchemas.setActiveInputSchema;
export type UserComplaintChannelSetActiveInput = z.infer<
  typeof userComplaintChannelSetActiveInputSchema
>;

export const userComplaintChannelDeleteInputSchema =
  userComplaintChannelCatalogSchemas.deleteInputSchema;
export type UserComplaintChannelDeleteInput = z.infer<typeof userComplaintChannelDeleteInputSchema>;
