import type { CompletionStatusCreateInput, CompletionStatusUpdateInput } from "@insuredesk/shared";
import { type CompletionStatus, Prisma, type PrismaClient } from "../generated/prisma/client";

/**
 * 完结状态目录 domain logic (issue #86). Tickets hold references into this
 * catalog, so a referenced row can only be 停用 — deletion is refused with the
 * reference count; the FK's Restrict is the backstop behind that check.
 */

export class CompletionStatusNameConflictError extends Error {
  constructor() {
    super("状态名称已存在");
    this.name = "CompletionStatusNameConflictError";
  }
}

export class CompletionStatusNotFoundError extends Error {
  constructor() {
    super("完结状态不存在");
    this.name = "CompletionStatusNotFoundError";
  }
}

export class CompletionStatusInUseError extends Error {
  /** No count = the P2003 backstop caught a race; don't fabricate a number. */
  constructor(ticketCount?: number) {
    super(
      ticketCount === undefined
        ? "该完结状态已被工单使用，无法删除，可改为停用"
        : `该完结状态已被 ${ticketCount} 张工单使用，无法删除，可改为停用`,
    );
    this.name = "CompletionStatusInUseError";
  }
}

/** 完结引用指向不存在或已停用的目录项。 */
export class CompletionStatusUnavailableError extends Error {
  constructor(reason: "missing" | "disabled") {
    super(reason === "missing" ? "所选完结状态不存在" : "所选完结状态已停用");
    this.name = "CompletionStatusUnavailableError";
  }
}

/**
 * Resolve a NEWLY chosen completion-status reference: the row must exist and
 * be active. 完结工单 calls this — unlike channel/category there is no
 * keep-current-value edit path, so a disabled reference can only persist on
 * tickets resolved before the 停用.
 */
export async function resolveNewCompletionStatus(
  db: Pick<PrismaClient, "completionStatus">,
  completionStatusId: string,
) {
  const status = await db.completionStatus.findUnique({ where: { id: completionStatusId } });
  if (!status) {
    throw new CompletionStatusUnavailableError("missing");
  }
  if (!status.active) {
    throw new CompletionStatusUnavailableError("disabled");
  }
  return status;
}

function toDto(row: CompletionStatus) {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new CompletionStatusNameConflictError();
    if (error.code === "P2025") throw new CompletionStatusNotFoundError();
  }
  throw error;
}

const catalogOrderBy = [
  { displayOrder: "asc" },
  { name: "asc" },
] satisfies Prisma.CompletionStatusOrderByWithRelationInput[];

/** The full catalog for the management page — 停用 rows included. */
export async function listCompletionStatuses(prisma: PrismaClient) {
  const rows = await prisma.completionStatus.findMany({ orderBy: catalogOrderBy });
  return rows.map(toDto);
}

/** The 完结弹窗 dropdown feed: active statuses only, in display order. */
export async function listCompletionStatusOptions(prisma: PrismaClient) {
  const rows = await prisma.completionStatus.findMany({
    where: { active: true },
    orderBy: catalogOrderBy,
  });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * The 工单列表 filter feed: the WHOLE catalog — 停用 rows ride along with
 * their active flag (labelled 已停用 in the UI) so filtering by a disabled
 * status still reaches its 存量工单.
 */
export async function listCompletionStatusFilterOptions(prisma: PrismaClient) {
  const rows = await prisma.completionStatus.findMany({ orderBy: catalogOrderBy });
  return rows.map((row) => ({ id: row.id, name: row.name, active: row.active }));
}

export async function createCompletionStatus(
  prisma: PrismaClient,
  input: CompletionStatusCreateInput,
) {
  try {
    return toDto(await prisma.completionStatus.create({ data: input }));
  } catch (error) {
    translateWriteError(error);
  }
}

export async function updateCompletionStatus(
  prisma: PrismaClient,
  input: CompletionStatusUpdateInput,
) {
  try {
    return toDto(
      await prisma.completionStatus.update({
        where: { id: input.id },
        data: { name: input.name, displayOrder: input.displayOrder },
      }),
    );
  } catch (error) {
    translateWriteError(error);
  }
}

export async function setCompletionStatusActive(prisma: PrismaClient, id: string, active: boolean) {
  try {
    return toDto(await prisma.completionStatus.update({ where: { id }, data: { active } }));
  } catch (error) {
    translateWriteError(error);
  }
}

/**
 * Physical deletion, zero-reference rows only. Soft-deleted tickets keep
 * their reference, so they count too — deleting under them would strand the
 * rows the soft delete promised to preserve.
 */
export async function deleteCompletionStatus(prisma: PrismaClient, id: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const ticketCount = await tx.ticket.count({ where: { completionStatusId: id } });
      if (ticketCount > 0) {
        throw new CompletionStatusInUseError(ticketCount);
      }
      await tx.completionStatus.delete({ where: { id } });
      return { id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      // FK backstop: a ticket grabbed the reference between count and delete.
      throw new CompletionStatusInUseError();
    }
    translateWriteError(error);
  }
}
