import type { AppRouter } from "@insuredesk/api";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * ticket.detail 的载荷类型，从 router 推导而来 —— 分栏详情的各个部件（信息
 * 栏、时间线、头部操作）共用一个真源，服务端加字段时前端不需要跟着抄一遍。
 */
export type TicketDetail = NonNullable<inferRouterOutputs<AppRouter>["ticket"]["detail"]>;
