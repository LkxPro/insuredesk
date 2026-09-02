import { z } from "zod";

/** api_keys.status 的取值清单（库内为纯文本列，枚举在这里执法）。 */
export const API_KEY_STATUSES = ["active", "revoked"] as const;
export const apiKeyStatusSchema = z.enum(API_KEY_STATUSES);
export type ApiKeyStatus = z.infer<typeof apiKeyStatusSchema>;

export const apiKeyCreateInputSchema = z.object({
  name: z.string().trim().min(1, "名称不能为空").max(100, "名称最长 100 字符"),
  expiresAt: z
    .string()
    .datetime({ offset: true, message: "过期时间格式不正确" })
    .nullable()
    .refine((value) => value === null || new Date(value) > new Date(), {
      message: "过期时间必须晚于当前时间",
    }),
});
export type ApiKeyCreateInput = z.input<typeof apiKeyCreateInputSchema>;
export type ApiKeyCreateData = z.output<typeof apiKeyCreateInputSchema>;

export const apiKeyRevokeInputSchema = z.object({
  id: z.string().min(1),
});
export type ApiKeyRevokeInput = z.infer<typeof apiKeyRevokeInputSchema>;

export const apiKeyRevokeAllInputSchema = z.object({
  userId: z.string().min(1),
});
export type ApiKeyRevokeAllInput = z.infer<typeof apiKeyRevokeAllInputSchema>;

export const apiKeyListInputSchema = z.object({
  includeRevoked: z.boolean().default(false),
});
export type ApiKeyListInput = z.input<typeof apiKeyListInputSchema>;

/** expired 不进库（库内只有 active/revoked）：读时由 expiresAt 已过派生。 */
export const API_KEY_LIST_STATUSES = [...API_KEY_STATUSES, "expired"] as const;

/** 管理面列表行：永不含 keyHash，更不含明文；keyPreview 为明文后 8 位。 */
export const apiKeyListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(API_KEY_LIST_STATUSES),
  keyPreview: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiKeyListItem = z.infer<typeof apiKeyListItemSchema>;

/** 创建响应：明文 key 只在这一处出现一次，此后任何接口不再返回。 */
export const apiKeyCreatedSchema = apiKeyListItemSchema.extend({
  key: z.string(),
});
export type ApiKeyCreated = z.infer<typeof apiKeyCreatedSchema>;
