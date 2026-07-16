import type { TicketCategoryCreateInput, TicketCategoryUpdateInput } from "@insuredesk/shared";
import { Prisma, type PrismaClient, type TicketCategory } from "@prisma/client";

/**
 * 客诉类别目录 domain logic (issue #68). Tickets hold references into this
 * catalog, so a referenced row can only be 停用 — deletion is refused with the
 * reference count; the FK's Restrict is the backstop behind that check.
 */

export class TicketCategoryNameConflictError extends Error {
  constructor() {
    super("类别名称已存在");
    this.name = "TicketCategoryNameConflictError";
  }
}

export class TicketCategoryNotFoundError extends Error {
  constructor() {
    super("类别不存在");
    this.name = "TicketCategoryNotFoundError";
  }
}

export class TicketCategoryInUseError extends Error {
  /** No count = the P2003 backstop caught a race; don't fabricate a number. */
  constructor(ticketCount?: number) {
    super(
      ticketCount === undefined
        ? "该类别已被工单使用，无法删除，可改为停用"
        : `该类别已被 ${ticketCount} 张工单使用，无法删除，可改为停用`,
    );
    this.name = "TicketCategoryInUseError";
  }
}

/** 类别引用指向不存在或已停用的目录项（编辑保持原停用值除外）。 */
export class TicketCategoryUnavailableError extends Error {
  constructor(reason: "missing" | "disabled") {
    super(reason === "missing" ? "所选客诉类别不存在" : "所选客诉类别已停用");
    this.name = "TicketCategoryUnavailableError";
  }
}

/**
 * Resolve a NEWLY chosen category reference: the row must exist and be
 * active. Ticket create/edit call this; an edit keeping the ticket's current
 * value skips it — that is the one case a disabled reference may persist.
 */
export async function resolveNewCategory(
  db: Pick<PrismaClient, "ticketCategory">,
  categoryId: string | null,
) {
  if (categoryId === null) {
    return null;
  }
  const category = await db.ticketCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    throw new TicketCategoryUnavailableError("missing");
  }
  if (!category.active) {
    throw new TicketCategoryUnavailableError("disabled");
  }
  return category;
}

function toDto(row: TicketCategory) {
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
    if (error.code === "P2002") throw new TicketCategoryNameConflictError();
    if (error.code === "P2025") throw new TicketCategoryNotFoundError();
  }
  throw error;
}

const catalogOrderBy = [
  { displayOrder: "asc" },
  { name: "asc" },
] satisfies Prisma.TicketCategoryOrderByWithRelationInput[];

/** The full catalog for the management page — 停用 rows included. */
export async function listTicketCategories(prisma: PrismaClient) {
  const rows = await prisma.ticketCategory.findMany({ orderBy: catalogOrderBy });
  return rows.map(toDto);
}

/** The 建单/编辑 dropdown feed: active categories only, in display order. */
export async function listTicketCategoryOptions(prisma: PrismaClient) {
  const rows = await prisma.ticketCategory.findMany({
    where: { active: true },
    orderBy: catalogOrderBy,
  });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function createTicketCategory(prisma: PrismaClient, input: TicketCategoryCreateInput) {
  try {
    return toDto(await prisma.ticketCategory.create({ data: input }));
  } catch (error) {
    translateWriteError(error);
  }
}

export async function updateTicketCategory(prisma: PrismaClient, input: TicketCategoryUpdateInput) {
  try {
    return toDto(
      await prisma.ticketCategory.update({
        where: { id: input.id },
        data: { name: input.name, displayOrder: input.displayOrder },
      }),
    );
  } catch (error) {
    translateWriteError(error);
  }
}

export async function setTicketCategoryActive(prisma: PrismaClient, id: string, active: boolean) {
  try {
    return toDto(await prisma.ticketCategory.update({ where: { id }, data: { active } }));
  } catch (error) {
    translateWriteError(error);
  }
}

/**
 * Physical deletion, zero-reference rows only. Soft-deleted tickets keep
 * their reference, so they count too — deleting under them would strand the
 * rows the soft delete promised to preserve.
 */
export async function deleteTicketCategory(prisma: PrismaClient, id: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const ticketCount = await tx.ticket.count({ where: { categoryId: id } });
      if (ticketCount > 0) {
        throw new TicketCategoryInUseError(ticketCount);
      }
      await tx.ticketCategory.delete({ where: { id } });
      return { id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      // FK backstop: a ticket grabbed the reference between count and delete.
      throw new TicketCategoryInUseError();
    }
    translateWriteError(error);
  }
}
