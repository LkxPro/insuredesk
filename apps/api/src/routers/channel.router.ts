import {
  channelCreateInputSchema,
  channelDeleteInputSchema,
  channelSetActiveInputSchema,
  channelUpdateInputSchema,
} from "@insuredesk/shared";
import { channelCatalog } from "../services/channel.service";
import { createCatalogRouter } from "./dictionary-catalog.router";

export const channelRouter = createCatalogRouter(channelCatalog, {
  createInputSchema: channelCreateInputSchema,
  updateInputSchema: channelUpdateInputSchema,
  setActiveInputSchema: channelSetActiveInputSchema,
  deleteInputSchema: channelDeleteInputSchema,
});
