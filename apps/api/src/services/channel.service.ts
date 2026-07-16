import type { ChannelCreateInput, ChannelUpdateInput } from "@insuredesk/shared";
import { type Channel, Prisma, type PrismaClient } from "../generated/prisma/client";

/**
 * 反馈渠道目录 domain logic (issue #69). Tickets hold references into this
 * catalog, so a referenced row can only be 停用 — deletion is refused with the
 * reference count; the FK's Restrict is the backstop behind that check.
 */

export class ChannelNameConflictError extends Error {
  constructor() {
    super("渠道名称已存在");
    this.name = "ChannelNameConflictError";
  }
}

export class ChannelNotFoundError extends Error {
  constructor() {
    super("渠道不存在");
    this.name = "ChannelNotFoundError";
  }
}

export class ChannelInUseError extends Error {
  /** No count = the P2003 backstop caught a race; don't fabricate a number. */
  constructor(ticketCount?: number) {
    super(
      ticketCount === undefined
        ? "该渠道已被工单使用，无法删除，可改为停用"
        : `该渠道已被 ${ticketCount} 张工单使用，无法删除，可改为停用`,
    );
    this.name = "ChannelInUseError";
  }
}

/** 渠道引用指向不存在或已停用的目录项（编辑保持原停用值除外）。 */
export class ChannelUnavailableError extends Error {
  constructor(reason: "missing" | "disabled") {
    super(reason === "missing" ? "所选反馈渠道不存在" : "所选反馈渠道已停用");
    this.name = "ChannelUnavailableError";
  }
}

/**
 * Resolve a NEWLY chosen channel reference: the row must exist and be
 * active. Ticket create/edit call this; an edit keeping the ticket's current
 * value skips it — that is the one case a disabled reference may persist.
 */
export async function resolveNewChannel(
  db: Pick<PrismaClient, "channel">,
  channelId: string | null,
) {
  if (channelId === null) {
    return null;
  }
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    throw new ChannelUnavailableError("missing");
  }
  if (!channel.active) {
    throw new ChannelUnavailableError("disabled");
  }
  return channel;
}

function toDto(row: Channel) {
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
    if (error.code === "P2002") throw new ChannelNameConflictError();
    if (error.code === "P2025") throw new ChannelNotFoundError();
  }
  throw error;
}

const catalogOrderBy = [
  { displayOrder: "asc" },
  { name: "asc" },
] satisfies Prisma.ChannelOrderByWithRelationInput[];

/** The full catalog for the management page — 停用 rows included. */
export async function listChannels(prisma: PrismaClient) {
  const rows = await prisma.channel.findMany({ orderBy: catalogOrderBy });
  return rows.map(toDto);
}

/** The 建单/编辑 dropdown feed: active channels only, in display order. */
export async function listChannelOptions(prisma: PrismaClient) {
  const rows = await prisma.channel.findMany({
    where: { active: true },
    orderBy: catalogOrderBy,
  });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * The 工单列表 filter feed: the WHOLE catalog — 停用 rows ride along with
 * their active flag (labelled 已停用 in the UI) so filtering by a disabled
 * channel still reaches its 存量工单.
 */
export async function listChannelFilterOptions(prisma: PrismaClient) {
  const rows = await prisma.channel.findMany({ orderBy: catalogOrderBy });
  return rows.map((row) => ({ id: row.id, name: row.name, active: row.active }));
}

export async function createChannel(prisma: PrismaClient, input: ChannelCreateInput) {
  try {
    return toDto(await prisma.channel.create({ data: input }));
  } catch (error) {
    translateWriteError(error);
  }
}

export async function updateChannel(prisma: PrismaClient, input: ChannelUpdateInput) {
  try {
    return toDto(
      await prisma.channel.update({
        where: { id: input.id },
        data: { name: input.name, displayOrder: input.displayOrder },
      }),
    );
  } catch (error) {
    translateWriteError(error);
  }
}

export async function setChannelActive(prisma: PrismaClient, id: string, active: boolean) {
  try {
    return toDto(await prisma.channel.update({ where: { id }, data: { active } }));
  } catch (error) {
    translateWriteError(error);
  }
}

/**
 * Physical deletion, zero-reference rows only. Soft-deleted tickets keep
 * their reference, so they count too — deleting under them would strand the
 * rows the soft delete promised to preserve.
 */
export async function deleteChannel(prisma: PrismaClient, id: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const ticketCount = await tx.ticket.count({ where: { channelId: id } });
      if (ticketCount > 0) {
        throw new ChannelInUseError(ticketCount);
      }
      await tx.channel.delete({ where: { id } });
      return { id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      // FK backstop: a ticket grabbed the reference between count and delete.
      throw new ChannelInUseError();
    }
    translateWriteError(error);
  }
}
