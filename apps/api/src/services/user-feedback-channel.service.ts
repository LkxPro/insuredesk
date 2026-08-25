import { CatalogPinnedError, createCatalogService } from "./dictionary-catalog.service.ts";

export const userFeedbackChannelCatalog = createCatalogService({
  delegate: (db) => db.userFeedbackChannel,
  labels: { noun: "用户反馈渠道", nameNoun: "渠道", refNoun: "用户反馈渠道" },
  countReferences: (tx, id) => tx.ticket.count({ where: { userFeedbackChannelId: id } }),
  // 外部账号预填也算引用：被任何账号（含已禁用）预填引用的目录项只能停用，
  // 报错带引用账号名让管理员知道去哪里解绑
  assertNoPinnedRefs: async (tx, id) => {
    const accounts = await tx.user.findMany({
      where: { prefillUserFeedbackChannelId: id },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    if (accounts.length > 0) {
      const names = accounts.map((account) => `「${account.name}」`).join("");
      throw new CatalogPinnedError(
        `该用户反馈渠道被外部账号 ${names} 的预填引用，无法删除，可改为停用`,
      );
    }
  },
});
