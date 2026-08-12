import { z } from "zod";
import { TICKET_FIELDS } from "./ticket-fields";
import {
  displayNameSchema,
  optionalEmailSchema,
  optionalPasswordResetSchema,
  passwordSchema,
  usernameSchema,
} from "./user";

/**
 * 外部账号 contracts — 「外部账号管理」页与 API 共用一份 schema，全部由
 * external_account.manage 单点执法。账号不选角色：唯一外部角色由服务端挂载。
 *
 * 预填域 = 6 身份类字段，全部选填（空 = 客服后补）：提交时服务端静默快照进
 * 工单字段，对提交输入隐形。文本上限抄对应工单字段。
 */

/** 预填文本字段：trim、上限抄工单字段、空串归一为 null（= 未配置）。 */
function prefillTextField(
  key:
    | "project"
    | "brokerageEntity"
    | "paymentChannel"
    | "userComplaintChannel"
    | "complaintReceiveChannel",
) {
  const descriptor = TICKET_FIELDS[key];
  return z
    .string()
    .trim()
    .max(descriptor.maxLength, `${descriptor.label}最长 ${descriptor.maxLength} 字符`)
    .nullish()
    .transform((value) => (value ? value : null));
}

export const externalAccountPrefillSchema = z.object({
  /** 反馈渠道引用；停用渠道保持引用且照常盖章。 */
  channelId: z
    .string()
    .nullish()
    .transform((value) => (value ? value : null)),
  project: prefillTextField("project"),
  brokerageEntity: prefillTextField("brokerageEntity"),
  paymentChannel: prefillTextField("paymentChannel"),
  userComplaintChannel: prefillTextField("userComplaintChannel"),
  complaintReceiveChannel: prefillTextField("complaintReceiveChannel"),
});
export type ExternalAccountPrefillInput = z.input<typeof externalAccountPrefillSchema>;
export type ExternalAccountPrefill = z.output<typeof externalAccountPrefillSchema>;

export const externalAccountCreateInputSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  name: displayNameSchema,
  email: optionalEmailSchema,
  prefill: externalAccountPrefillSchema.optional(),
});
export type ExternalAccountCreateInput = z.input<typeof externalAccountCreateInputSchema>;
export type ExternalAccountCreateData = z.output<typeof externalAccountCreateInputSchema>;

/**
 * 编辑外部账号：基本信息 + 预填 + 可选改密。
 * prefill 缺省 = 不动；给出即整块替换（表单每次提交全量）。
 */
export const externalAccountUpdateInputSchema = z.object({
  id: z.string().min(1),
  username: usernameSchema,
  name: displayNameSchema,
  email: optionalEmailSchema,
  password: optionalPasswordResetSchema,
  prefill: externalAccountPrefillSchema.optional(),
});
export type ExternalAccountUpdateInput = z.input<typeof externalAccountUpdateInputSchema>;
export type ExternalAccountUpdateData = z.output<typeof externalAccountUpdateInputSchema>;

/** 禁用/启用。禁用即踢会话。 */
export const externalAccountSetActiveInputSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type ExternalAccountSetActiveInput = z.infer<typeof externalAccountSetActiveInputSchema>;

/** 列表行即编辑弹窗的全部数据，无独立详情接口。 */
export interface ExternalAccountListItem {
  id: string;
  username: string;
  name: string;
  email: string | null;
  active: boolean;
  createdAt: string;
  prefill: ExternalAccountPrefill & { channelName: string | null };
  /** 该账号提交的工单数（含软删）。 */
  ticketCount: number;
}
