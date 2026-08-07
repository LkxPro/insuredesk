import { TICKET_FIELD_DESCRIPTORS } from "./ticket-fields";

/** 可按外部账号单独授权的敏感业务字段。 */
export const ACCOUNT_AUTHORIZABLE_SENSITIVE_TICKET_FIELDS: readonly string[] = [
  "customerName",
  "policyNumbers",
  "phone",
] as const;

/**
 * 无论管理员如何配置都不能出现在外部端的内部字段。客户姓名、保单号和投保人
 * 电话不在这里：它们是敏感但可按外部账号授权的业务字段。
 */
export const EXTERNAL_RESTRICTED_TICKET_FIELDS: readonly string[] = [
  "contactPhone",
  "internalOrderNumber",
  "contactId",
] as const;

/** 不属于建单描述表、但可以配置到外部表面的系统字段。 */
const EXTERNAL_SYSTEM_FIELDS: readonly string[] = [
  "workOrderNumber",
  "submissionText",
  "status",
  "processingResult",
  "completionStatusId",
] as const;

/**
 * 外部账号可配置的字段候选清单 = 全部建单字段 - 永久禁止字段 - 导入专属字段。
 * 管理员在外部账号编辑弹窗的"可见字段"多选框中看到这个清单。
 */
export const EXTERNAL_VISIBLE_FIELD_OPTIONS: readonly string[] = [
  ...EXTERNAL_SYSTEM_FIELDS,
  ...TICKET_FIELD_DESCRIPTORS.filter(
    (descriptor) =>
      !("importOnly" in descriptor && descriptor.importOnly === true) &&
      !EXTERNAL_RESTRICTED_TICKET_FIELDS.includes(descriptor.key),
  ).map((descriptor) => descriptor.key),
].filter((field, index, fields) => fields.indexOf(field) === index);

/**
 * 外部账号未配置 visibleTicketFields（null）时使用的系统默认白名单。
 * 这些字段对外部方安全且有用：工单号、状态、完结信息。
 * 注意：这些字段包含系统生成字段（workOrderNumber/status/processingResult），
 * 不在 TICKET_FIELD_DESCRIPTORS 中，但是工单对象的有效字段。
 */
export const DEFAULT_EXTERNAL_DETAIL_FIELDS: readonly string[] = [
  "workOrderNumber",
  "feedbackTime",
  "status",
  "completionStatusId",
  "processingResult",
] as const;

export const DEFAULT_EXTERNAL_LIST_FIELDS: readonly string[] = [
  "feedbackTime",
  "policyNumbers",
  "customerName",
  "status",
  "processingResult",
  "completionStatusId",
] as const;

/** 旧名称保留为详情／搜索／导出默认值，避免一次升级打断旧调用方。 */
export const DEFAULT_EXTERNAL_VISIBLE_FIELDS = DEFAULT_EXTERNAL_DETAIL_FIELDS;

/**
 * visibleTicketFields 列的唯一解析处：数据库存 JSON 字符串；null、非数组或
 * 损坏值都归一为 null（= 系统默认白名单）。管理端展示与外部查询共用，
 * 坏值永不抛——它意味着库被改坏，默认清单比报错可修。
 */
export function parseVisibleTicketFields(raw: string | null): string[] | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 解析一个外部字段表面的有序配置。空配置回退该表面的系统默认；损坏、未知和
 * 永久禁止字段在服务端丢弃，重复项保留首次出现的位置。
 */
export function resolveExternalVisibleFields(
  raw: string | null,
  defaultFields: readonly string[],
): string[] {
  const configured = parseVisibleTicketFields(raw);
  const source = configured && configured.length > 0 ? configured : defaultFields;
  const allowed = new Set(EXTERNAL_VISIBLE_FIELD_OPTIONS);
  return source.filter((field, index) => allowed.has(field) && source.indexOf(field) === index);
}

/**
 * 将外部用户保存的个人字段顺序与管理员当前授权字段合并。
 *
 * 已撤销授权的字段会被移除，新授权字段按管理员顺序追加；没有个人配置时，
 * 直接使用管理员（或系统默认）顺序。
 */
export function resolveExternalFieldOrder(
  raw: string | null,
  allowedFields: readonly string[],
): string[] {
  const configured = parseVisibleTicketFields(raw);
  if (!configured?.length) {
    return [...allowedFields];
  }

  const allowed = new Set(allowedFields);
  const retained = configured.filter(
    (field, index) => allowed.has(field) && configured.indexOf(field) === index,
  );
  const retainedSet = new Set(retained);

  return [...retained, ...allowedFields.filter((field) => !retainedSet.has(field))];
}

/**
 * Technical fields that must always survive filtering for API functionality: id for
 * matching/linking, timestamps for sorting/pagination, and source/creatorId for logic.
 */
const SYSTEM_FIELDS: readonly string[] = [
  "id",
  "createdAt",
  "updatedAt",
  "source",
  "creatorId",
] as const;

/**
 * 按白名单裁剪工单对象：白名单外字段设为 null/[]/undefined，白名单内字段保留
 * 原值。返回新对象，不修改输入。
 *
 * 永久禁止字段即使在白名单内也强制过滤（防御配置错误）。
 * 技术字段（id/createdAt 等）始终保留，确保 API 响应可用。
 *
 * 保留原始 undefined：白名单外或永久禁止字段，若原值为 undefined 则保持 undefined，
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
    const isSystemField = SYSTEM_FIELDS.includes(key);
    const isInWhitelist = whitelistSet.has(key);
    const isRestricted = EXTERNAL_RESTRICTED_TICKET_FIELDS.includes(key);

    const shouldFilter = isRestricted || (!isSystemField && !isInWhitelist);

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
