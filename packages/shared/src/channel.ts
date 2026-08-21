import type { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog.ts";

export const channelCatalogSchemas = createCatalogSchemas("渠道");

export const channelCreateInputSchema = channelCatalogSchemas.createInputSchema;
export type ChannelCreateInput = z.infer<typeof channelCreateInputSchema>;

export const channelUpdateInputSchema = channelCatalogSchemas.updateInputSchema;
export type ChannelUpdateInput = z.infer<typeof channelUpdateInputSchema>;

export const channelSetActiveInputSchema = channelCatalogSchemas.setActiveInputSchema;
export type ChannelSetActiveInput = z.infer<typeof channelSetActiveInputSchema>;

export const channelDeleteInputSchema = channelCatalogSchemas.deleteInputSchema;
export type ChannelDeleteInput = z.infer<typeof channelDeleteInputSchema>;
