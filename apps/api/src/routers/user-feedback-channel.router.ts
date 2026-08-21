import { userFeedbackChannelCatalogSchemas } from "@insuredesk/shared";
import { userFeedbackChannelCatalog } from "../services/user-feedback-channel.service.ts";
import { createCatalogRouter } from "./dictionary-catalog.router.ts";

export const userFeedbackChannelRouter = createCatalogRouter(
  userFeedbackChannelCatalog,
  userFeedbackChannelCatalogSchemas,
);