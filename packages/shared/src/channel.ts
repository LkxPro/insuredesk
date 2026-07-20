import type { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog";

/**
 * 反馈渠道目录 contracts. Tickets reference catalog rows by id, so a rename
 * propagates everywhere at read time; only the ProcessLog remark keeps the
 * literal name snapshot of the moment.
 */

const schemas = createCatalogSchemas("渠道");

export const channelCreateInputSchema = schemas.createInputSchema;
export type ChannelCreateInput = z.infer<typeof channelCreateInputSchema>;

export const channelUpdateInputSchema = schemas.updateInputSchema;
export type ChannelUpdateInput = z.infer<typeof channelUpdateInputSchema>;

export const channelSetActiveInputSchema = schemas.setActiveInputSchema;
export type ChannelSetActiveInput = z.infer<typeof channelSetActiveInputSchema>;

export const channelDeleteInputSchema = schemas.deleteInputSchema;
export type ChannelDeleteInput = z.infer<typeof channelDeleteInputSchema>;
