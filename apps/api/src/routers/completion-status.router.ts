import { completionStatusCatalogSchemas } from "@insuredesk/shared";
import { completionStatusCatalog } from "../services/completion-status.service.ts";
import { createCatalogRouter } from "./dictionary-catalog.router.ts";

export const completionStatusRouter = createCatalogRouter(
  completionStatusCatalog,
  completionStatusCatalogSchemas,
);
