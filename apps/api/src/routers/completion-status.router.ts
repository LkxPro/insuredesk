import { completionStatusCatalogSchemas } from "@insuredesk/shared";
import { completionStatusCatalog } from "../services/completion-status.service";
import { createCatalogRouter } from "./dictionary-catalog.router";

export const completionStatusRouter = createCatalogRouter(
  completionStatusCatalog,
  completionStatusCatalogSchemas,
);
