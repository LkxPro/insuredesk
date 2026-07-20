import { channelCatalogSchemas } from "@insuredesk/shared";
import { channelCatalog } from "../services/channel.service";
import { createCatalogRouter } from "./dictionary-catalog.router";

export const channelRouter = createCatalogRouter(channelCatalog, channelCatalogSchemas);
