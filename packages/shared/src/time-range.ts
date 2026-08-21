import { z } from "zod";

/**
 * 创建时间区间入参，工单列表与看板共用。唯一时间轴是 createdAt（录入时刻）：
 * 它恒非空、恒单调，也是 SLA 时钟起点；反馈/进线/完结时间大量为空，按它们
 * 筛选等于隐式排除未填写的工单。
 *
 * 契约只收绝对时刻，左闭右闭：「本周」「本月」这类预设由前端按浏览器时区算成
 * 边界 instant 再传下来。后端因此不需要知道周/月的口径，也不需要时区入参——
 * 否则时区会从"格式化用的可选参数"升级成"决定返回哪些行的必要参数"。
 */
export const createdRangeFields = {
  createdFrom: z.string().datetime({ offset: true, message: "创建时间起始格式不正确" }).optional(),
  createdTo: z.string().datetime({ offset: true, message: "创建时间截止格式不正确" }).optional(),
};

export const createdRangeSchema = z.object(createdRangeFields);

export type CreatedRangeQuery = z.infer<typeof createdRangeSchema>;
