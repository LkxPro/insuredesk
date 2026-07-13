import { PRIORITY_LABELS, type Priority, type TicketEditData } from "@insuredesk/shared";
import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import { applyTicketDataScope } from "./data-scope.service";
import { TicketNotFoundError } from "./ticket-assign.service";
import { type TicketServiceDeps, computeSlaStamp } from "./ticket.service";

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

/** Timeline labels for the edit remark, matching the form wording. */
const FIELD_LABELS: Record<EditableFieldKey, string> = {
  feedbackTime: "反馈时间",
  channel: "反馈渠道",
  project: "项目（保司）",
  brokerageEntity: "经纪主体",
  paymentChannel: "支付渠道",
  internalOrderNumber: "内部订单号",
  policyNumber: "保单号",
  userComplaintChannel: "用户投诉渠道",
  customerName: "客户姓名",
  phone: "客户电话",
  contactPhone: "联系人电话",
  customerRequest: "客户诉求",
  nuclearBodyStatus: "保司侧是否核身",
  hasContacted: "客户曾进线",
  contactId: "进线ID",
  category: "客诉类别",
  complaintLevel: "投诉等级",
  priority: "优先级",
};

const EDITABLE_FIELD_KEYS = Object.keys(FIELD_LABELS) as EditableFieldKey[];

/**
 * One remark-side value. Priorities render their Chinese labels (the stored
 * codes are English); feedbackTime renders the unambiguous ISO instant — the
 * remark is a permanent audit string, so no viewer-local formatting here.
 */
function formatValue(key: EditableFieldKey, value: string | boolean | Date | null): string {
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

function sameValue(before: string | boolean | Date | null, after: string | boolean | Date | null) {
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
) {
  const now = clock.now();
  const { ticketId, ...fields } = input;
  // The wire carries feedbackTime as an ISO string (or null = 未填写);
  // everything downstream (diff, remark, update) works on the parsed instant.
  const next: Omit<EditableFields, "feedbackTime"> & { feedbackTime: Date | null } = {
    ...fields,
    feedbackTime: fields.feedbackTime === null ? null : new Date(fields.feedbackTime),
  };

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: ticketId, deletedAt: null, ...applyTicketDataScope(actor) },
    });
    if (!ticket) {
      throw new TicketNotFoundError();
    }

    const changedFields = EDITABLE_FIELD_KEYS.filter((key) => !sameValue(ticket[key], next[key]));
    if (changedFields.length === 0) {
      // Nothing changed → no update, no log: a remark with no field diffs
      // would violate its own contract (remark 记录改动的字段)
      return { id: ticket.id, workOrderNumber: ticket.workOrderNumber, changedFields };
    }

    // 改 complaintLevel = 改 SLA: everything the level stamped at creation
    // re-derives from the new level's policy, off the unchanged createdAt —
    // the SLA clock stays anchored to the ORIGINAL 录入时刻 even when the
    // level is only supplied by a later edit. Clearing the level
    // clears all three stamps (未定级 = no SLA clock).
    let slaFields: Prisma.TicketUpdateInput = {};
    if (changedFields.includes("complaintLevel")) {
      slaFields = await computeSlaStamp(tx, next.complaintLevel, ticket.createdAt);
    }

    await tx.ticket.update({
      where: { id: ticket.id },
      data: { ...next, ...slaFields },
    });

    // 多字段改动记在 remark 里，from/to 留空
    await tx.processLog.create({
      data: {
        ticketId: ticket.id,
        operatorId: actor.id,
        operatorName: actor.name,
        action: "edit",
        remark: changedFields
          .map(
            (key) =>
              `${FIELD_LABELS[key]}: ${formatValue(key, ticket[key])}→${formatValue(key, next[key])}`,
          )
          .join("；"),
        at: now,
      },
    });

    return { id: ticket.id, workOrderNumber: ticket.workOrderNumber, changedFields };
  });
}
