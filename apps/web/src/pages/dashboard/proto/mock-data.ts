/**
 * PROTOTYPE — throwaway. Dashboard 重设计原型的全部 mock 数据与类型。
 * 类型刻意长成未来 API 的形状，评审时顺带校验契约；定稿后本目录整体删除。
 */

export interface ActionMetrics {
  overdue: number;
  dueSoon: number;
  awaitingFirstResponse: number;
  firstResponseOverLine: number;
  unassigned: number;
  unassignedOldestWait: string;
  urgent: number;
}

export interface TrendPoint {
  date: string;
  created: number;
  completed: number;
  isToday: boolean;
}

export interface DistributionRow {
  id: string;
  name: string;
  count: number;
  unfilled?: boolean;
}

export interface AgentRow {
  id: string;
  name: string;
  inFlight: number;
  overdue: number;
  dueSoon: number;
  awaitingFirstResponse: number;
  followUpDebt: number;
  followUpDebtDetail: string;
  completed: number;
  avgCompletion: string;
  overdueRate: number;
  overdueCount: number;
}

export const ACTION_METRICS: ActionMetrics = {
  overdue: 7,
  dueSoon: 12,
  awaitingFirstResponse: 5,
  firstResponseOverLine: 2,
  unassigned: 9,
  unassignedOldestWait: "6 小时 12 分",
  urgent: 3,
};

/** 确定性伪随机：同一 seed 每次渲染同一条曲线，避免 hydration/轮询跳动。 */
function pseudo(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function buildTrend(days: number, now = new Date()): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dow = date.getDay();
    const weekend = dow === 0 || dow === 6;
    const seed = days * 7 + i;
    const created = Math.round(
      (weekend ? 11 : 27) + pseudo(seed) * (weekend ? 7 : 14) + 4 * Math.sin(seed / 9),
    );
    const lag = i >= 1 ? pseudo(seed + 1) * 6 - 2 : 0;
    const completed = Math.max(0, Math.round(created - 3 - lag - (i === 0 ? 6 : 0)));
    points.push({
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      created,
      completed,
      isToday: i === 0,
    });
  }
  return points;
}

export const KIND_DISTRIBUTION: DistributionRow[] = [
  { id: "complaint", name: "投诉", count: 612 },
  { id: "refund_exception", name: "退费异常", count: 143 },
];

export const CHANNEL_DISTRIBUTION: DistributionRow[] = [
  { id: "ch-ins", name: "保司", count: 286 },
  { id: "ch-broker", name: "经纪", count: 171 },
  { id: "ch-pay", name: "支付", count: 98 },
  { id: "ch-reg", name: "监管", count: 41 },
  { id: "ch-none", name: "未填写", count: 16, unfilled: true },
];

export const CATEGORY_DISTRIBUTION: DistributionRow[] = [
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

export const AGENTS: AgentRow[] = [
  {
    id: "u1",
    name: "王晓芸",
    inFlight: 23,
    overdue: 3,
    dueSoon: 4,
    awaitingFirstResponse: 1,
    followUpDebt: 2,
    followUpDebtDetail: "检查点 1 · 滚动 1",
    completed: 87,
    avgCompletion: "26 小时",
    overdueRate: 0.058,
    overdueCount: 6,
  },
  {
    id: "u2",
    name: "李振华",
    inFlight: 19,
    overdue: 2,
    dueSoon: 3,
    awaitingFirstResponse: 2,
    followUpDebt: 0,
    followUpDebtDetail: "检查点 0 · 滚动 0",
    completed: 74,
    avgCompletion: "31 小时",
    overdueRate: 0.043,
    overdueCount: 4,
  },
  {
    id: "u3",
    name: "陈静怡",
    inFlight: 17,
    overdue: 0,
    dueSoon: 2,
    awaitingFirstResponse: 0,
    followUpDebt: 1,
    followUpDebtDetail: "检查点 1 · 滚动 0",
    completed: 92,
    avgCompletion: "19 小时",
    overdueRate: 0.011,
    overdueCount: 1,
  },
  {
    id: "u4",
    name: "赵子昂",
    inFlight: 15,
    overdue: 1,
    dueSoon: 1,
    awaitingFirstResponse: 1,
    followUpDebt: 3,
    followUpDebtDetail: "检查点 2 · 滚动 1",
    completed: 65,
    avgCompletion: "34 小时",
    overdueRate: 0.062,
    overdueCount: 5,
  },
  {
    id: "u5",
    name: "刘思远",
    inFlight: 14,
    overdue: 1,
    dueSoon: 2,
    awaitingFirstResponse: 0,
    followUpDebt: 0,
    followUpDebtDetail: "检查点 0 · 滚动 0",
    completed: 58,
    avgCompletion: "22 小时",
    overdueRate: 0.027,
    overdueCount: 2,
  },
  {
    id: "u6",
    name: "孙梦琪",
    inFlight: 11,
    overdue: 0,
    dueSoon: 0,
    awaitingFirstResponse: 1,
    followUpDebt: 1,
    followUpDebtDetail: "检查点 0 · 滚动 1",
    completed: 71,
    avgCompletion: "28 小时",
    overdueRate: 0.014,
    overdueCount: 1,
  },
  {
    id: "u7",
    name: "周凯",
    inFlight: 9,
    overdue: 0,
    dueSoon: 0,
    awaitingFirstResponse: 0,
    followUpDebt: 0,
    followUpDebtDetail: "检查点 0 · 滚动 0",
    completed: 49,
    avgCompletion: "25 小时",
    overdueRate: 0,
    overdueCount: 0,
  },
  {
    id: "u8",
    name: "吴佩珊",
    inFlight: 8,
    overdue: 0,
    dueSoon: 0,
    awaitingFirstResponse: 0,
    followUpDebt: 0,
    followUpDebtDetail: "检查点 0 · 滚动 0",
    completed: 44,
    avgCompletion: "30 小时",
    overdueRate: 0,
    overdueCount: 0,
  },
  {
    id: "u9",
    name: "郑浩然",
    inFlight: 6,
    overdue: 0,
    dueSoon: 0,
    awaitingFirstResponse: 0,
    followUpDebt: 0,
    followUpDebtDetail: "检查点 0 · 滚动 0",
    completed: 31,
    avgCompletion: "21 小时",
    overdueRate: 0,
    overdueCount: 0,
  },
  {
    id: "u10",
    name: "林书瑶",
    inFlight: 4,
    overdue: 0,
    dueSoon: 0,
    awaitingFirstResponse: 0,
    followUpDebt: 0,
    followUpDebtDetail: "检查点 0 · 滚动 0",
    completed: 12,
    avgCompletion: "18 小时",
    overdueRate: 0,
    overdueCount: 0,
  },
];
