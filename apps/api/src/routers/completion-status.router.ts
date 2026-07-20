import {
  completionStatusCreateInputSchema,
  completionStatusDeleteInputSchema,
  completionStatusSetActiveInputSchema,
  completionStatusUpdateInputSchema,
} from "@insuredesk/shared";
import { completionStatusCatalog } from "../services/completion-status.service";
import { createCatalogRouter } from "./dictionary-catalog.router";

export const completionStatusRouter = createCatalogRouter(completionStatusCatalog, {
  createInputSchema: completionStatusCreateInputSchema,
  updateInputSchema: completionStatusUpdateInputSchema,
  setActiveInputSchema: completionStatusSetActiveInputSchema,
  deleteInputSchema: completionStatusDeleteInputSchema,
});
