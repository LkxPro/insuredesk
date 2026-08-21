import { feedbackReceiveChannelCatalogSchemas } from "@insuredesk/shared";
import { feedbackReceiveChannelCatalog } from "../services/feedback-receive-channel.service.ts";
import { createCatalogRouter } from "./dictionary-catalog.router.ts";

export const feedbackReceiveChannelRouter = createCatalogRouter(
  feedbackReceiveChannelCatalog,
  feedbackReceiveChannelCatalogSchemas,
);