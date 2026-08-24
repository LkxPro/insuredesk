import { randomUUID } from "node:crypto";
import { TICKET_KIND_KEYS, type TicketKindKey } from "@insuredesk/shared";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { CatalogPinnedError, createCatalogService } from "./dictionary-catalog.service.ts";

export class TicketKindNotConfiguredError extends Error {
  constructor(key: string) {
    super(`工单种类「${key}」不存在（数据库未迁移或未 bootstrap）`);
    this.name = "TicketKindNotConfiguredError";
  }
}

/** 种类行由迁移/bootstrap 兜底，查无此行 = 环境故障。 */
export async function requireTicketKindId(
  db: Pick<PrismaClient, "ticketKind"> | Prisma.TransactionClient,
  key: TicketKindKey,
): Promise<string> {
  const kind = await db.ticketKind.findUnique({ where: { key } });
  if (!kind) {
    throw new TicketKindNotConfiguredError(key);
  }
  return kind.id;
}

export const ticketKindCatalog = createCatalogService({
  delegate: (db) => ({
    findMany: (args) => db.ticketKind.findMany(args),
    findUnique: (args) => db.ticketKind.findUnique(args),
    // 管理员新增的是无行为绑定的同形状行，key 只需唯一且此后不可改
    create: (args) => db.ticketKind.create({ data: { ...args.data, key: randomUUID() } }),
    update: (args) => db.ticketKind.update(args),
    delete: (args) => db.ticketKind.delete(args),
    aggregate: (args) => db.ticketKind.aggregate(args),
  }),
  labels: { noun: "种类", nameNoun: "种类", refNoun: "工单种类" },
  countReferences: (tx, id) => tx.ticket.count({ where: { kindId: id } }),
  // 行为绑定行（key 是代码契约）只启停、不物理删除，与是否被工单引用无关
  assertNoPinnedRefs: async (tx, id) => {
    const row = await tx.ticketKind.findUnique({ where: { id } });
    if (row && (TICKET_KIND_KEYS as readonly string[]).includes(row.key)) {
      throw new CatalogPinnedError(`「${row.name}」种类绑定系统行为，不可删除，可改为停用`);
    }
  },
});
