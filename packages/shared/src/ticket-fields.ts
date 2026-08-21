import { NUCLEAR_BODY_STATUSES, PRIORITIES, PRIORITY_LABELS } from "./enums.ts";

/**
 * 工单字段描述表：20 个建单字段 + 完结迁移对两个导入专属列的唯一声明处。
 * 每行声明
 * key、标准名（＝表单用词）、类型与取值约束（长度上限/枚举取值/日期格式/
 * 目录引用）、导入填写说明的素材，以及显式的 per-surface override 槽位。
 * 加字段＝在表里加一行：字段 key 清单、文本长度上限、导入解析列与导入
 * 模板列都从这里派生。
 *
 * override 槽位只登记与标准名不同的表面用词，缺省＝该表面直接用标准名：
 * - exportHeader：导出列头是对外契约（下游可能按列头取数），保持现状；
 *   与标准名统一需另立 ticket 并通知使用方
 * - processLogLabel：编辑留痕的句中短名（如「客户电话」）
 * - detailLabel：详情页展示名（解释后缀，如「联系人电话（备用）」）
 * - listLabel：列表页列头与筛选的短名（如「渠道」）
 */

export interface TicketFieldOverrides {
  readonly exportHeader?: string;
  readonly processLogLabel?: string;
  readonly detailLabel?: string;
  readonly listLabel?: string;
}

export interface TicketEnumOption {
  /** 表单/模板里的中文字面量。 */
  readonly label: string;
  /** 落库取值；核身存中文字面量本身，优先级存英文码，曾进线存布尔。 */
  readonly value: string | boolean;
}

export type TicketCatalogKind =
  | "channel"
  | "category"
  | "completionStatus"
  | "slaPolicy"
  | "userFeedbackChannel"
  | "feedbackReceiveChannel";

/** 填写说明里的目录名词（「下载模板时启用的◯◯目录」）。 */
const CATALOG_NOUNS: Record<TicketCatalogKind, string> = {
  channel: "渠道",
  category: "类别",
  completionStatus: "完结状态",
  slaPolicy: "时效策略",
  userFeedbackChannel: "用户反馈渠道",
  feedbackReceiveChannel: "反馈信息接收渠道",
};

/** 行的声明语法；`TicketFieldDescriptor` 是表里各行的精确类型。 */
type TicketFieldSpec = {
  readonly key: string;
  readonly label: string;
  readonly overrides?: TicketFieldOverrides;
  /** 仅存在于批量导入（完结迁移对），不属于建单表单字段。 */
  readonly importOnly?: true;
} & (
  | {
      readonly type: "text";
      readonly maxLength: number;
      /** 拼在「文本，最长 N 字」之后的填写说明补充（示例或跨列规则）。 */
      readonly importNoteSuffix?: string;
    }
  | {
      /** 多值自由文本；各表面以空格分隔字符串形态承载数组值。 */
      readonly type: "textList";
      /** 单个取值的长度上限。 */
      readonly maxItemLength: number;
      /** 单张工单的取值数量上限。 */
      readonly maxItems: number;
    }
  | { readonly type: "date" }
  | {
      readonly type: "enum";
      readonly options: readonly TicketEnumOption[];
      /** 填写说明「留空=」后的含义（未填写/未知/未定级…）。 */
      readonly emptyMeaning: string;
    }
  | {
      readonly type: "catalog";
      readonly catalog: TicketCatalogKind;
      /** 目录引用 id 的长度上限。 */
      readonly maxLength: number;
      /** 覆盖填写说明默认尾注「留空=未填写」（完结对的同填同空规则）。 */
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
    key: "userFeedbackChannelId",
    label: "用户反馈渠道",
    catalog: "userFeedbackChannel",
    maxLength: 100,
  },
  {
    type: "catalog",
    key: "feedbackReceiveChannelId",
    label: "反馈信息接收渠道",
    catalog: "feedbackReceiveChannel",
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

/** 按 key 取行；`TICKET_FIELDS.channelId.maxLength` 这类访问是精确类型。 */
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

/**
 * 建单自由文本字段的长度上限，建单/编辑 schema 与批量导入逐行校验共用 ——
 * 导入的每列长度检查引用这里，不另抄一份。
 */
export const TICKET_TEXT_LIMITS = Object.fromEntries(
  TICKET_FIELD_DESCRIPTORS.filter(isCreateTextField).map((descriptor) => [
    descriptor.key,
    descriptor.maxLength,
  ]),
) as Record<TicketCreateTextFieldDescriptor["key"], number>;

/** 完结备注长度上限；完结弹窗与批量导入的完结备注列共用这一个数。 */
export const TICKET_COMPLETION_REMARK_LIMIT = TICKET_FIELDS.completionRemark.maxLength;

/** 导入表头契约（列序＝表序）＝各行标准名；模板生成与上传解析共用。 */
export const TICKET_IMPORT_HEADERS: readonly string[] = TICKET_FIELD_DESCRIPTORS.map(
  (descriptor) => descriptor.label,
);

/**
 * 保单号的分隔字符串形态 ⇄ 数组形态。多值字段各表面（表单输入、详情/
 * 列表展示、导入单元格、导出单元格）统一走这一对函数；分隔符是任一非
 * 字母数字字符（空格/逗号/顿号/换行/中文标点…），取值本身只含字母数字，
 * join 出的文本总能无损 split 回同一数组。
 */

/** trim 每项、去空、去重（大小写敏感），保留首次出现的顺序。 */
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

/** []（未填写）join 为空串，展示层沿用现有未填写样式。 */
export function joinPolicyNumbers(values: readonly string[]): string {
  return values.join(" ");
}

export function applyNoPolicyNumber<T extends { noPolicyNumber: boolean; policyNumbers: string[] }>(
  data: T,
): T {
  return data.noPolicyNumber ? { ...data, policyNumbers: [] } : data;
}

/**
 * 清洗后的保单号数组违反上限时的拒绝原因；null = 合法。表单、API 契约与
 * 导入逐行校验共用同一份文案。
 */
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

/** 该字段在导入模板「填写说明」里的取值规则，按类型从声明派生。 */
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
