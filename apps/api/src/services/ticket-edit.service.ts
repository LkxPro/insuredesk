import {
  applyNoPolicyNumber,
  joinPolicyNumbers,
  PRIORITY_LABELS,
  type Priority,
  TICKET_CREATE_FIELD_KEYS,
  type TicketCreateFieldKey,
  type TicketEditData,
  ticketProcessLogLabel,
} from "@insuredesk/shared";
import type { Prisma } from "../generated/prisma/client.ts";
import type { AuthenticatedUser } from "./auth.service.ts";
import { channelCatalog } from "./channel.service.ts";
import { applyTicketDataScope } from "./data-scope.service.ts";
import { computeSlaStamp, type TicketServiceDeps, toDateOrNull } from "./ticket.service.ts";
import { TicketNotFoundError } from "./ticket-assign.service.ts";
import { ticketCategoryCatalog } from "./ticket-category.service.ts";
import { assertNoDuplicateTickets } from "./ticket-duplicate.service.ts";

/**
 * Edit domain logic: every basic-info field editable in any status, 已完结
 * included. Pure service layer — the router maps the domain errors to
 * transport codes.
 *
 * Invariants enforced here:
 * - status is untouchable by construction: the input schema has no status
 *   field and this update never writes one, so editing can never reopen a
 *   completed ticket
 * - 改 complaintLevel = 改 SLA: dueAt re-runs the creation formula (createdAt +
 *   the NEW level's overdueHours — computeDueAt, off the fixed createdAt base), and
 *   跟进频次/首响要求 re-stamp from the new level's policy. This may flip the
 *   ticket straight into overdue (e.g. 特急→一般 past 48h) — intended, and the
 *   read-time display/list predicates pick it up with no further writes
 * - 提醒只对未来生效: nothing to do here BY DESIGN — 轨 2 reminders are
 *   computed at read time from the current level's rules, so
 *   already-passed checkpoints of the new level simply never fire; there is no
 *   stored reminder to skip or back-fill
 * - priority is a free label: editing it drives no SLA field whatsoever
 * - 留痕: one `edit` ProcessLog per effective edit, remark = the changed
 *   fields with before→after values, from/to empty; an edit that
 *   changes nothing writes nothing
 */

/** The editable basic-info fields, minus the ticketId routing key. */
type EditableFields = Omit<TicketEditData, "ticketId">;
type EditableFieldKey = keyof EditableFields;

/**
 * 编辑字段集＝建单字段集，留痕段落按此（＝表单）顺序。条件类型注解把
 * 「编辑 schema 长出描述表外的字段」变成编译错误——那种字段进不了清单，
 * diff 与留痕会静默漏掉它。唯一豁免 noPolicyNumber: 变化折进保单号一行留痕。
 */
const EDITABLE_FIELD_KEYS: [
  Exclude<EditableFieldKey, TicketCreateFieldKey | "noPolicyNumber">,
] extends [never]
  ? readonly TicketCreateFieldKey[]
  : never = TICKET_CREATE_FIELD_KEYS;

type EditableValue = string | string[] | boolean | Date | null;

/**
 * One remark-side value. Priorities render their Chinese labels (the stored
 * codes are English); datetimes render the unambiguous ISO instant — the
 * remark is a permanent audit string, so no viewer-local formatting here.
 * 多值保单号按展示口径空格 join；空数组即未填写。
 */
function formatValue(key: EditableFieldKey, value: EditableValue): string {
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

/**
 * Edit one ticket's basic info. Guarded upstream by ticket.edit; the lookup
 * carries the viewer data scope, so an editor without ticket.view_all stays
 * on their own tickets — anything else surfaces as not-found (no existence
 * leak). Returns the fields that actually changed.
 */
export async function editTicket(
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

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, deletedAt: null, ...applyTicketDataScope(actor) },
      // The catalog name snapshots for the remark: the values as they read
      // NOW, before this edit — the log keeps the literal wording of the moment
      include: { category: { select: { name: true } }, channel: { select: { name: true } } },
    });
    if (!ticket) {
      throw new TicketNotFoundError();
    }

    // 数组两侧都是 [] 时靠 flag 识别 无↔留空 的变化
    const noneToggled = ticket.noPolicyNumber !== next.noPolicyNumber;
    const changedFields = EDITABLE_FIELD_KEYS.filter(
      (key) => !sameValue(ticket[key], next[key]) || (key === "policyNumbers" && noneToggled),
    );
    if (changedFields.length === 0) {
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
    const catalogNames: Partial<Record<EditableFieldKey, Record<"from" | "to", string | null>>> = {
      categoryId: {
        from: ticket.category?.name ?? null,
        to: changedFields.includes("categoryId")
          ? ((await ticketCategoryCatalog.resolveNewRef(tx, next.categoryId))?.name ?? null)
          : null,
      },
      channelId: {
        from: ticket.channel?.name ?? null,
        to: changedFields.includes("channelId")
          ? ((await channelCatalog.resolveNewRef(tx, next.channelId))?.name ?? null)
          : null,
      },
    };

    // 改 complaintLevel = 改 SLA: everything the level stamped at creation
    // re-derives from the new level's policy, off the unchanged createdAt —
    // the SLA clock stays anchored to the ORIGINAL 录入时刻 even when the
    // level is only supplied by a later edit. Clearing the level
    // clears all three stamps (未定级 = no SLA clock).
    let slaFields: Prisma.TicketUncheckedUpdateInput = {};
    if (changedFields.includes("complaintLevel")) {
      slaFields = await computeSlaStamp(tx, next.complaintLevel, ticket.createdAt);
    }

    await tx.ticket.update({
      where: { id: ticket.id },
      data: { ...next, ...slaFields },
    });

    // 多字段改动记在 remark 里，from/to 留空。目录引用按当时名称留痕（快照），
    // 不随后续改名回写。
    const sideValue = (key: EditableFieldKey, side: "from" | "to") => {
      const catalog = catalogNames[key];
      if (catalog) {
        return catalog[side];
      }
      return side === "from" ? ticket[key] : next[key];
    };
    // 留痕里「无」与（空）= 未填写是两种状态
    const formatSide = (key: EditableFieldKey, side: "from" | "to") => {
      if (
        key === "policyNumbers" &&
        (side === "from" ? ticket.noPolicyNumber : next.noPolicyNumber)
      ) {
        return "无";
      }
      return formatValue(key, sideValue(key, side));
    };
    await tx.processLog.create({
      data: {
        ticketId: ticket.id,
        operatorId: actor.id,
        operatorName: actor.name,
        action: "edit",
        remark: changedFields
          .map(
            (key) =>
              `${ticketProcessLogLabel(key)}: ${formatSide(key, "from")}→${formatSide(key, "to")}`,
          )
          .join("；"),
        at: now,
      },
    });

    return { id: ticket.id, workOrderNumber: ticket.workOrderNumber, changedFields };
  });
}
