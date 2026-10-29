import { z } from "zod";

export const HUIFU_SOURCE = "huifu";
export const HUIFU_WEBHOOK_PATH = "/api/integrations/huifu/webhook";

const id = z.string().trim().min(1).max(128);
const text = z.string().max(10_000).optional();
const amount = z.union([z.string().max(100), z.number().finite()]).optional();

const shanghaiTime = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(`${value.replace(" ", "T")}+08:00`);
  return (
    Number.isFinite(date.getTime()) &&
    new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 19).replace("T", " ") === value
  );
}, "汇付时间必须是有效的上海时间 YYYY-MM-DD HH:mm:ss");

export const huifuWebhookEventSchema = z.discriminatedUnion("event_define_no", [
  z.object({
    namespace: z.literal("opps-webhook"),
    event_define_no: z.literal("wechat.complaint"),
    complaint_id: id,
    mer_id: id,
    complaint_datetime: shanghaiTime,
    wechat_order_no: text,
    mer_name: text,
    trade_amount: amount,
  }),
  z.object({
    namespace: z.literal("opps-webhook"),
    event_define_no: z.literal("hotline.complaint"),
    ticketId: id,
    merchantNo: id,
    complaintTime: shanghaiTime,
    operationTime: shanghaiTime.optional(),
    event: z.string().max(40).optional(),
    content: text,
    remark: text,
    userName: z.string().max(100).optional(),
    userPhoneNumber: z.string().max(200).optional(),
    merchantName: text,
    transactionNo: text,
    externalTransactionNo: text,
    transactionAmount: amount,
    attachmentList: text,
    priority: text,
    complaintSource: text,
    category: text,
    transactionDate: text,
    autoRefundFlag: text,
    refundResult: text,
    failReason: text,
  }),
]);

export type HuifuWebhookEvent = z.infer<typeof huifuWebhookEventSchema>;
