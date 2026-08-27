import { createCatalogService } from "./dictionary-catalog.service.ts";

export const ticketCategoryCatalog = createCatalogService({
  delegate: (db) => db.ticketCategory,
  labels: { noun: "类别", nameNoun: "类别", refNoun: "客诉类别" },
  countReferences: (tx, id) => tx.ticketComplaintDetail.count({ where: { categoryId: id } }),
});
