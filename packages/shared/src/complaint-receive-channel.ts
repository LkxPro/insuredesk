import type { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog.ts";

export const complaintReceiveChannelCatalogSchemas = createCatalogSchemas("渠道");

export const complaintReceiveChannelCreateInputSchema =
  complaintReceiveChannelCatalogSchemas.createInputSchema;
export type ComplaintReceiveChannelCreateInput = z.infer<
  typeof complaintReceiveChannelCreateInputSchema
>;

export const complaintReceiveChannelUpdateInputSchema =
  complaintReceiveChannelCatalogSchemas.updateInputSchema;
export type ComplaintReceiveChannelUpdateInput = z.infer<
  typeof complaintReceiveChannelUpdateInputSchema
>;

export const complaintReceiveChannelSetActiveInputSchema =
  complaintReceiveChannelCatalogSchemas.setActiveInputSchema;
export type ComplaintReceiveChannelSetActiveInput = z.infer<
  typeof complaintReceiveChannelSetActiveInputSchema
>;

export const complaintReceiveChannelDeleteInputSchema =
  complaintReceiveChannelCatalogSchemas.deleteInputSchema;
export type ComplaintReceiveChannelDeleteInput = z.infer<
  typeof complaintReceiveChannelDeleteInputSchema
>;
