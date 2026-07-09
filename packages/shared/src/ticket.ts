import { z } from "zod";
import {
  channelSchema,
  complaintLevelSchema,
  nuclearBodyStatusSchema,
  prioritySchema,
  ticketCategorySchema,
} from "./enums";

/**
 * Manual ticket-creation contract (PRD §3.1), shared by the web form
 * (react-hook-form resolver) and the API mutation input — one schema, both
 * ends (ADR 0006). System-derived fields (workOrderNumber, source, creatorId,
 * dueAt, followUpFrequency, firstResponseRequirement, status…) are stamped
 * server-side and deliberately absent here.
 */

/** Optional free-text field: empty/whitespace form input becomes NULL, not "". */
const optionalText = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((value) => (value ? value : null));

export const ticketCreateInputSchema = z.object({
  /** 客户实际反馈时间；ISO-8601 绝对时刻（客户端已按本地时区换算）。 */
  feedbackTime: z.string().datetime({ offset: true, message: "请填写反馈时间" }),
  channel: channelSchema,
  project: z.string().trim().min(1, "请填写项目").max(100),
  brokerageEntity: z.string().trim().min(1, "请填写经纪主体").max(100),
  paymentChannel: z.string().trim().min(1, "请填写支付渠道").max(100),
  internalOrderNumber: optionalText,
  policyNumber: z.string().trim().min(1, "请填写保单号").max(100),
  userComplaintChannel: z.string().trim().min(1, "请填写用户投诉渠道").max(100),
  customerName: z.string().trim().min(1, "请填写客户姓名").max(100),
  phone: z.string().trim().min(1, "请填写客户电话").max(50),
  contactPhone: optionalText,
  customerRequest: z.string().trim().min(1, "请填写客户诉求").max(2000),
  nuclearBodyStatus: nuclearBodyStatusSchema,
  hasContacted: z.boolean(),
  contactId: optionalText,
  category: ticketCategorySchema,
  complaintLevel: complaintLevelSchema,
  /** 独立自由标签，默认空（PRD §3.1.5）；"" 来自未选择的下拉框。 */
  priority: prioritySchema
    .or(z.literal(""))
    .nullish()
    .transform((value) => (value ? value : null)),
});

/** Form-side shape (before transforms) — what react-hook-form holds. */
export type TicketCreateInput = z.input<typeof ticketCreateInputSchema>;
/** Server-side shape (after transforms) — what the service receives. */
export type TicketCreateData = z.output<typeof ticketCreateInputSchema>;
