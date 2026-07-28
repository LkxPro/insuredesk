import { TICKET_FIELD_DESCRIPTORS } from "./ticket-fields";

/**
 * 明确禁止外部可见的敏感字段。管理员配置外部机构可见字段白名单时，这些字段
 * 被排除在候选清单外；即使某个机构的 visibleTicketFields 包含这些 key，
 * 字段裁剪函数也会强制过滤。
 */
export const SENSITIVE_TICKET_FIELDS: readonly string[] = [
  "phone",
  "contactPhone",
  "policyNumbers",
  "internalOrderNumber",
  "customerName",
  "contactId",
] as const;

/**
 * 外部机构可配置的字段候选清单 = 全部建单字段 - 敏感字段 - 导入专属字段。
 * 管理员在外部机构编辑弹窗的"可见字段"多选框中看到这个清单。
 */
export const EXTERNAL_VISIBLE_FIELD_OPTIONS: readonly string[] = TICKET_FIELD_DESCRIPTORS.filter(
  (descriptor) =>
    !("importOnly" in descriptor && descriptor.importOnly === true) &&
    !SENSITIVE_TICKET_FIELDS.includes(descriptor.key),
).map((descriptor) => descriptor.key);

/**
 * 外部机构未配置 visibleTicketFields（null）时使用的系统默认白名单。
 * 这些字段对外部方安全且有用：工单号、状态、完结信息。
 * 注意：这些字段包含系统生成字段（workOrderNumber/status/processingResult），
 * 不在 TICKET_FIELD_DESCRIPTORS 中，但是工单对象的有效字段。
 */
export const DEFAULT_EXTERNAL_VISIBLE_FIELDS: readonly string[] = [
  "workOrderNumber",
  "feedbackTime",
  "status",
  "completionStatusId",
  "processingResult",
] as const;

/**
 * System fields that must always survive filtering for API functionality:
 * id for matching/linking, timestamps for sorting/pagination, status for display,
 * source/externalOrgId/creatorId for internal logic.
 */
const SYSTEM_FIELDS = [
  "id",
  "createdAt",
  "updatedAt",
  "status",
  "source",
  "externalOrgId",
  "creatorId",
  "submissionText",
] as const;

/**
 * 按白名单裁剪工单对象：白名单外字段设为 null/[]/undefined，白名单内字段保留
 * 原值。返回新对象，不修改输入。
 *
 * 敏感字段即使在白名单内也强制过滤（防御配置错误）。
 * 系统字段（id/createdAt/status 等）始终保留，确保 API 响应可用。
 *
 * 保留原始 undefined：白名单外或敏感字段，若原值为 undefined 则保持 undefined，
 * 不强制为 null，以便客户端区分"字段存在但被过滤"与"字段从未存在"。
 *
 * @param ticket - 原始工单对象
 * @param whitelist - 可见字段 key 数组
 * @returns 裁剪后的工单对象
 */
export function filterVisibleFields<T extends Record<string, unknown>>(
  ticket: T,
  whitelist: readonly string[],
): T {
  const whitelistSet = new Set(whitelist);
  const result = { ...ticket } as Record<string, unknown>;

  for (const key of Object.keys(result)) {
    const isSystemField = SYSTEM_FIELDS.includes(key as any);
    const isInWhitelist = whitelistSet.has(key);
    const isSensitive = SENSITIVE_TICKET_FIELDS.includes(key);

    const shouldFilter = isSensitive || (!isSystemField && !isInWhitelist);

    if (shouldFilter) {
      const originalValue = result[key];
      // 保留 undefined，数组设为 []，其他设为 null
      if (originalValue === undefined) {
        result[key] = undefined;
      } else if (Array.isArray(originalValue)) {
        result[key] = [];
      } else {
        result[key] = null;
      }
    }
  }

  return result as T;
}
