/**
 * 看板下钻链接只拼实时口径参数（status/firstResponse/slaPolicyId），不带
 * createdRange——行动区与策略区是当前快照，周期筛选交给列表页自己叠加。
 * slaPolicyId 的字面值 "none" = 未指定策略（契约见 shared/ticket-filter.ts）。
 */

type ActionStatus = "overdue" | "pending_timeout" | "unassigned";

export function buildStatusTicketListUrl(status: ActionStatus): string {
  return `/tickets?status=${status}`;
}

export function buildFirstResponseTicketListUrl(): string {
  return "/tickets?firstResponse=pending";
}

export function buildPolicyTicketListUrl(
  policyId: string | null,
  status?: "overdue" | "pending_timeout",
): string {
  const params = new URLSearchParams();
  params.set("slaPolicyId", policyId ?? "none");
  if (status !== undefined) {
    params.set("status", status);
  }
  return `/tickets?${params.toString()}`;
}
