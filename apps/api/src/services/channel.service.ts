import { createCatalogService } from "./dictionary-catalog.service";

/** 反馈渠道目录：lifecycle semantics in dictionary-catalog.service. */
export const channelCatalog = createCatalogService({
  delegate: (db) => db.channel,
  labels: { noun: "渠道", nameNoun: "渠道", refNoun: "反馈渠道" },
  countReferences: (tx, id) => tx.ticket.count({ where: { channelId: id } }),
});
