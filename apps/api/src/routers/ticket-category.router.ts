import { ticketCategoryCatalogSchemas } from "@insuredesk/shared";
import { ticketCategoryCatalog } from "../services/ticket-category.service.ts";
import { createCatalogRouter } from "./dictionary-catalog.router.ts";

export const ticketCategoryRouter = createCatalogRouter(
  ticketCategoryCatalog,
  ticketCategoryCatalogSchemas,
);
