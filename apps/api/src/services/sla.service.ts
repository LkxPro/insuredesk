import {
  reminderRulesSchema,
  type SlaPolicyCreateInput,
  type SlaPolicyEntity,
  type SlaPolicyOption,
  type SlaPolicySortInput,
  type SlaPolicyUpdateInput,
} from "@insuredesk/shared";
import type { SlaPolicy } from "../generated/prisma/client.ts";
import { Prisma } from "../generated/prisma/client.ts";
import type { TicketServiceDeps } from "./ticket.service.ts";

/**
 * 时效策略 domain logic. Pure service layer — the router wraps these with
 * sla.view / sla.edit（options 仅登录）.
 *
 * 时效策略是目录实体：name 全表唯一（含停用行）、sortOrder 排序、active 停用/
 * 复活，无物理删除。写策略没有 "apply to existing tickets" 步骤：dueAt 建单
 * 盖章（改策略引用时锚定原始 createdAt 重盖），其余消费方（待办、dashboard）
 * 读时判定——保存即发布。
 */

/** 策略名撞车（含停用行）。 */
export class SlaPolicyNameConflictError extends Error {
  constructor(name: string) {
    super(`时效策略「${name}」名称已存在`);
    this.name = "SlaPolicyNameConflictError";
  }
}

export class SlaPolicyNotFoundError extends Error {
  constructor() {
    super("时效策略不存在");
    this.name = "SlaPolicyNotFoundError";
  }
}

export class SlaPolicySortMismatchError extends Error {
  constructor() {
    super("排序清单须恰好包含全部时效策略");
    this.name = "SlaPolicySortMismatchError";
  }
}

function toDto(row: SlaPolicy): SlaPolicyEntity {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    active: row.active,
    firstResponseMinutes: row.firstResponseMinutes,
    overdueHours: row.overdueHours,
    reminderRules: reminderRulesSchema.parse(row.reminderRules),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The full catalog for the SLA 管理页 — 停用行在内, 按目录序. */
export async function listSlaPolicies({ prisma }: TicketServiceDeps) {
  const rows = await prisma.slaPolicy.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toDto);
}

/** 录入下拉源（登录可用）：仅启用策略, 按目录序. */
export async function listSlaPolicyOptions({
  prisma,
}: TicketServiceDeps): Promise<SlaPolicyOption[]> {
  const rows = await prisma.slaPolicy.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, description: true },
  });
  return rows;
}

/** 新建策略：名称全表唯一（含停用行），sortOrder 追加到末尾，恒为启用。 */
export async function createSlaPolicy({ prisma }: TicketServiceDeps, input: SlaPolicyCreateInput) {
  const max = await prisma.slaPolicy.aggregate({ _max: { sortOrder: true } });
  try {
    const row = await prisma.slaPolicy.create({
      data: {
        name: input.name,
        description: input.description,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
        active: true,
        firstResponseMinutes: input.firstResponseMinutes,
        overdueHours: input.overdueHours,
        reminderRules: input.reminderRules,
      },
    });
    return toDto(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SlaPolicyNameConflictError(input.name);
    }
    throw error;
  }
}

/** 按 id 分项更新：缺席字段保持原值；改名撞任何行（含停用）即拒绝。 */
export async function updateSlaPolicy({ prisma }: TicketServiceDeps, input: SlaPolicyUpdateInput) {
  const existing = await prisma.slaPolicy.findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new SlaPolicyNotFoundError();
  }
  const data: Prisma.SlaPolicyUpdateInput = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.firstResponseMinutes !== undefined && {
      firstResponseMinutes: input.firstResponseMinutes,
    }),
    ...(input.overdueHours !== undefined && { overdueHours: input.overdueHours }),
    ...(input.reminderRules !== undefined && { reminderRules: input.reminderRules }),
  };
  try {
    return toDto(await prisma.slaPolicy.update({ where: { id: input.id }, data }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SlaPolicyNameConflictError(input.name ?? existing.name);
    }
    throw error;
  }
}

/** 整组重排：清单须恰好覆盖全部策略（含停用行），顺序即新 sortOrder 1..n。 */
export async function sortSlaPolicies(deps: TicketServiceDeps, input: SlaPolicySortInput) {
  const { prisma } = deps;
  const rows = await prisma.slaPolicy.findMany({ select: { id: true } });
  const incoming = new Set(input.policyIds);
  if (
    incoming.size !== input.policyIds.length ||
    incoming.size !== rows.length ||
    rows.some((row) => !incoming.has(row.id))
  ) {
    throw new SlaPolicySortMismatchError();
  }
  await prisma.$transaction(
    input.policyIds.map((id, index) =>
      prisma.slaPolicy.update({ where: { id }, data: { sortOrder: index + 1 } }),
    ),
  );
  return listSlaPolicies(deps);
}

/** 停用/复活。停用不拆引用：存量工单照常显示，读时判定走降级路径。 */
export async function setSlaPolicyActive(
  { prisma }: TicketServiceDeps,
  input: { id: string; active: boolean },
) {
  const existing = await prisma.slaPolicy.findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new SlaPolicyNotFoundError();
  }
  if (existing.active === input.active) {
    return toDto(existing);
  }
  return toDto(
    await prisma.slaPolicy.update({ where: { id: input.id }, data: { active: input.active } }),
  );
}
