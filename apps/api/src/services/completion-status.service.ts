import { NO_REFUND_COMPLETION_STATUS_ID } from "@insuredesk/shared";
import { CatalogPinnedError, createCatalogService } from "./dictionary-catalog.service.ts";

export const completionStatusCatalog = createCatalogService({
  delegate: (db) => db.completionStatus,
  labels: { noun: "完结状态", nameNoun: "状态", refNoun: "完结状态" },
  countReferences: (tx, id) => tx.ticket.count({ where: { completionStatusId: id } }),
  assertNoPinnedRefs: async (_tx, id) => {
    if (id === NO_REFUND_COMPLETION_STATUS_ID) {
      throw new CatalogPinnedError("该完结状态用于弘樊未退费不回传规则，无法删除，可改为停用");
    }
  },
});
