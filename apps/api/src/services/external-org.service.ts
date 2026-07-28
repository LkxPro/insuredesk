import type {
  ExternalOrgCreateInput,
  ExternalOrgGetInput,
  ExternalOrgListItem,
  ExternalOrgSetActiveInput,
  ExternalOrgUpdateInput,
} from "@insuredesk/shared";
import { EXTERNAL_VISIBLE_FIELD_OPTIONS, SENSITIVE_TICKET_FIELDS } from "@insuredesk/shared";
import { Prisma, type PrismaClient } from "../generated/prisma/client";

export interface ExternalOrgServiceDeps {
  prisma: PrismaClient;
}

export class OrgNotFoundError extends Error {
  constructor() {
    super("外部机构不存在");
    this.name = "OrgNotFoundError";
  }
}

export class DuplicateOrgNameError extends Error {
  constructor() {
    super("机构名称已存在");
    this.name = "DuplicateOrgNameError";
  }
}

export class InvalidVisibleFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVisibleFieldError";
  }
}

function validateVisibleFields(fields: string[] | undefined | null): void {
  if (!fields || fields.length === 0) {
    return;
  }

  const allowedSet = new Set(EXTERNAL_VISIBLE_FIELD_OPTIONS);
  const sensitiveSet = new Set(SENSITIVE_TICKET_FIELDS);

  for (const field of fields) {
    if (sensitiveSet.has(field)) {
      throw new InvalidVisibleFieldError(`字段 ${field} 为敏感字段，不允许外部可见`);
    }
    if (!allowedSet.has(field)) {
      throw new InvalidVisibleFieldError(`字段 ${field} 不在允许的可见字段清单中`);
    }
  }
}

function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const cause = (
    error.meta?.driverAdapterError as { cause?: { constraint?: { fields?: unknown } } } | undefined
  )?.cause;
  const fields = cause?.constraint?.fields;
  return Array.isArray(fields) && fields.includes(field);
}

function throwOnDuplicateName(error: unknown): never {
  if (isUniqueViolationOn(error, "name")) {
    throw new DuplicateOrgNameError();
  }
  throw error;
}

/** 数据库存 JSON 字符串；null 或损坏值都归一为 null（= 系统默认白名单）。 */
function parseVisibleFields(raw: string | null): string[] | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const orgListInclude = {
  channel: { select: { name: true } },
  _count: { select: { users: true } },
} as const;

function toListItem(org: {
  id: string;
  name: string;
  channelId: string | null;
  visibleTicketFields: string | null;
  active: boolean;
  channel: { name: string } | null;
  _count: { users: number };
}): ExternalOrgListItem {
  return {
    id: org.id,
    name: org.name,
    channelId: org.channelId,
    channelName: org.channel?.name ?? null,
    visibleTicketFields: parseVisibleFields(org.visibleTicketFields),
    userCount: org._count.users,
    active: org.active,
  };
}

export async function listExternalOrgs(
  deps: ExternalOrgServiceDeps,
): Promise<ExternalOrgListItem[]> {
  const { prisma } = deps;

  const orgs = await prisma.externalOrg.findMany({
    include: orgListInclude,
    orderBy: { createdAt: "desc" },
  });

  return orgs.map(toListItem);
}

export async function getExternalOrg(
  deps: ExternalOrgServiceDeps,
  input: ExternalOrgGetInput,
): Promise<ExternalOrgListItem> {
  const { prisma } = deps;

  const org = await prisma.externalOrg.findUnique({
    where: { id: input.id },
    include: orgListInclude,
  });

  if (!org) {
    throw new OrgNotFoundError();
  }

  return toListItem(org);
}

export async function createExternalOrg(
  deps: ExternalOrgServiceDeps,
  input: ExternalOrgCreateInput,
): Promise<{ id: string }> {
  const { prisma } = deps;

  validateVisibleFields(input.visibleTicketFields);

  const visibleTicketFields = input.visibleTicketFields
    ? JSON.stringify(input.visibleTicketFields)
    : null;

  try {
    const org = await prisma.externalOrg.create({
      data: {
        name: input.name,
        channelId: input.channelId ?? null,
        visibleTicketFields,
        active: true,
      },
      select: { id: true },
    });

    return { id: org.id };
  } catch (error) {
    throwOnDuplicateName(error);
  }
}

export async function updateExternalOrg(
  deps: ExternalOrgServiceDeps,
  input: ExternalOrgUpdateInput,
): Promise<{ success: true }> {
  const { prisma } = deps;

  validateVisibleFields(input.visibleTicketFields ?? undefined);

  const updateData: Record<string, unknown> = {};

  if (input.name !== undefined) {
    updateData.name = input.name;
  }

  if (input.channelId !== undefined) {
    updateData.channelId = input.channelId;
  }

  if (input.visibleTicketFields !== undefined) {
    updateData.visibleTicketFields =
      input.visibleTicketFields === null || input.visibleTicketFields.length === 0
        ? null
        : JSON.stringify(input.visibleTicketFields);
  }

  try {
    const result = await prisma.externalOrg.updateMany({
      where: { id: input.id },
      data: updateData,
    });

    if (result.count === 0) {
      throw new OrgNotFoundError();
    }

    return { success: true };
  } catch (error) {
    throwOnDuplicateName(error);
  }
}

export async function setExternalOrgActive(
  deps: ExternalOrgServiceDeps,
  input: ExternalOrgSetActiveInput,
): Promise<{ success: true }> {
  const { prisma } = deps;

  const result = await prisma.externalOrg.updateMany({
    where: { id: input.id },
    data: { active: input.active },
  });

  if (result.count === 0) {
    throw new OrgNotFoundError();
  }

  return { success: true };
}
