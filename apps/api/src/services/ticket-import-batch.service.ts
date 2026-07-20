import type {
  TicketImportBatchListQuery,
  TicketImportBatchStatus,
  TicketImportRevokeInput,
} from "@insuredesk/shared";
import type { Prisma } from "../generated/prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * 导入历史 + 整批撤销 domain logic. A batch is the undo unit: revocation is
 * an all-or-nothing soft delete of every ticket it created — allowed only
 * while the batch is "clean" (no log later than the batch's import instant,
 * none individually deleted). The clean check IS the revocation window;
 * there is no time limit and no restore this phase.
 */

/** Batch invisible to the actor (scope) or plain missing. */
export class ImportBatchNotFoundError extends Error {
  constructor() {
    super("导入批次不存在或无权查看");
    this.name = "ImportBatchNotFoundError";
  }
}

/** 已撤销批次是终态，不可再次撤销。 */
export class ImportBatchAlreadyRevokedError extends Error {
  constructor() {
    super("该批次已撤销，不可再次撤销");
    this.name = "ImportBatchAlreadyRevokedError";
  }
}

/** Batch has processed tickets; carries the count the UI reports. */
export class ImportBatchLockedError extends Error {
  constructor(readonly processedCount: number) {
    super(`批内 ${processedCount} 单已有处理，整批撤销已拒绝`);
    this.name = "ImportBatchLockedError";
  }
}

/**
 * 批次可见范围与工单数据范围同一口径：无 ticket.view_all 只见自己导入的
 * 批次。撤销沿用同一范围，范围外的批次一律 not-found，不泄露存在性。
 */
function importBatchScope(viewer: AuthenticatedUser): Prisma.TicketImportBatchWhereInput {
  return viewer.permissions.includes("ticket.view_all") ? {} : { importerId: viewer.id };
}

/**
 * 「已有处理」= 存在晚于批次导入瞬间的处理记录，或已被单独软删除。与导入同
 * 瞬间的日志属于导入本身（导入即完结时同瞬间写 resolve），不论 action 都不
 * 锁批。
 */
function processedTicketWhere(importedAt: Date) {
  return {
    OR: [{ deletedAt: { not: null } }, { processLogs: { some: { at: { gt: importedAt } } } }],
  } satisfies Prisma.TicketWhereInput;
}

/**
 * 导入历史 list, newest first. Status is derived per read — a batch shows
 * revoked (终态), locked (any ticket processed or individually deleted), or
 * revocable. Importer/revoker names render current via JOIN.
 */
export async function listImportBatches(
  { prisma }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  query: TicketImportBatchListQuery,
) {
  const where = importBatchScope(viewer);
  const [batches, total] = await prisma.$transaction([
    prisma.ticketImportBatch.findMany({
      where,
      include: {
        importer: { select: { name: true } },
        revokedBy: { select: { name: true } },
      },
      // id breaks ordering ties so pagination never skips or repeats a row
      orderBy: [{ importedAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.ticketImportBatch.count({ where }),
  ]);

  // One grouped query answers "which of this page's live batches are locked";
  // each branch carries its own batch's import instant as the cutoff
  const liveBatches = batches.filter((batch) => batch.revokedAt === null);
  const lockedGroups =
    liveBatches.length === 0
      ? []
      : await prisma.ticket.groupBy({
          by: ["importBatchId"],
          where: {
            OR: liveBatches.map((batch) => ({
              importBatchId: batch.id,
              ...processedTicketWhere(batch.importedAt),
            })),
          },
        });
  const lockedIds = new Set(lockedGroups.map((group) => group.importBatchId));

  return {
    items: batches.map((batch) => {
      const status: TicketImportBatchStatus =
        batch.revokedAt !== null ? "revoked" : lockedIds.has(batch.id) ? "locked" : "revocable";
      return {
        id: batch.id,
        importedAt: batch.importedAt.toISOString(),
        importerName: batch.importer.name,
        rowCount: batch.rowCount,
        filename: batch.filename,
        status,
        revokedAt: batch.revokedAt?.toISOString() ?? null,
        revokedByName: batch.revokedBy?.name ?? null,
      };
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * 整批撤销: all-or-nothing soft delete of one clean batch. Statement order
 * inside the transaction is the concurrency guarantee:
 *
 * 1. Conditionally claim the batch (revokedAt null → stamped) — the write
 *    lock on the batch row makes concurrent revokes lose with count 0.
 * 2. Soft-delete every live ticket in ONE updateMany — atomic, so a half
 *    -revoked batch cannot exist — which also row-locks the whole batch.
 *    Every lifecycle action (assign/comment/edit/resolve/delete) updates the
 *    ticket row, so an in-flight action either committed before this
 *    statement (its log then fails the check below and the whole revoke
 *    rolls back) or blocks until this transaction ends.
 * 3. Clean check AFTER the locks: any ticket with a log later than the
 *    batch's import instant, or individually deleted before this revoke
 *    (deletedAt ≠ this revoke's stamp), rejects the batch with the processed
 *    count.
 *
 * 与既有删除口径一致: no ProcessLog is written — the logs and materials stay
 * behind the tombstones; deletedAt alone removes the tickets from every
 * default list, board, export, and statistic.
 */
export async function revokeImportBatch(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: TicketImportRevokeInput,
) {
  const now = clock.now();
  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.ticketImportBatch.findFirst({
        where: { id: input.batchId, ...importBatchScope(actor) },
        select: { id: true, revokedAt: true, importedAt: true },
      });
      if (!batch) {
        throw new ImportBatchNotFoundError();
      }
      if (batch.revokedAt !== null) {
        throw new ImportBatchAlreadyRevokedError();
      }

      const claimed = await tx.ticketImportBatch.updateMany({
        where: { id: batch.id, revokedAt: null },
        data: { revokedAt: now, revokedById: actor.id },
      });
      if (claimed.count === 0) {
        throw new ImportBatchAlreadyRevokedError();
      }

      const revoked = await tx.ticket.updateMany({
        where: { importBatchId: batch.id, deletedAt: null },
        data: { deletedAt: now },
      });

      const processedCount = await tx.ticket.count({
        where: {
          importBatchId: batch.id,
          OR: [
            // deletedAt ≠ 本次盖章 ⇒ 在本次撤销前已被单独删除
            { deletedAt: { not: now } },
            { processLogs: { some: { at: { gt: batch.importedAt } } } },
          ],
        },
      });
      if (processedCount > 0) {
        throw new ImportBatchLockedError(processedCount);
      }

      return { revoked: revoked.count };
    },
    // Lock waits against in-flight lifecycle actions count into the timeout
    { timeout: 30_000 },
  );
}
