import {
  applyNoPolicyNumber,
  joinPolicyNumbers,
  PRIORITY_LABELS,
  type Priority,
  TICKET_CREATE_FIELD_KEYS,
  type TicketCreateFieldKey,
  type TicketEditData,
  TicketKindKey,
  TicketStatus,
  type TicketUpdateRefundCompensationData,
  ticketProcessLogLabel,
} from "@insuredesk/shared";
import type { Prisma } from "../generated/prisma/client.ts";
import type { AuthenticatedUser } from "./auth.service.ts";
import { channelCatalog } from "./channel.service.ts";
import { applyTicketDataScope } from "./data-scope.service.ts";
import { feedbackReceiveChannelCatalog } from "./feedback-receive-channel.service.ts";
import {
  findSlaPolicyById,
  SlaPolicyKindMismatchError,
  SlaPolicyNotConfiguredError,
  stampFromPolicy,
  type TicketServiceDeps,
  toDateOrNull,
} from "./ticket.service.ts";
import { TicketNotFoundError } from "./ticket-assign.service.ts";
import { ticketCategoryCatalog } from "./ticket-category.service.ts";
import { assertNoDuplicateTickets } from "./ticket-duplicate.service.ts";
import { userFeedbackChannelCatalog } from "./user-feedback-channel.service.ts";

/**
 * Edit domain logic: every basic-info field editable in any status, 已完结
 * included.
 *
 * Invariants enforced here:
 * - status is untouchable by construction: the input schema has no status
 *   field and this update never writes one, so editing can never reopen a
 *   completed ticket
 * - 改时效策略引用 = 改 SLA: dueAt re-runs the creation formula (slaAnchorAt +
 *   the NEW policy's overdueHours — computeDueAt, off the fixed slaAnchorAt
 *   base), and 跟进频次/首响要求 re-stamp from the new policy. This may flip the
 *   ticket straight into overdue (e.g. 特急→一般 past 48h) — intended, and the
 *   read-time display/list predicates pick it up with no further writes.
 * - 保持原引用不重校验：引用未变时即便策略已停用也不报错（目录语义同款——
 *   编辑可保持原停用值）；只有新选才要求存在且启用。
 * - 提醒只对未来生效: nothing to do here BY DESIGN — 轨 2 reminders are
 *   computed at read time from the current policy's rules, so
 *   already-passed checkpoints of the new policy simply never fire; there is no
 *   stored reminder to skip or back-fill
 * - priority is a free label: editing it drives no SLA field whatsoever
 * - 留痕: one `edit` ProcessLog per effective edit, remark = the changed
 *   fields with before→after values; 改策略引用时 from/to 存策略名字面快照;
 *   an edit that changes nothing writes nothing
 */

type EditableFields = Omit<TicketEditData, "ticketId" | "complaintLevel">;
type EditableFieldKey = keyof EditableFields;
type DiffFieldKey = Exclude<TicketCreateFieldKey, "slaPolicyId">;

type DetailFieldKey =
  | Exclude<TicketCreateFieldKey, "slaPolicyId" | "contactPhone">
  | "noPolicyNumber";

const EDITABLE_FIELD_KEYS: readonly DiffFieldKey[] = TICKET_CREATE_FIELD_KEYS.filter(
  (key) => key !== "slaPolicyId",
);

type EditableValue = string | string[] | boolean | Date | null;

export class EditKindMismatchError extends Error {
  constructor(endpoint: "editComplaint" | "editRefund") {
    super(
      endpoint === "editComplaint"
        ? "退费异常工单请使用 editRefund 编辑"
        : "非退费异常工单请使用 editComplaint 编辑",
    );
    this.name = "EditKindMismatchError";
  }
}

/**
 * One remark-side value. Priorities render their Chinese labels (the stored
 * codes are English); datetimes render the unambiguous ISO instant — the
 * remark is a permanent audit string, so no viewer-local formatting here.
 * 多值保单号按展示口径空格 join；空数组即未填写。
 */
function formatValue(key: DiffFieldKey, value: EditableValue): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "（空）" : joinPolicyNumbers(value);
  }
  if (value === null || value === "") {
    return "（空）";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return key === "priority" ? PRIORITY_LABELS[value as Priority] : value;
}

function sameValue(before: EditableValue, after: EditableValue) {
  if (Array.isArray(before) || Array.isArray(after)) {
    // 顺序参与比较：同一批值换个次序也算改动
    return (
      Array.isArray(before) &&
      Array.isArray(after) &&
      before.length === after.length &&
      before.every((value, index) => value === after[index])
    );
  }
  if (before instanceof Date || after instanceof Date) {
    return before instanceof Date && after instanceof Date && before.getTime() === after.getTime();
  }
  return before === after;
}

const editInclude = {
  // The catalog/policy name snapshots for the remark: the values as they read
  // NOW, before this edit — the log keeps the literal wording of the moment
  slaPolicy: { select: { name: true } },
  kind: { select: { key: true } },
  complaintDetail: {
    include: {
      category: { select: { name: true } },
      channel: { select: { name: true } },
      userFeedbackChannel: { select: { name: true } },
      feedbackReceiveChannel: { select: { name: true } },
    },
  },
} satisfies Prisma.TicketInclude;

/** 缺 detail 行的存量投诉单：before 一律取「未填写」态，upsert 兜底补齐。 */
const EMPTY_DETAIL_BEFORE = {
  feedbackTime: null,
  channelId: null,
  project: null,
  brokerageEntity: null,
  paymentChannel: null,
  internalOrderNumber: null,
  policyNumbers: [] as string[],
  noPolicyNumber: false,
  userFeedbackChannelId: null,
  feedbackReceiveChannelId: null,
  customerName: null,
  phone: null,
  customerRequest: null,
  nuclearBodyStatus: null,
  hasContacted: null,
  contactTime: null,
  contactId: null,
  categoryId: null,
  priority: null,
} satisfies Record<DetailFieldKey, EditableValue>;

async function resolveSlaChange(
  tx: Prisma.TransactionClient,
  ticket: { slaPolicyId: string | null; kindId: string; slaAnchorAt: Date; status: string },
  nextSlaPolicyId: string | null,
) {
  const refPolicy = await findSlaPolicyById(tx, nextSlaPolicyId);
  const slaChanged = (refPolicy?.id ?? null) !== ticket.slaPolicyId;
  if (slaChanged && refPolicy !== null) {
    if (!refPolicy.active) {
      throw new SlaPolicyNotConfiguredError(refPolicy.name);
    }
    if (refPolicy.kindId !== ticket.kindId) {
      throw new SlaPolicyKindMismatchError(refPolicy.name);
    }
  }
  // 改策略引用 = 改 SLA: everything the policy stamped at creation re-derives
  // from the new policy, off the unchanged slaAnchorAt — the SLA clock stays
  // anchored to the original 计时锚 even when the reference is only supplied
  // by a later edit. Clearing the reference clears all stamps (未指定 = no
  // SLA clock). 已完结工单盖章冻结——历史超时口径（考核 completionTime > dueAt）
  // 依赖完结时刻的 dueAt。
  const slaFields: Prisma.TicketUncheckedUpdateInput = slaChanged
    ? ticket.status === TicketStatus.Completed
      ? { slaPolicyId: refPolicy?.id ?? null }
      : stampFromPolicy(refPolicy, ticket.slaAnchorAt)
    : {};
  return { refPolicy, slaChanged, slaFields };
}

async function writeEditLog(
  tx: Prisma.TransactionClient,
  ticket: { id: string; slaPolicyId: string | null },
  beforeSlaPolicyName: string | null,
  actor: AuthenticatedUser,
  now: Date,
  remarkLines: string[],
  sla: { refPolicy: { name: string } | null; slaChanged: boolean },
) {
  await tx.processLog.create({
    data: {
      ticketId: ticket.id,
      operatorId: actor.id,
      operatorName: actor.name,
      action: "edit",
      from: sla.slaChanged ? beforeSlaPolicyName : null,
      to: sla.slaChanged ? (sla.refPolicy?.name ?? null) : null,
      remark: remarkLines.join("；"),
      at: now,
    },
  });
}

/**
 * The lookup carries the viewer data scope, so an editor without
 * ticket.view_all stays on their own tickets — anything else surfaces as
 * not-found (no existence leak).
 * 缺 detail 行的存量工单由 upsert 兜底补齐（防御漏建行）。
 */
export async function editComplaint(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: TicketEditData,
  options?: { allowDuplicate?: boolean },
) {
  const now = clock.now();
  const { ticketId, ...fields } = input;
  // The wire carries datetimes as ISO strings (or null = 未填写);
  // everything downstream (diff, remark, update) works on the parsed instant.
  const next = applyNoPolicyNumber({
    ...fields,
    feedbackTime: toDateOrNull(fields.feedbackTime),
    contactTime: toDateOrNull(fields.contactTime),
  });
  const { slaPolicyId: nextSlaPolicyId, complaintLevel: _legacy, ...writableNext } = next;

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, deletedAt: null, ...applyTicketDataScope(actor) },
      include: editInclude,
    });
    if (!ticket) {
      throw new TicketNotFoundError();
    }
    if (ticket.kind.key === TicketKindKey.RefundException) {
      throw new EditKindMismatchError("editComplaint");
    }

    const before: Record<DetailFieldKey, EditableValue> =
      ticket.complaintDetail ?? EMPTY_DETAIL_BEFORE;
    const beforeValue = (key: DiffFieldKey): EditableValue =>
      key === "contactPhone" ? ticket.contactPhone : before[key];
    const nextValue = (key: DiffFieldKey): EditableValue => writableNext[key];

    // 数组两侧都是 [] 时靠 flag 识别 无↔留空 的变化
    const noneToggled = before.noPolicyNumber !== next.noPolicyNumber;
    const changedFields = EDITABLE_FIELD_KEYS.filter(
      (key) =>
        !sameValue(beforeValue(key), nextValue(key)) || (key === "policyNumbers" && noneToggled),
    );

    const { refPolicy, slaChanged, slaFields } = await resolveSlaChange(
      tx,
      ticket,
      nextSlaPolicyId,
    );

    if (changedFields.length === 0 && !slaChanged) {
      // Nothing changed → no update, no log: a remark with no field diffs
      // would violate its own contract (remark 记录改动的字段)
      return { id: ticket.id, workOrderNumber: ticket.workOrderNumber, changedFields };
    }

    // 提交兜底查重：仅查重相关字段实际改动才查 —— 无关字段的编辑不该被存量
    // 重复阻塞；查重字段未改时自身旧值必中，excludeTicketId 挡的就是这发。
    if (
      !options?.allowDuplicate &&
      changedFields.some(
        (key) => key === "policyNumbers" || key === "phone" || key === "contactPhone",
      )
    ) {
      await assertNoDuplicateTickets(
        { prisma: tx, clock },
        {
          policyNumbers: next.policyNumbers,
          phone: next.phone,
          contactPhone: next.contactPhone,
          excludeTicketId: ticketId,
        },
      );
    }

    // Only a NEWLY chosen catalog reference must exist and be active —
    // keeping the current value (even a since-停用 one) never re-validates, so
    // a ticket holding a disabled reference survives unrelated edits untouched.
    const detailRow = ticket.complaintDetail;
    const catalogNames: Partial<Record<DiffFieldKey, Record<"from" | "to", string | null>>> = {
      categoryId: {
        from: detailRow?.category?.name ?? null,
        to: changedFields.includes("categoryId")
          ? ((await ticketCategoryCatalog.resolveNewRef(tx, next.categoryId))?.name ?? null)
          : null,
      },
      channelId: {
        from: detailRow?.channel?.name ?? null,
        to: changedFields.includes("channelId")
          ? ((await channelCatalog.resolveNewRef(tx, next.channelId))?.name ?? null)
          : null,
      },
      userFeedbackChannelId: {
        from: detailRow?.userFeedbackChannel?.name ?? null,
        to: changedFields.includes("userFeedbackChannelId")
          ? ((await userFeedbackChannelCatalog.resolveNewRef(tx, next.userFeedbackChannelId))
              ?.name ?? null)
          : null,
      },
      feedbackReceiveChannelId: {
        from: detailRow?.feedbackReceiveChannel?.name ?? null,
        to: changedFields.includes("feedbackReceiveChannelId")
          ? ((await feedbackReceiveChannelCatalog.resolveNewRef(tx, next.feedbackReceiveChannelId))
              ?.name ?? null)
          : null,
      },
    };

    const {
      contactPhone: _corePhone,
      slaPolicyId: _corePolicy,
      complaintLevel: _legacyKey,
      ...detailData
    } = next;

    // detail 改动同事务 touch tickets.updatedAt：核心列可能零改动
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { contactPhone: next.contactPhone, ...slaFields, updatedAt: now },
    });
    if (changedFields.some((key) => key !== "contactPhone")) {
      await tx.ticketComplaintDetail.upsert({
        where: { ticketId: ticket.id },
        create: { ticketId: ticket.id, ...detailData },
        update: detailData,
      });
    }

    // 多字段改动记在 remark 里。目录引用与策略引用按当时名称留痕（快照），
    // 不随后续改名回写；策略引用变化同时落到 from/to。
    const sideValue = (key: DiffFieldKey, side: "from" | "to") => {
      const catalog = catalogNames[key];
      if (catalog) {
        return catalog[side];
      }
      return side === "from" ? beforeValue(key) : nextValue(key);
    };
    // 留痕里「无」与（空）= 未填写是两种状态
    const formatSide = (key: DiffFieldKey, side: "from" | "to") => {
      if (
        key === "policyNumbers" &&
        (side === "from" ? before.noPolicyNumber : next.noPolicyNumber)
      ) {
        return "无";
      }
      return formatValue(key, sideValue(key, side));
    };
    const slaLine = slaChanged
      ? `${ticketProcessLogLabel("slaPolicyId")}: ${ticket.slaPolicy?.name ?? "（空）"}→${refPolicy?.name ?? "（空）"}`
      : null;
    const remarkLines = TICKET_CREATE_FIELD_KEYS.flatMap((key) => {
      if (key === "slaPolicyId") {
        return slaLine === null ? [] : [slaLine];
      }
      return changedFields.includes(key as (typeof changedFields)[number])
        ? [`${ticketProcessLogLabel(key)}: ${formatSide(key, "from")}→${formatSide(key, "to")}`]
        : [];
    });
    await writeEditLog(tx, ticket, ticket.slaPolicy?.name ?? null, actor, now, remarkLines, {
      refPolicy,
      slaChanged,
    });

    return {
      id: ticket.id,
      workOrderNumber: ticket.workOrderNumber,
      changedFields: [
        ...changedFields,
        ...(slaChanged ? (["slaPolicyId"] as const) : []),
      ] as EditableFieldKey[],
    };
  });
}

export async function editRefund(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: { ticketId: string; contactPhone: string | null; slaPolicyId: string | null },
  options?: { allowDuplicate?: boolean },
) {
  const now = clock.now();
  const { ticketId, contactPhone: nextContactPhone, slaPolicyId: nextSlaPolicyId } = input;

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, deletedAt: null, ...applyTicketDataScope(actor) },
      include: editInclude,
    });
    if (!ticket) {
      throw new TicketNotFoundError();
    }
    if (ticket.kind.key !== TicketKindKey.RefundException) {
      throw new EditKindMismatchError("editRefund");
    }

    const changedFields: readonly "contactPhone"[] = sameValue(
      ticket.contactPhone,
      nextContactPhone,
    )
      ? []
      : ["contactPhone"];

    const { refPolicy, slaChanged, slaFields } = await resolveSlaChange(
      tx,
      ticket,
      nextSlaPolicyId,
    );

    if (changedFields.length === 0 && !slaChanged) {
      return { id: ticket.id, workOrderNumber: ticket.workOrderNumber, changedFields };
    }

    if (!options?.allowDuplicate && changedFields.includes("contactPhone")) {
      await assertNoDuplicateTickets(
        { prisma: tx, clock },
        {
          policyNumbers: [],
          phone: null,
          contactPhone: nextContactPhone,
          excludeTicketId: ticketId,
        },
      );
    }

    await tx.ticket.update({
      where: { id: ticket.id },
      data: { contactPhone: nextContactPhone, ...slaFields, updatedAt: now },
    });

    const slaLine = slaChanged
      ? `${ticketProcessLogLabel("slaPolicyId")}: ${ticket.slaPolicy?.name ?? "（空）"}→${refPolicy?.name ?? "（空）"}`
      : null;
    const remarkLines = [
      ...(changedFields.includes("contactPhone")
        ? [
            `${ticketProcessLogLabel("contactPhone")}: ${formatValue("contactPhone", ticket.contactPhone)}→${formatValue("contactPhone", nextContactPhone)}`,
          ]
        : []),
      ...(slaLine === null ? [] : [slaLine]),
    ];
    await writeEditLog(tx, ticket, ticket.slaPolicy?.name ?? null, actor, now, remarkLines, {
      refPolicy,
      slaChanged,
    });

    return {
      id: ticket.id,
      workOrderNumber: ticket.workOrderNumber,
      changedFields: [
        ...changedFields,
        ...(slaChanged ? (["slaPolicyId"] as const) : []),
      ] as EditableFieldKey[],
    };
  });
}

export class RefundCompensationNotApplicableError extends Error {
  constructor() {
    super("非退费异常工单，无补偿金可编辑");
    this.name = "RefundCompensationNotApplicableError";
  }
}

export class RefundCompensationLockedError extends Error {
  constructor() {
    super("工单已完结，补偿金已随回调载荷快照锁定");
    this.name = "RefundCompensationLockedError";
  }
}

export async function updateRefundCompensation(
  { prisma, clock }: TicketServiceDeps,
  actor: AuthenticatedUser,
  input: TicketUpdateRefundCompensationData,
) {
  const now = clock.now();
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, deletedAt: null, ...applyTicketDataScope(actor) },
      select: {
        id: true,
        workOrderNumber: true,
        status: true,
        kind: { select: { key: true } },
        refundDetail: { select: { compensationAmount: true } },
      },
    });
    if (!ticket) {
      throw new TicketNotFoundError();
    }
    if (ticket.kind.key !== TicketKindKey.RefundException || ticket.refundDetail === null) {
      throw new RefundCompensationNotApplicableError();
    }
    if (ticket.status === TicketStatus.Completed) {
      throw new RefundCompensationLockedError();
    }
    if (ticket.refundDetail.compensationAmount !== input.compensationAmount) {
      await tx.ticketRefundDetail.update({
        where: { ticketId: ticket.id },
        data: { compensationAmount: input.compensationAmount },
      });
      await tx.processLog.create({
        data: {
          ticketId: ticket.id,
          operatorId: actor.id,
          operatorName: actor.name,
          action: "edit",
          remark: `补偿金: ${ticket.refundDetail.compensationAmount ?? "（空）"}→${input.compensationAmount ?? "（空）"}`,
          at: now,
        },
      });
    }
    return {
      id: ticket.id,
      workOrderNumber: ticket.workOrderNumber,
      compensationAmount: input.compensationAmount,
    };
  });
}
