import type { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog.ts";

export const completionStatusCatalogSchemas = createCatalogSchemas("状态");

export const completionStatusCreateInputSchema = completionStatusCatalogSchemas.createInputSchema;
export type CompletionStatusCreateInput = z.infer<typeof completionStatusCreateInputSchema>;

export const completionStatusUpdateInputSchema = completionStatusCatalogSchemas.updateInputSchema;
export type CompletionStatusUpdateInput = z.infer<typeof completionStatusUpdateInputSchema>;

export const completionStatusSetActiveInputSchema =
  completionStatusCatalogSchemas.setActiveInputSchema;
export type CompletionStatusSetActiveInput = z.infer<typeof completionStatusSetActiveInputSchema>;

export const completionStatusDeleteInputSchema = completionStatusCatalogSchemas.deleteInputSchema;
export type CompletionStatusDeleteInput = z.infer<typeof completionStatusDeleteInputSchema>;
