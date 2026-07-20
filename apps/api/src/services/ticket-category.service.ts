import { createCatalogService } from "./dictionary-catalog.service";

/** 客诉类别目录：lifecycle semantics in dictionary-catalog.service. */
export const ticketCategoryCatalog = createCatalogService({
  delegate: (db) => db.ticketCategory,
  labels: { noun: "类别", nameNoun: "类别", refNoun: "客诉类别" },
  countReferences: (tx, id) => tx.ticket.count({ where: { categoryId: id } }),
});
