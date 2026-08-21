import { CatalogPinnedError, createCatalogService } from "./dictionary-catalog.service.ts";

export const complaintReceiveChannelCatalog = createCatalogService({
  delegate: (db) => db.complaintReceiveChannel,
  labels: { noun: "投诉信息接收渠道", nameNoun: "渠道", refNoun: "投诉信息接收渠道" },
  countReferences: (tx, id) => tx.ticket.count({ where: { complaintReceiveChannelId: id } }),
  // 外部账号预填也算引用：被任何账号（含已禁用）预填引用的目录项只能停用，
  // 报错带引用账号名让管理员知道去哪里解绑
  assertNoPinnedRefs: async (tx, id) => {
    const accounts = await tx.user.findMany({
      where: { prefillComplaintReceiveChannelId: id },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    if (accounts.length > 0) {
      const names = accounts.map((account) => `「${account.name}」`).join("");
      throw new CatalogPinnedError(
        `该投诉信息接收渠道被外部账号 ${names} 的预填引用，无法删除，可改为停用`,
      );
    }
  },
});
