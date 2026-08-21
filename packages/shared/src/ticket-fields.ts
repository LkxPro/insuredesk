import { NUCLEAR_BODY_STATUSES, PRIORITIES, PRIORITY_LABELS } from "./enums.ts";

/**
 * exportHeader：导出列头是对外契约（下游可能按列头取数），保持现状；与标准名
 * 统一需另立 ticket 并通知使用方。
 */

export interface TicketFieldOverrides {
  readonly exportHeader?: string;
  readonly processLogLabel?: string;
  readonly detailLabel?: string;
  readonly listLabel?: string;
}

export interface TicketEnumOption {
  readonly label: string;
  /** 落库取值；核身存中文字面量本身，优先级存英文码，曾进线存布尔。 */
  readonly value: string | boolean;
}

export type TicketCatalogKind =
  | "channel"
  | "category"
  | "completionStatus"
  | "slaPolicy"
  | "userComplaintChannel"
  | "complaintReceiveChannel";

const CATALOG_NOUNS: Record<TicketCatalogKind, string> = {
  channel: "渠道",
  category: "类别",
  completionStatus: "完结状态",
  slaPolicy: "时效策略",
  userComplaintChannel: "用户投诉渠道",
  complaintReceiveChannel: "投诉信息接收渠道",
};

type TicketFieldSpec = {
  readonly key: string;
  readonly label: string;
  readonly overrides?: TicketFieldOverrides;
  readonly importOnly?: true;
} & (
  | {
      readonly type: "text";
      readonly maxLength: number;
      readonly importNoteSuffix?: string;
    }
  | {
      /** 多值自由文本；各表面以空格分隔字符串形态承载数组值。 */
      readonly type: "textList";
      readonly maxItemLength: number;
      readonly maxItems: number;
    }
  | { readonly type: "date" }
  | {
      readonly type: "enum";
      readonly options: readonly TicketEnumOption[];
      readonly emptyMeaning: string;
    }
  | {
      readonly type: "catalog";
      readonly catalog: TicketCatalogKind;
      readonly maxLength: number;
      readonly importNoteTail?: string;
    }
);

/** 行序＝表单呈现顺序；导入列序＝表序，完结迁移对固定收尾。 */
export const TICKET_FIELD_DESCRIPTORS = [
  { type: "date", key: "feedbackTime", label: "反馈时间" },
  {
    type: "catalog",
    key: "channelId",
    label: "反馈渠道",
    catalog: "channel",
    maxLength: 100,
    overrides: { exportHeader: "渠道", listLabel: "渠道" },
  },
  {
    type: "text",
    key: "project",
    label: "项目（保司）",
    maxLength: 100,
    importNoteSuffix: "如：融盛、泰康（填写简称即可）",
    overrides: { exportHeader: "项目" },
  },
  {
    type: "text",
    key: "brokerageEntity",
    label: "经纪主体",
    maxLength: 100,
    importNoteSuffix: "如：凯森、东方大地（填写简称即可）",
  },
  {
    type: "text",
    key: "paymentChannel",
    label: "支付渠道",
    maxLength: 100,
    importNoteSuffix: "如：连连、银商、易宝、京东",
  },
  { type: "text", key: "internalOrderNumber", label: "内部订单号", maxLength: 200 },
  { type: "textList", key: "policyNumbers", label: "保单号", maxItemLength: 100, maxItems: 50 },
  {
    type: "catalog",
    key: "userComplaintChannelId",
    label: "用户投诉渠道",
    catalog: "userComplaintChannel",
    maxLength: 100,
  },
  {
    type: "catalog",
    key: "complaintReceiveChannelId",
    label: "投诉信息接收渠道",
    catalog: "complaintReceiveChannel",
    maxLength: 100,
  },
  { type: "text", key: "customerName", label: "客户姓名", maxLength: 100 },
  {
    type: "text",
    key: "phone",
    label: "客户电话（投保人）",
    maxLength: 50,
    overrides: { exportHeader: "客户电话", processLogLabel: "客户电话" },
  },
  {
    type: "text",
    key: "contactPhone",
    label: "联系人电话",
    maxLength: 200,
    overrides: { exportHeader: "联系电话", detailLabel: "联系人电话（备用）" },
  },
  {
    type: "enum",
    key: "nuclearBodyStatus",
    label: "保司侧是否核身",
    options: NUCLEAR_BODY_STATUSES.map((status) => ({ label: status, value: status })),
    emptyMeaning: "未填写",
    overrides: { exportHeader: "核体状态" },
  },
  { type: "text", key: "customerRequest", label: "客户诉求", maxLength: 2000 },
  {
    type: "enum",
    key: "hasContacted",
    label: "客户曾进线",
    options: [
      { label: "是", value: true },
      { label: "否", value: false },
    ],
    emptyMeaning: "未知",
    overrides: { exportHeader: "是否已联系" },
  },
  { type: "date", key: "contactTime", label: "进线时间" },
  {
    type: "text",
    key: "contactId",
    label: "进线ID",
    maxLength: 200,
    overrides: { exportHeader: "联系ID" },
  },
  {
    type: "catalog",
    key: "categoryId",
    label: "客诉类别",
    catalog: "category",
    maxLength: 100,
    overrides: { exportHeader: "分类", listLabel: "类别" },
  },
  {
    type: "catalog",
    key: "slaPolicyId",
    label: "时效策略",
    catalog: "slaPolicy",
    maxLength: 100,
    importNoteTail: "留空=未定级（无处理时限与 SLA 告警）",
  },
  {
    type: "enum",
    key: "priority",
    label: "优先级",
    options: PRIORITIES.map((priority) => ({ label: PRIORITY_LABELS[priority], value: priority })),
    emptyMeaning: "未设置",
  },
  {
    type: "catalog",
    key: "completionStatusId",
    label: "完结状态",
    catalog: "completionStatus",
    maxLength: 100,
    importOnly: true,
    importNoteTail: "须与「完结备注」同时填写或同时留空",
  },
  {
    type: "text",
    key: "completionRemark",
    label: "完结备注",
    maxLength: 2000,
    importOnly: true,
    importNoteSuffix: "须与「完结状态」同时填写或同时留空",
  },
] as const satisfies readonly TicketFieldSpec[];

export type TicketFieldDescriptor = (typeof TICKET_FIELD_DESCRIPTORS)[number];

export const TICKET_FIELDS = Object.fromEntries(
  TICKET_FIELD_DESCRIPTORS.map((descriptor) => [descriptor.key, descriptor]),
) as { [D in TicketFieldDescriptor as D["key"]]: D };

export type TicketFieldKey = TicketFieldDescriptor["key"];

type TicketCreateFieldDescriptor = Exclude<TicketFieldDescriptor, { importOnly: true }>;
export type TicketCreateFieldKey = TicketCreateFieldDescriptor["key"];

function isCreateField(
  descriptor: TicketFieldDescriptor,
): descriptor is TicketCreateFieldDescriptor {
  return !("importOnly" in descriptor && descriptor.importOnly === true);
}

/**
 * 建单表单字段清单——合法字段域，前后端共用。顺序与表单呈现一致；
 * 角色可配置必填集时，校验每个 key 属于此清单。
 */
export const TICKET_CREATE_FIELD_KEYS: readonly TicketCreateFieldKey[] =
  TICKET_FIELD_DESCRIPTORS.filter(isCreateField).map((descriptor) => descriptor.key);

type TicketCreateTextFieldDescriptor = Extract<TicketCreateFieldDescriptor, { type: "text" }>;

function isCreateTextField(
  descriptor: TicketFieldDescriptor,
): descriptor is TicketCreateTextFieldDescriptor {
  return descriptor.type === "text" && isCreateField(descriptor);
}

export const TICKET_TEXT_LIMITS = Object.fromEntries(
  TICKET_FIELD_DESCRIPTORS.filter(isCreateTextField).map((descriptor) => [
    descriptor.key,
    descriptor.maxLength,
  ]),
) as Record<TicketCreateTextFieldDescriptor["key"], number>;

export const TICKET_COMPLETION_REMARK_LIMIT = TICKET_FIELDS.completionRemark.maxLength;

export const TICKET_IMPORT_HEADERS: readonly string[] = TICKET_FIELD_DESCRIPTORS.map(
  (descriptor) => descriptor.label,
);

/**
 * 保单号的分隔字符串形态 ⇄ 数组形态。多值字段各表面（表单输入、详情/
 * 列表展示、导入单元格、导出单元格）统一走这一对函数；分隔符是任一非
 * 字母数字字符（空格/逗号/顿号/换行/中文标点…），取值本身只含字母数字，
 * join 出的文本总能无损 split 回同一数组。
 */

export function normalizePolicyNumbers(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (value) {
      seen.add(value);
    }
  }
  return [...seen];
}

export function splitPolicyNumbers(text: string): string[] {
  return normalizePolicyNumbers(text.split(/[^0-9A-Za-z]+/));
}

export function joinPolicyNumbers(values: readonly string[]): string {
  return values.join(" ");
}

export function applyNoPolicyNumber<T extends { noPolicyNumber: boolean; policyNumbers: string[] }>(
  data: T,
): T {
  return data.noPolicyNumber ? { ...data, policyNumbers: [] } : data;
}

export function policyNumbersError(values: readonly string[]): string | null {
  const { maxItemLength, maxItems } = TICKET_FIELDS.policyNumbers;
  const tooLong = values.find((value) => value.length > maxItemLength);
  if (tooLong !== undefined) {
    // 单元格里多个保单号，得让用户知道是哪个超长
    return `保单号「${tooLong}」超出最大长度 ${maxItemLength} 字（实际 ${tooLong.length} 字）`;
  }
  if (values.length > maxItems) {
    return `保单号超出数量上限 ${maxItems} 个（实际 ${values.length} 个）`;
  }
  return null;
}

function surfaceLabel(
  descriptor: { readonly label: string; readonly overrides?: TicketFieldOverrides },
  slot: keyof TicketFieldOverrides,
): string {
  return descriptor.overrides?.[slot] ?? descriptor.label;
}

/** 导出列头取词入口；消费方不得另维护 label 表。 */
export function ticketExportHeader(key: TicketFieldKey): string {
  return surfaceLabel(TICKET_FIELDS[key], "exportHeader");
}

/** 编辑留痕句中短名取词入口；消费方不得另维护 label 表。 */
export function ticketProcessLogLabel(key: TicketFieldKey): string {
  return surfaceLabel(TICKET_FIELDS[key], "processLogLabel");
}

export function ticketImportFieldNote(descriptor: TicketFieldDescriptor): string {
  switch (descriptor.type) {
    case "text": {
      const base = `文本，最长 ${descriptor.maxLength} 字`;
      const suffix = "importNoteSuffix" in descriptor ? descriptor.importNoteSuffix : undefined;
      return suffix ? `${base}；${suffix}` : base;
    }
    case "textList":
      return `文本，可填多个（空格/逗号/顿号等分隔，重复自动去重）；单个最长 ${descriptor.maxItemLength} 字，最多 ${descriptor.maxItems} 个`;
    case "date":
      return "格式 yyyy-MM-dd HH:mm（如 2026-07-09 14:30）；留空=未填写";
    case "enum": {
      const labels = descriptor.options.map((option) => option.label);
      return `从下拉选择：${labels.join(" / ")}；留空=${descriptor.emptyMeaning}`;
    }
    case "catalog": {
      const tail =
        ("importNoteTail" in descriptor ? descriptor.importNoteTail : undefined) ?? "留空=未填写";
      return `从下拉选择（下载模板时启用的${CATALOG_NOUNS[descriptor.catalog]}目录）；${tail}`;
    }
  }
}
