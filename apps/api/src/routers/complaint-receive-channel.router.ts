import { complaintReceiveChannelCatalogSchemas } from "@insuredesk/shared";
import { complaintReceiveChannelCatalog } from "../services/complaint-receive-channel.service.ts";
import { createCatalogRouter } from "./dictionary-catalog.router.ts";

export const complaintReceiveChannelRouter = createCatalogRouter(
  complaintReceiveChannelCatalog,
  complaintReceiveChannelCatalogSchemas,
);
