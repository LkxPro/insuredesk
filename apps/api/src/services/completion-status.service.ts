import { createCatalogService } from "./dictionary-catalog.service.ts";

export const completionStatusCatalog = createCatalogService({
  delegate: (db) => db.completionStatus,
  labels: { noun: "完结状态", nameNoun: "状态", refNoun: "完结状态" },
  countReferences: (tx, id) => tx.ticket.count({ where: { completionStatusId: id } }),
});
