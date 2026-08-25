import { z } from "zod";
import type { TicketCreateFieldKey } from "./ticket-fields.ts";

export const REFUND_PUSH_PLATFORM = "jb-insurance";

/** 合同错误码三分：0000 成功（含幂等重复）/ 9998 参数类勿重试 / 9999 系统类可重试。 */
export const REFUND_PUSH_CODES = {
  Success: "0000",
  Invalid: "9998",
  SystemError: "9999",
} as const;
export type RefundPushCode = (typeof REFUND_PUSH_CODES)[keyof typeof REFUND_PUSH_CODES];

export interface WorkOrderPushEnvelope {
  success: boolean;
  code: RefundPushCode;
  message: string;
  data: { workOrderNumber: string } | null;
}

/** 平台金额口径：非负、最多两位小数的字符串；推送校验与补偿金编辑共用。 */
export const REFUND_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const REFUND_CREATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** 报错消息只点名字段、不回显值（PII）。 */
function requiredText(field: string) {
  return z
    .string({
      error: (issue) => (issue.input === undefined ? `${field} 不能为空` : `${field} 必须是字符串`),
    })
    .trim()
    .min(1, `${field} 不能为空`);
}

function requiredAmount(field: string) {
  return z
    .string({
      error: (issue) => (issue.input === undefined ? `${field} 不能为空` : `${field} 必须是字符串`),
    })
    .regex(REFUND_AMOUNT_PATTERN, `${field} 格式不正确`);
}

function optionalText(field: string) {
  return z
    .string({ error: () => `${field} 必须是字符串` })
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined));
}

export const refundTradePushSchema = z.object({
  tradeNo: requiredText("refundTrade.tradeNo"),
  payNo: requiredText("refundTrade.payNo"),
  expectedAmount: requiredAmount("refundTrade.expectedAmount"),
});
export type RefundTradePush = z.infer<typeof refundTradePushSchema>;

export const workOrderPushSchema = z.object(
  {
    sysOrderId: requiredText("sysOrderId"),
    endorNo: requiredText("endorNo"),
    workOrderType: requiredText("workOrderType"),
    expectedAmount: requiredAmount("expectedAmount"),
    refundCreateTime: requiredText("refundCreateTime").regex(
      REFUND_CREATE_TIME_PATTERN,
      "refundCreateTime 格式不正确",
    ),
    refundTrade: z
      .array(refundTradePushSchema, { error: () => "refundTrade 必须是数组" })
      .min(1, "refundTrade 至少需要 1 条")
      .max(50, "refundTrade 最多 50 条"),
    holderName: optionalText("holderName"),
    holderPhone: optionalText("holderPhone"),
    companyName: optionalText("companyName"),
    productId: optionalText("productId"),
    productName: optionalText("productName"),
    policyNo: optionalText("policyNo"),
    failureReason: optionalText("failureReason"),
  },
  "请求体必须是 JSON 对象",
);
export type WorkOrderPushInput = z.infer<typeof workOrderPushSchema>;

export const WORK_ORDER_PUSH_REQUIRED_FIELDS = [
  "sysOrderId",
  "endorNo",
  "workOrderType",
  "expectedAmount",
  "refundCreateTime",
  "refundTrade",
] as const;

export const WORK_ORDER_PUSH_OPTIONAL_FIELDS = [
  "holderName",
  "holderPhone",
  "companyName",
  "productId",
  "productName",
  "policyNo",
  "failureReason",
] as const;

export function computePushedFields(input: WorkOrderPushInput): string[] {
  return [
    ...WORK_ORDER_PUSH_REQUIRED_FIELDS,
    ...WORK_ORDER_PUSH_OPTIONAL_FIELDS.filter((field) => input[field] !== undefined),
  ];
}

export const REFUND_PUSHED_TICKET_FIELDS: Readonly<Record<string, TicketCreateFieldKey>> = {
  sysOrderId: "internalOrderNumber",
  holderName: "customerName",
  holderPhone: "phone",
  policyNo: "policyNumbers",
};
