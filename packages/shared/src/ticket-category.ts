import type { z } from "zod";
import { createCatalogSchemas } from "./dictionary-catalog.ts";

export const ticketCategoryCatalogSchemas = createCatalogSchemas("类别");

export const ticketCategoryCreateInputSchema = ticketCategoryCatalogSchemas.createInputSchema;
export type TicketCategoryCreateInput = z.infer<typeof ticketCategoryCreateInputSchema>;

export const ticketCategoryUpdateInputSchema = ticketCategoryCatalogSchemas.updateInputSchema;
export type TicketCategoryUpdateInput = z.infer<typeof ticketCategoryUpdateInputSchema>;

export const ticketCategorySetActiveInputSchema = ticketCategoryCatalogSchemas.setActiveInputSchema;
export type TicketCategorySetActiveInput = z.infer<typeof ticketCategorySetActiveInputSchema>;

export const ticketCategoryDeleteInputSchema = ticketCategoryCatalogSchemas.deleteInputSchema;
export type TicketCategoryDeleteInput = z.infer<typeof ticketCategoryDeleteInputSchema>;
