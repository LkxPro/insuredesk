import { ticketCategoryCatalogSchemas } from "@insuredesk/shared";
import { ticketCategoryCatalog } from "../services/ticket-category.service";
import { createCatalogRouter } from "./dictionary-catalog.router";

export const ticketCategoryRouter = createCatalogRouter(
  ticketCategoryCatalog,
  ticketCategoryCatalogSchemas,
);
