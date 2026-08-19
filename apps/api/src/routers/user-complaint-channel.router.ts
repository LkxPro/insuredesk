import { userComplaintChannelCatalogSchemas } from "@insuredesk/shared";
import { userComplaintChannelCatalog } from "../services/user-complaint-channel.service.ts";
import { createCatalogRouter } from "./dictionary-catalog.router.ts";

export const userComplaintChannelRouter = createCatalogRouter(
  userComplaintChannelCatalog,
  userComplaintChannelCatalogSchemas,
);
