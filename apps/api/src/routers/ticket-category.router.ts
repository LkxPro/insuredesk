import {
  ticketCategoryCreateInputSchema,
  ticketCategoryDeleteInputSchema,
  ticketCategorySetActiveInputSchema,
  ticketCategoryUpdateInputSchema,
} from "@insuredesk/shared";
import { ticketCategoryCatalog } from "../services/ticket-category.service";
import { createCatalogRouter } from "./dictionary-catalog.router";

export const ticketCategoryRouter = createCatalogRouter(ticketCategoryCatalog, {
  createInputSchema: ticketCategoryCreateInputSchema,
  updateInputSchema: ticketCategoryUpdateInputSchema,
  setActiveInputSchema: ticketCategorySetActiveInputSchema,
  deleteInputSchema: ticketCategoryDeleteInputSchema,
});
