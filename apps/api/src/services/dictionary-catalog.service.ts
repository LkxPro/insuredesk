import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";

/**
 * 字典目录 domain logic, shared by the 渠道/类别/完结状态 catalogs. Tickets
 * hold references into a catalog, so a referenced row (soft-deleted tickets
 * included) can only be 停用 — deletion is refused with the reference count;
 * the FK's Restrict is the backstop behind that check. Each catalog is a
 * `createCatalogService` call: a delegate, its message nouns, and a reference
 * counter — no behavior switches.
 */

export interface CatalogLabels {
  /** 目录名词：「X不存在」「该X已被…」 */
  noun: string;
  /** 名称字段名词：「X名称已存在」 */
  nameNoun: string;
  /** 引用全称：「所选X不存在/已停用」 */
  refNoun: string;
}

export class CatalogNameConflictError extends Error {
  constructor({ nameNoun }: CatalogLabels) {
    super(`${nameNoun}名称已存在`);
    this.name = "CatalogNameConflictError";
  }
}

export class CatalogNotFoundError extends Error {
  constructor({ noun }: CatalogLabels) {
    super(`${noun}不存在`);
    this.name = "CatalogNotFoundError";
  }
}

export class CatalogInUseError extends Error {
  /** No count = the P2003 backstop caught a race; don't fabricate a number. */
  constructor({ noun }: CatalogLabels, ticketCount?: number) {
    super(
      ticketCount === undefined
        ? `该${noun}已被工单使用，无法删除，可改为停用`
        : `该${noun}已被 ${ticketCount} 张工单使用，无法删除，可改为停用`,
    );
    this.name = "CatalogInUseError";
  }
}

/** 工单以外的引用也钉住目录行（如渠道被外部账号预填引用）— 同样的拒绝，自带文案。 */
export class CatalogPinnedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogPinnedError";
  }
}

export class CatalogOrderMismatchError extends Error {
  constructor({ noun }: CatalogLabels) {
    super(`${noun}列表已变化，请刷新后重试`);
    this.name = "CatalogOrderMismatchError";
  }
}

/** 目录引用指向不存在或已停用的目录项（编辑保持原停用值除外）。 */
export class CatalogUnavailableError extends Error {
  constructor({ refNoun }: CatalogLabels, reason: "missing" | "disabled") {
    super(reason === "missing" ? `所选${refNoun}不存在` : `所选${refNoun}已停用`);
    this.name = "CatalogUnavailableError";
  }
}

export interface CatalogRow {
  id: string;
  name: string;
  active: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Catalog rows keyed by NAME — 停用 kept so missing/disabled stay distinguishable. */
export type CatalogNameIndex = ReadonlyMap<string, { id: string; active: boolean }>;

/** 名字判定的三分支：存在且启用 / 查无此名 / 存在但停用。 */
export type CatalogNameRef =
  | { status: "ok"; id: string }
  | { status: "missing" }
  | { status: "disabled" };

export function buildCatalogNameIndex(
  rows: ReadonlyArray<{ id: string; name: string; active: boolean }>,
): CatalogNameIndex {
  return new Map(rows.map((row) => [row.name, { id: row.id, active: row.active }]));
}

/**
 * Resolve a reference by NAME (files carry names, not ids): same 存在且启用
 * constraint as resolveNewRef, but returns the verdict instead of throwing —
 * callers that accumulate their own per-row errors keep their wording.
 */
export function resolveCatalogNameRef(index: CatalogNameIndex, name: string): CatalogNameRef {
  const entry = index.get(name);
  if (!entry) {
    return { status: "missing" };
  }
  if (!entry.active) {
    return { status: "disabled" };
  }
  return { status: "ok", id: entry.id };
}

type CatalogDb = PrismaClient | Prisma.TransactionClient;

type CatalogOrderBy = { displayOrder?: "asc"; name?: "asc" }[];

/** The structural slice of a Prisma model delegate the catalog needs. */
interface CatalogDelegate {
  findMany(args: { where?: { active: boolean }; orderBy: CatalogOrderBy }): Promise<CatalogRow[]>;
  findUnique(args: { where: { id: string } }): Promise<CatalogRow | null>;
  create(args: { data: { name: string; displayOrder: number } }): Promise<CatalogRow>;
  update(args: {
    where: { id: string };
    data: { name?: string; displayOrder?: number; active?: boolean };
  }): Promise<CatalogRow>;
  delete(args: { where: { id: string } }): Promise<CatalogRow>;
  aggregate(args: {
    _max: { displayOrder: true };
  }): Promise<{ _max: { displayOrder: number | null } }>;
}

export interface CatalogServiceConfig {
  /** The catalog's model delegate off whichever client runs the call. */
  delegate: (db: CatalogDb) => CatalogDelegate;
  labels: CatalogLabels;
  /** Ticket references guarding deletion — soft-deleted tickets count too. */
  countReferences: (tx: Prisma.TransactionClient, id: string) => Promise<number>;
  /**
   * Non-ticket references guarding deletion (e.g. 外部账号预填), checked inside
   * the same transaction — throws CatalogPinnedError to refuse.
   */
  assertNoPinnedRefs?: (tx: Prisma.TransactionClient, id: string) => Promise<void>;
}

export interface CatalogDto {
  id: string;
  name: string;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogWriteInput {
  name: string;
  displayOrder?: number;
}

export interface CatalogService {
  list(db: CatalogDb): Promise<CatalogDto[]>;
  listOptions(db: CatalogDb): Promise<{ id: string; name: string }[]>;
  listFilterOptions(db: CatalogDb): Promise<{ id: string; name: string; active: boolean }[]>;
  create(db: CatalogDb, input: CatalogWriteInput): Promise<CatalogDto>;
  update(db: CatalogDb, input: CatalogWriteInput & { id: string }): Promise<CatalogDto>;
  setActive(db: CatalogDb, id: string, active: boolean): Promise<CatalogDto>;
  reorder(db: PrismaClient, ids: string[]): Promise<{ ids: string[] }>;
  delete(db: PrismaClient, id: string): Promise<{ id: string }>;
  resolveNewRef(db: CatalogDb, id: string): Promise<CatalogRow>;
  resolveNewRef(db: CatalogDb, id: string | null): Promise<CatalogRow | null>;
}

const catalogOrderBy: CatalogOrderBy = [{ displayOrder: "asc" }, { name: "asc" }];

function toDto(row: CatalogRow): CatalogDto {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createCatalogService({
  delegate,
  labels,
  countReferences,
  assertNoPinnedRefs,
}: CatalogServiceConfig): CatalogService {
  function translateWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new CatalogNameConflictError(labels);
      if (error.code === "P2025") throw new CatalogNotFoundError(labels);
    }
    throw error;
  }

  /**
   * Resolve a NEWLY chosen catalog reference: the row must exist and be
   * active. Ticket create/edit call this with a nullable id (null = 未填写);
   * an edit keeping the ticket's current value skips it — that is the one
   * case a disabled reference may persist. 完结 passes a non-null id.
   */
  function resolveNewRef(db: CatalogDb, id: string): Promise<CatalogRow>;
  function resolveNewRef(db: CatalogDb, id: string | null): Promise<CatalogRow | null>;
  async function resolveNewRef(db: CatalogDb, id: string | null) {
    if (id === null) {
      return null;
    }
    const row = await delegate(db).findUnique({ where: { id } });
    if (!row) {
      throw new CatalogUnavailableError(labels, "missing");
    }
    if (!row.active) {
      throw new CatalogUnavailableError(labels, "disabled");
    }
    return row;
  }

  return {
    /** The full catalog for the management page — 停用 rows included. */
    async list(db) {
      const rows = await delegate(db).findMany({ orderBy: catalogOrderBy });
      return rows.map(toDto);
    },

    /** The 建单/编辑/完结弹窗 dropdown feed: active rows only, in display order. */
    async listOptions(db) {
      const rows = await delegate(db).findMany({
        where: { active: true },
        orderBy: catalogOrderBy,
      });
      return rows.map((row) => ({ id: row.id, name: row.name }));
    },

    /**
     * The 工单列表 filter feed: the WHOLE catalog — 停用 rows ride along with
     * their active flag (labelled 已停用 in the UI) so filtering by a disabled
     * row still reaches its 存量工单.
     */
    async listFilterOptions(db) {
      const rows = await delegate(db).findMany({ orderBy: catalogOrderBy });
      return rows.map((row) => ({ id: row.id, name: row.name, active: row.active }));
    },

    async create(db, input) {
      try {
        const displayOrder =
          input.displayOrder ??
          ((await delegate(db).aggregate({ _max: { displayOrder: true } }))._max.displayOrder ??
            0) + 1;
        return toDto(await delegate(db).create({ data: { name: input.name, displayOrder } }));
      } catch (error) {
        translateWriteError(error);
      }
    },

    async update(db, input) {
      try {
        return toDto(
          await delegate(db).update({
            where: { id: input.id },
            data: {
              name: input.name,
              ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder }),
            },
          }),
        );
      } catch (error) {
        translateWriteError(error);
      }
    },

    async setActive(db, id, active) {
      try {
        return toDto(await delegate(db).update({ where: { id }, data: { active } }));
      } catch (error) {
        translateWriteError(error);
      }
    },

    async reorder(prisma, ids) {
      return await prisma.$transaction(async (tx) => {
        const rows = await delegate(tx).findMany({ orderBy: catalogOrderBy });
        const current = new Set(rows.map((row) => row.id));
        if (ids.length !== rows.length || ids.some((id) => !current.has(id))) {
          throw new CatalogOrderMismatchError(labels);
        }
        for (const [index, id] of ids.entries()) {
          await delegate(tx).update({ where: { id }, data: { displayOrder: index + 1 } });
        }
        return { ids };
      });
    },

    /**
     * Physical deletion, zero-reference rows only. Soft-deleted tickets keep
     * their reference, so they count too — deleting under them would strand
     * the rows the soft delete promised to preserve.
     */
    async delete(prisma, id) {
      try {
        return await prisma.$transaction(async (tx) => {
          await assertNoPinnedRefs?.(tx, id);
          const ticketCount = await countReferences(tx, id);
          if (ticketCount > 0) {
            throw new CatalogInUseError(labels, ticketCount);
          }
          await delegate(tx).delete({ where: { id } });
          return { id };
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
          // FK backstop: a ticket grabbed the reference between count and delete.
          throw new CatalogInUseError(labels);
        }
        translateWriteError(error);
      }
    },

    resolveNewRef,
  };
}
