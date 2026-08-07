import type {
  ExternalAccountCreateData,
  ExternalAccountListItem,
  ExternalAccountSetActiveInput,
  ExternalAccountUpdateData,
} from "@insuredesk/shared";
import {
  ACCOUNT_AUTHORIZABLE_SENSITIVE_TICKET_FIELDS,
  DEFAULT_EXTERNAL_DETAIL_FIELDS,
  DEFAULT_EXTERNAL_LIST_FIELDS,
  EXTERNAL_RESTRICTED_TICKET_FIELDS,
  EXTERNAL_ROLE_PERMISSIONS,
  EXTERNAL_VISIBLE_FIELD_OPTIONS,
  isExternalRole,
  parseVisibleTicketFields,
  resolveExternalFieldOrder,
} from "@insuredesk/shared";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import { hashPassword } from "./auth.service";
import {
  DuplicateEmailError,
  DuplicateUsernameError,
  SelfDisableError,
  UserNotFoundError,
} from "./user.service";

/**
 * 外部账号管理 domain logic (external_account.manage 单点执法)。外部账号 =
 * users 表普通行 + 唯一外部角色 + 6 预填 + 白名单；内外部之分由角色库存权限
 * 数组判定（isExternalRole），不设独立标记列。
 */

export interface ExternalAccountServiceDeps {
  prisma: PrismaClient;
}

/** The target of an external-account operation is not an 外部账号. */
export class ExternalAccountOnlyError extends Error {
  constructor() {
    super("该用户不是外部账号");
    this.name = "ExternalAccountOnlyError";
  }
}

/**
 * 建号要挂的唯一外部角色不存在或不唯一。种子提供恰好一个外部角色,数量对不上
 * 说明库被改坏了 — 明确失败,不猜一个顶上：挂错角色等于给外部账号发错权限。
 */
export class ExternalRoleNotUniqueError extends Error {
  constructor(count: number) {
    super(`外部角色应恰好有 1 个，当前 ${count} 个，无法创建外部账号`);
    this.name = "ExternalRoleNotUniqueError";
  }
}

export class InvalidVisibleFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVisibleFieldError";
  }
}

/** 预填引用的渠道 id 不存在（停用渠道保持引用合法，只校存在性）。 */
export class PrefillChannelNotFoundError extends Error {
  constructor() {
    super("所选反馈渠道不存在");
    this.name = "PrefillChannelNotFoundError";
  }
}

function validateVisibleFields(fields: string[] | undefined | null): void {
  if (!fields || fields.length === 0) {
    return;
  }

  const allowedSet = new Set(EXTERNAL_VISIBLE_FIELD_OPTIONS);
  const restrictedSet = new Set(EXTERNAL_RESTRICTED_TICKET_FIELDS);

  for (const field of fields) {
    if (restrictedSet.has(field)) {
      throw new InvalidVisibleFieldError(`字段 ${field} 为内部字段，不允许外部可见`);
    }
    if (!allowedSet.has(field)) {
      throw new InvalidVisibleFieldError(`字段 ${field} 不在允许的可见字段清单中`);
    }
  }
}

/** null/空数组都归一为 null（= 系统默认白名单）。 */
function serializeVisibleFields(fields: string[] | null | undefined): string | null {
  return fields && fields.length > 0 ? JSON.stringify(fields) : null;
}

function effectiveFields(fields: string[] | null | undefined, defaults: readonly string[]) {
  return fields && fields.length > 0 ? fields : [...defaults];
}

function reconcileStoredOrder(
  raw: string | null,
  fields: string[] | null | undefined,
  defaults: readonly string[],
): string | null {
  if (!parseVisibleTicketFields(raw)?.length) return null;
  return JSON.stringify(resolveExternalFieldOrder(raw, effectiveFields(fields, defaults)));
}

function sensitiveFieldSet(
  listFields: string[] | null | undefined,
  detailFields: string[] | null | undefined,
) {
  const visible = new Set([
    ...effectiveFields(listFields, DEFAULT_EXTERNAL_LIST_FIELDS),
    ...effectiveFields(detailFields, DEFAULT_EXTERNAL_DETAIL_FIELDS),
  ]);
  return new Set(
    ACCOUNT_AUTHORIZABLE_SENSITIVE_TICKET_FIELDS.filter((field) => visible.has(field)),
  );
}

async function writeSensitiveFieldAudit(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  targetAccountId: string,
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
) {
  const grantedFields = ACCOUNT_AUTHORIZABLE_SENSITIVE_TICKET_FIELDS.filter(
    (field) => !before.has(field) && after.has(field),
  );
  const revokedFields = ACCOUNT_AUTHORIZABLE_SENSITIVE_TICKET_FIELDS.filter(
    (field) => before.has(field) && !after.has(field),
  );
  if (grantedFields.length === 0 && revokedFields.length === 0) {
    return;
  }
  await tx.externalAccountFieldAudit.create({
    data: {
      targetAccountId,
      actorId: actor.id,
      actorName: actor.name,
      grantedFields,
      revokedFields,
    },
  });
}

function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  // Driver adapters carry the violated fields at
  // meta.driverAdapterError.cause.constraint.fields instead of meta.target.
  const cause = (
    error.meta?.driverAdapterError as { cause?: { constraint?: { fields?: unknown } } } | undefined
  )?.cause;
  const fields = cause?.constraint?.fields;
  return Array.isArray(fields) && fields.includes(field);
}

function throwOnDuplicateIdentity(error: unknown): never {
  if (isUniqueViolationOn(error, "username")) {
    throw new DuplicateUsernameError();
  }
  if (isUniqueViolationOn(error, "email")) {
    throw new DuplicateEmailError();
  }
  throw error;
}

/** Judged on the stored permission array, so 管理员 (system) counts as internal. */
async function loadExternalAccount(prisma: PrismaClient, id: string) {
  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      externalListFields: true,
      externalDetailFields: true,
      externalListOrder: true,
      externalExportOrder: true,
      role: { select: { system: true, permissions: true } },
    },
  });
  if (!target) {
    throw new UserNotFoundError();
  }
  if (!isExternalRole(target.role)) {
    throw new ExternalAccountOnlyError();
  }
  return target;
}

/**
 * The one 外部角色 every 外部账号 is born holding — 建号不选角色, so the role is
 * looked up here rather than passed in.
 */
async function loadSoleExternalRole(prisma: PrismaClient) {
  const roles = await prisma.role.findMany({
    select: { id: true, system: true, permissions: true },
  });
  const external = roles.filter((role) => isExternalRole(role));
  if (external.length !== 1 || !external[0]) {
    throw new ExternalRoleNotUniqueError(external.length);
  }
  return external[0];
}

async function resolvePrefillChannel(prisma: PrismaClient, channelId: string | null) {
  if (channelId === null) {
    return;
  }
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true },
  });
  if (!channel) {
    throw new PrefillChannelNotFoundError();
  }
}

/** 外部账号的判定 where：角色库存权限数组命中外部权限点的非系统角色。 */
const EXTERNAL_ACCOUNT_WHERE: Prisma.UserWhereInput = {
  role: { is: { system: false, permissions: { hasSome: [...EXTERNAL_ROLE_PERMISSIONS] } } },
};

const accountListInclude = {
  prefillChannel: { select: { name: true } },
  _count: { select: { createdTickets: true } },
} as const;

type AccountListRow = Prisma.UserGetPayload<{ include: typeof accountListInclude }>;

function toListItem(row: AccountListRow): ExternalAccountListItem {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    prefill: {
      channelId: row.prefillChannelId,
      channelName: row.prefillChannel?.name ?? null,
      project: row.prefillProject,
      brokerageEntity: row.prefillBrokerageEntity,
      paymentChannel: row.prefillPaymentChannel,
      userComplaintChannel: row.prefillUserComplaintChannel,
      complaintReceiveChannel: row.prefillComplaintReceiveChannel,
    },
    listVisibleFields: parseVisibleTicketFields(row.externalListFields),
    detailVisibleFields: parseVisibleTicketFields(row.externalDetailFields),
    ticketCount: row._count.createdTickets,
  };
}

/** 全部外部账号，启停皆列（禁用的可在此重新启用）。 */
export async function listExternalAccounts(
  deps: ExternalAccountServiceDeps,
): Promise<ExternalAccountListItem[]> {
  const rows = await deps.prisma.user.findMany({
    where: EXTERNAL_ACCOUNT_WHERE,
    include: accountListInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toListItem);
}

/** New 外部账号：active from the start, 唯一外部角色服务端挂载, password bcrypt-hashed here. */
export async function createExternalAccount(
  deps: ExternalAccountServiceDeps,
  actor: AuthenticatedUser,
  input: ExternalAccountCreateData,
) {
  const { prisma } = deps;
  validateVisibleFields(input.listVisibleFields);
  validateVisibleFields(input.detailVisibleFields);
  await resolvePrefillChannel(prisma, input.prefill?.channelId ?? null);
  const role = await loadSoleExternalRole(prisma);

  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: input.username,
          name: input.name,
          email: input.email,
          team: null,
          roleId: role.id,
          passwordHash,
          active: true,
          prefillChannelId: input.prefill?.channelId ?? null,
          prefillProject: input.prefill?.project ?? null,
          prefillBrokerageEntity: input.prefill?.brokerageEntity ?? null,
          prefillPaymentChannel: input.prefill?.paymentChannel ?? null,
          prefillUserComplaintChannel: input.prefill?.userComplaintChannel ?? null,
          prefillComplaintReceiveChannel: input.prefill?.complaintReceiveChannel ?? null,
          externalListFields: serializeVisibleFields(input.listVisibleFields),
          externalDetailFields: serializeVisibleFields(input.detailVisibleFields),
        },
        select: { id: true, name: true },
      });
      await writeSensitiveFieldAudit(
        tx,
        actor,
        created.id,
        new Set(),
        sensitiveFieldSet(input.listVisibleFields, input.detailVisibleFields),
      );
      return created;
    });
  } catch (error) {
    throwOnDuplicateIdentity(error);
  }
}

/**
 * Edit a 外部账号: basic info + 预填/白名单整体替换 + optional password reset
 * (kills the target's sessions in the same transaction, same as updateUser).
 */
export async function updateExternalAccount(
  deps: ExternalAccountServiceDeps,
  actor: AuthenticatedUser,
  input: ExternalAccountUpdateData,
) {
  const { prisma } = deps;
  const existing = await loadExternalAccount(prisma, input.id);
  validateVisibleFields(input.listVisibleFields);
  validateVisibleFields(input.detailVisibleFields);
  if (input.prefill !== undefined) {
    await resolvePrefillChannel(prisma, input.prefill.channelId);
  }

  const data: Prisma.UserUncheckedUpdateInput = {
    username: input.username,
    name: input.name,
    email: input.email,
  };
  if (input.password !== null) {
    data.passwordHash = await hashPassword(input.password);
  }
  if (input.prefill !== undefined) {
    data.prefillChannelId = input.prefill.channelId;
    data.prefillProject = input.prefill.project;
    data.prefillBrokerageEntity = input.prefill.brokerageEntity;
    data.prefillPaymentChannel = input.prefill.paymentChannel;
    data.prefillUserComplaintChannel = input.prefill.userComplaintChannel;
    data.prefillComplaintReceiveChannel = input.prefill.complaintReceiveChannel;
  }
  if (input.listVisibleFields !== undefined) {
    data.externalListFields = serializeVisibleFields(input.listVisibleFields);
    data.externalListOrder = reconcileStoredOrder(
      existing.externalListOrder,
      input.listVisibleFields,
      DEFAULT_EXTERNAL_LIST_FIELDS,
    );
  }
  if (input.detailVisibleFields !== undefined) {
    data.externalDetailFields = serializeVisibleFields(input.detailVisibleFields);
    data.externalExportOrder = reconcileStoredOrder(
      existing.externalExportOrder,
      input.detailVisibleFields,
      DEFAULT_EXTERNAL_DETAIL_FIELDS,
    );
  }

  return prisma.$transaction(async (tx) => {
    let updated: { id: string; name: string };
    try {
      updated = await tx.user.update({
        where: { id: input.id },
        data,
        select: { id: true, name: true },
      });
    } catch (error) {
      // P2025 = no user with that id
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new UserNotFoundError();
      }
      throwOnDuplicateIdentity(error);
    }
    if (input.password !== null) {
      await tx.session.deleteMany({ where: { userId: input.id } });
    }
    await writeSensitiveFieldAudit(
      tx,
      actor,
      input.id,
      sensitiveFieldSet(
        parseVisibleTicketFields(existing.externalListFields),
        parseVisibleTicketFields(existing.externalDetailFields),
      ),
      sensitiveFieldSet(
        input.listVisibleFields === undefined
          ? parseVisibleTicketFields(existing.externalListFields)
          : input.listVisibleFields,
        input.detailVisibleFields === undefined
          ? parseVisibleTicketFields(existing.externalDetailFields)
          : input.detailVisibleFields,
      ),
    );
    return updated;
  });
}

/**
 * 禁用/启用 a 外部账号 — same semantics as setUserActive (disable kills live
 * sessions), minus the last-admin check: an 外部账号 is never the system role.
 */
export async function setExternalAccountActive(
  deps: ExternalAccountServiceDeps,
  actor: AuthenticatedUser,
  input: ExternalAccountSetActiveInput,
) {
  const { prisma } = deps;
  if (input.id === actor.id && !input.active) {
    throw new SelfDisableError();
  }
  await loadExternalAccount(prisma, input.id);

  return prisma.$transaction(async (tx) => {
    let updated: { id: string; name: string; active: boolean };
    try {
      updated = await tx.user.update({
        where: { id: input.id },
        data: { active: input.active },
        select: { id: true, name: true, active: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new UserNotFoundError();
      }
      throw error;
    }
    if (!input.active) {
      await tx.session.deleteMany({ where: { userId: input.id } });
    }
    return updated;
  });
}
