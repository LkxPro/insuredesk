import { channelCatalogSchemas } from "@insuredesk/shared";
import { channelCatalog } from "../services/channel.service.ts";
import { createCatalogRouter } from "./dictionary-catalog.router.ts";

export const channelRouter = createCatalogRouter(channelCatalog, channelCatalogSchemas);
