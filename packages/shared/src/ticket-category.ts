import type { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog";

/**
 * 客诉类别目录 contracts. Tickets reference catalog rows by id, so a rename
 * propagates everywhere at read time; only the ProcessLog remark keeps the
 * literal name snapshot of the moment.
 */

const schemas = createCatalogSchemas("类别");

export const ticketCategoryCreateInputSchema = schemas.createInputSchema;
export type TicketCategoryCreateInput = z.infer<typeof ticketCategoryCreateInputSchema>;

export const ticketCategoryUpdateInputSchema = schemas.updateInputSchema;
export type TicketCategoryUpdateInput = z.infer<typeof ticketCategoryUpdateInputSchema>;

export const ticketCategorySetActiveInputSchema = schemas.setActiveInputSchema;
export type TicketCategorySetActiveInput = z.infer<typeof ticketCategorySetActiveInputSchema>;

export const ticketCategoryDeleteInputSchema = schemas.deleteInputSchema;
export type TicketCategoryDeleteInput = z.infer<typeof ticketCategoryDeleteInputSchema>;
