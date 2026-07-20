import type { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog";

/**
 * 完结状态目录 contracts. Tickets reference catalog rows by id, so a rename
 * propagates everywhere at read time; only the ProcessLog remark keeps the
 * literal name snapshot of the moment.
 */

const schemas = createCatalogSchemas("状态");

export const completionStatusCreateInputSchema = schemas.createInputSchema;
export type CompletionStatusCreateInput = z.infer<typeof completionStatusCreateInputSchema>;

export const completionStatusUpdateInputSchema = schemas.updateInputSchema;
export type CompletionStatusUpdateInput = z.infer<typeof completionStatusUpdateInputSchema>;

export const completionStatusSetActiveInputSchema = schemas.setActiveInputSchema;
export type CompletionStatusSetActiveInput = z.infer<typeof completionStatusSetActiveInputSchema>;

export const completionStatusDeleteInputSchema = schemas.deleteInputSchema;
export type CompletionStatusDeleteInput = z.infer<typeof completionStatusDeleteInputSchema>;
