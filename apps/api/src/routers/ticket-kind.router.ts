import { ticketKindCatalogSchemas } from "@insuredesk/shared";
import { ticketKindCatalog } from "../services/ticket-kind.service.ts";
import { createCatalogRouter } from "./dictionary-catalog.router.ts";

export const ticketKindRouter = createCatalogRouter(ticketKindCatalog, ticketKindCatalogSchemas);
