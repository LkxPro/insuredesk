/**
 * PROTOTYPE — throwaway. V4-V6 新增的 mock：时效策略条 + 渠道×主题交叉分析表。
 * 交叉表行 = 反馈渠道目录（保司/经纪/支付），展开 = 投诉侧表 project /
 * brokerageEntity / paymentChannel 字段值；列 = 用户反馈渠道归组（监管/舆情/
 * 400热线/其他）。叶子单元格存基线（30 天）值，行/列合计一律由叶子现算——
 * 周期缩放只作用于叶子，任何自定义范围下表内合计恒一致。
 */

export interface PolicyRow {
  id: string;
  name: string;
  limit: string;
  inFlight: number;
  dueSoon: number;
  overdue: number;
  note?: string;
  muted?: boolean;
}

export const POLICIES: PolicyRow[] = [
  { id: "p1", name: "一般投诉", limit: "48h", inFlight: 34, dueSoon: 3, overdue: 2 },
  { id: "p2", name: "高级投诉", limit: "48h", inFlight: 21, dueSoon: 4, overdue: 2 },
  { id: "p3", name: "加急投诉", limit: "72h", inFlight: 12, dueSoon: 3, overdue: 2 },
  {
    id: "p4",
    name: "特急投诉",
    limit: "不设时限",
    inFlight: 3,
    dueSoon: 0,
    overdue: 0,
    note: "首响 30 分钟",
  },
  { id: "p5", name: "退费默认", limit: "48h", inFlight: 8, dueSoon: 2, overdue: 1 },
  { id: "p6", name: "未指定策略", limit: "—", inFlight: 15, dueSoon: 0, overdue: 0, muted: true },
];

export interface CrossCells {
  regulator: number;
  publicOpinion: number;
  hotline: number;
  other: number;
}

export const CROSS_COLUMNS = [
  { key: "regulator", label: "监管" },
  { key: "publicOpinion", label: "舆情" },
  { key: "hotline", label: "400热线" },
  { key: "other", label: "其他" },
] as const;

export interface CrossEntity {
  id: string;
  name: string;
  cells: CrossCells;
}

export interface CrossChannelRow {
  id: string;
  name: string;
  entityLabel: string;
  entities: CrossEntity[];
}

const CROSS_BASE: CrossChannelRow[] = [
  {
    id: "ch-ins",
    name: "保司",
    entityLabel: "家保司",
    entities: [
      {
        id: "e1",
        name: "平安产险",
        cells: { regulator: 20, publicOpinion: 11, hotline: 46, other: 15 },
      },
      {
        id: "e2",
        name: "人保寿险",
        cells: { regulator: 14, publicOpinion: 7, hotline: 38, other: 9 },
      },
      {
        id: "e3",
        name: "泰康互联",
        cells: { regulator: 10, publicOpinion: 5, hotline: 30, other: 7 },
      },
      {
        id: "e4",
        name: "众惠相互",
        cells: { regulator: 6, publicOpinion: 3, hotline: 19, other: 4 },
      },
      {
        id: "e5",
        name: "其他保司",
        cells: { regulator: 8, publicOpinion: 4, hotline: 25, other: 5 },
      },
    ],
  },
  {
    id: "ch-broker",
    name: "经纪",
    entityLabel: "家经纪公司",
    entities: [
      {
        id: "e6",
        name: "东方大地经纪",
        cells: { regulator: 9, publicOpinion: 5, hotline: 32, other: 9 },
      },
      {
        id: "e7",
        name: "明亚经纪",
        cells: { regulator: 6, publicOpinion: 3, hotline: 28, other: 7 },
      },
      {
        id: "e8",
        name: "大童经纪",
        cells: { regulator: 4, publicOpinion: 3, hotline: 24, other: 5 },
      },
      {
        id: "e9",
        name: "其他经纪",
        cells: { regulator: 5, publicOpinion: 3, hotline: 22, other: 6 },
      },
    ],
  },
  {
    id: "ch-pay",
    name: "支付",
    entityLabel: "个支付渠道",
    entities: [
      {
        id: "e10",
        name: "连连支付",
        cells: { regulator: 4, publicOpinion: 3, hotline: 19, other: 6 },
      },
      {
        id: "e11",
        name: "易宝支付",
        cells: { regulator: 3, publicOpinion: 2, hotline: 17, other: 4 },
      },
      {
        id: "e12",
        name: "通联支付",
        cells: { regulator: 3, publicOpinion: 2, hotline: 14, other: 3 },
      },
      {
        id: "e13",
        name: "其他支付",
        cells: { regulator: 2, publicOpinion: 1, hotline: 12, other: 3 },
      },
    ],
  },
];

/** 30 天基线之外的渠道：监管渠道 41 + 未填写 16（不进交叉表行）。 */
const CHANNEL_EXTRA_BASE = [
  { id: "ch-reg", name: "监管", count: 41 },
  { id: "ch-none", name: "未填写", count: 16, unfilled: true },
];

const REFUND_BASE_30D = 143;

/** 30 天基线 → 任意周期天数的线性缩放（mock 用，全部叶子走它保证合计一致）。 */
export const scale30 = (base: number, days: number) => Math.max(0, Math.round((base * days) / 30));

const ratio = scale30;

const scaleCells = (cells: CrossCells, days: number): CrossCells => ({
  regulator: ratio(cells.regulator, days),
  publicOpinion: ratio(cells.publicOpinion, days),
  hotline: ratio(cells.hotline, days),
  other: ratio(cells.other, days),
});

export const sumCells = (list: CrossCells[]): CrossCells =>
  list.reduce<CrossCells>(
    (acc, c) => ({
      regulator: acc.regulator + c.regulator,
      publicOpinion: acc.publicOpinion + c.publicOpinion,
      hotline: acc.hotline + c.hotline,
      other: acc.other + c.other,
    }),
    { regulator: 0, publicOpinion: 0, hotline: 0, other: 0 },
  );

export const cellsTotal = (c: CrossCells) => c.regulator + c.publicOpinion + c.hotline + c.other;

export interface ComputedCrossRow {
  id: string;
  name: string;
  entityLabel: string;
  cells: CrossCells;
  entities: CrossEntity[];
}

/** 交叉表：叶子按周期缩放，行合计由缩放后叶子现算。 */
export function buildCrossRows(days: number): ComputedCrossRow[] {
  return CROSS_BASE.map((row) => {
    const entities = row.entities.map((e) => ({ ...e, cells: scaleCells(e.cells, days) }));
    return { ...row, entities, cells: sumCells(entities.map((e) => e.cells)) };
  });
}

/** 渠道条形：保司/经纪/支付与交叉表行同源，任何周期下两图一致。 */
export function buildChannelRows(days: number) {
  const cross = buildCrossRows(days);
  return [
    ...cross.map((row) => ({ id: row.id, name: row.name, count: cellsTotal(row.cells) })),
    ...CHANNEL_EXTRA_BASE.map((row) => ({ ...row, count: ratio(row.count, days) })),
  ];
}

export function buildKindRows(days: number) {
  const complaint = MATRIX_ROW_SPECS.reduce((s, r) => s + scale30(r.total30d, days), 0);
  return [
    { id: "complaint", name: "投诉", count: complaint },
    { id: "refund_exception", name: "退费异常", count: ratio(REFUND_BASE_30D, days) },
  ];
}

export function buildCategoryRows(days: number) {
  return CATEGORY_BASE.map((row) => ({ ...row, count: ratio(row.count, days) }));
}

const CATEGORY_BASE = [
  { id: "cat-1", name: "理赔纠纷", count: 148 },
  { id: "cat-2", name: "退保退费争议", count: 96 },
  { id: "cat-3", name: "服务态度", count: 74 },
  { id: "cat-4", name: "续保扣费", count: 63 },
  { id: "cat-5", name: "保单信息错误", count: 51 },
  { id: "cat-6", name: "核保时效", count: 44 },
  { id: "cat-7", name: "销售误导", count: 38 },
  { id: "cat-8", name: "理赔时效", count: 33 },
  { id: "cat-9", name: "发票问题", count: 21 },
  { id: "cat-other", name: "其他", count: 28 },
  { id: "cat-none", name: "未填写", count: 16, unfilled: true },
];

/* ------------------------------------------------------------------ */
/* V7+：全量字典交叉矩阵。列 = 用户反馈渠道字典 15 项 + 未填写（顺序跟随    */
/* displayOrder）；行 = 反馈渠道字典全量 + 未填写。行总量按权重分配到列、    */
/* 再按实体份额下拆，两级都用最大余数法——任何周期下实体和=行、行和=总计。  */

export interface UfcColumn {
  id: string;
  name: string;
  unfilled?: boolean;
}

export const UFC_COLUMNS: UfcColumn[] = [
  { id: "broker400", name: "经纪400热线" },
  { id: "pay400", name: "支付400热线" },
  { id: "ins400", name: "保司400热线" },
  { id: "reg-guided", name: "监管引导件" },
  { id: "reg-formal", name: "监管正式件" },
  { id: "web", name: "网微投诉" },
  { id: "blackcat", name: "黑猫" },
  { id: "saic", name: "市监/工商" },
  { id: "card-bank", name: "发卡行" },
  { id: "pbc", name: "人行" },
  { id: "internal", name: "内部客服热线" },
  { id: "police", name: "派出所" },
  { id: "consumer", name: "消保平台" },
  { id: "wechat", name: "微信商户" },
  { id: "gov", name: "政府转办" },
  { id: "unfilled", name: "未填写", unfilled: true },
];

interface MatrixRowSpec {
  id: string;
  name: string;
  total30d: number;
  entityLabel?: string;
  unfilled?: boolean;
  weights: Array<readonly [string, number]>;
  entities?: Array<{ id: string; name: string; share: number }>;
}

const MATRIX_ROW_SPECS: MatrixRowSpec[] = [
  {
    id: "m-ins",
    name: "保司",
    total30d: 286,
    entityLabel: "家保司",
    weights: [
      ["ins400", 45],
      ["reg-guided", 16],
      ["internal", 9],
      ["web", 8],
      ["blackcat", 6],
      ["saic", 3],
      ["consumer", 3],
      ["gov", 3],
      ["unfilled", 7],
    ],
    entities: [
      { id: "e1", name: "平安产险", share: 32 },
      { id: "e2", name: "人保寿险", share: 24 },
      { id: "e3", name: "泰康互联", share: 18 },
      { id: "e4", name: "众惠相互", share: 11 },
      { id: "e5", name: "其他保司", share: 15 },
    ],
  },
  {
    id: "m-broker",
    name: "经纪",
    total30d: 171,
    entityLabel: "家经纪公司",
    weights: [
      ["broker400", 52],
      ["reg-guided", 12],
      ["web", 9],
      ["internal", 8],
      ["blackcat", 7],
      ["consumer", 4],
      ["unfilled", 8],
    ],
    entities: [
      { id: "e6", name: "东方大地经纪", share: 33 },
      { id: "e7", name: "明亚经纪", share: 26 },
      { id: "e8", name: "大童经纪", share: 21 },
      { id: "e9", name: "其他经纪", share: 20 },
    ],
  },
  {
    id: "m-pay",
    name: "支付",
    total30d: 98,
    entityLabel: "个支付渠道",
    weights: [
      ["pay400", 34],
      ["card-bank", 15],
      ["pbc", 9],
      ["blackcat", 8],
      ["web", 6],
      ["wechat", 6],
      ["saic", 4],
      ["reg-guided", 4],
      ["unfilled", 14],
    ],
    entities: [
      { id: "e10", name: "连连支付", share: 33 },
      { id: "e11", name: "易宝支付", share: 27 },
      { id: "e12", name: "通联支付", share: 22 },
      { id: "e13", name: "其他支付", share: 18 },
    ],
  },
  {
    id: "m-reg",
    name: "监管",
    total30d: 41,
    weights: [
      ["reg-formal", 34],
      ["reg-guided", 20],
      ["gov", 20],
      ["saic", 12],
      ["unfilled", 14],
    ],
  },
  {
    id: "m-none",
    name: "未填写",
    total30d: 16,
    unfilled: true,
    weights: [
      ["unfilled", 70],
      ["internal", 18],
      ["web", 12],
    ],
  },
];

export interface MatrixEntity {
  id: string;
  name: string;
  cells: Record<string, number>;
}

export interface MatrixRow {
  id: string;
  name: string;
  entityLabel?: string;
  unfilled?: boolean;
  cells: Record<string, number>;
  entities?: MatrixEntity[];
}

/** 最大余数法：整数分配且和恒等于 total。 */
function distribute(total: number, entries: ReadonlyArray<readonly [string, number]>) {
  const result: Record<string, number> = {};
  const weightSum = entries.reduce((s, [, w]) => s + w, 0);
  if (weightSum <= 0 || total <= 0) {
    for (const [k] of entries) result[k] = 0;
    return result;
  }
  const ranked = entries
    .map(([k, w], i) => ({ k, exact: (total * w) / weightSum, i }))
    .sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.i - b.i);
  let assigned = 0;
  for (const { k, exact } of ranked) {
    result[k] = Math.floor(exact);
    assigned += result[k] ?? 0;
  }
  for (const { k } of ranked) {
    if (assigned >= total) break;
    result[k] = (result[k] ?? 0) + 1;
    assigned += 1;
  }
  return result;
}

export function buildCrossMatrix(days: number): MatrixRow[] {
  return MATRIX_ROW_SPECS.map((spec) => {
    const cells = distribute(scale30(spec.total30d, days), spec.weights);
    if (!spec.entities) {
      return { id: spec.id, name: spec.name, unfilled: spec.unfilled, cells };
    }
    const entities = spec.entities.map((e) => ({
      id: e.id,
      name: e.name,
      cells: {} as Record<string, number>,
    }));
    for (const col of UFC_COLUMNS) {
      const split = distribute(
        cells[col.id] ?? 0,
        spec.entities.map((e) => [e.id, e.share] as const),
      );
      for (const entity of entities) {
        entity.cells[col.id] = split[entity.id] ?? 0;
      }
    }
    return {
      id: spec.id,
      name: spec.name,
      entityLabel: spec.entityLabel,
      cells,
      entities,
    };
  });
}

/* 来源（source）分布：录入方式构成，全量工单口径（含骏伯推送的退费单）。 */
const SOURCE_BASE = [
  { id: "manual", name: "手工录入", count: 340 },
  { id: "feishu_form", name: "飞书表单", count: 150 },
  { id: "jb-insurance", name: "骏伯推送（退费）", count: 143 },
  { id: "external_channel", name: "外部渠道", count: 98 },
  { id: "community", name: "社区", count: 24 },
];

export function buildSourceRows(days: number) {
  return SOURCE_BASE.map((row) => ({ ...row, count: scale30(row.count, days) }));
}
