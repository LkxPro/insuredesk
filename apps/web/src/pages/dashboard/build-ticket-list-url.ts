import type { CreatedRangeQuery, DashboardMetricKey } from "@insuredesk/shared";

function appendCreatedRange(params: URLSearchParams, createdRange: CreatedRangeQuery): void {
  if (createdRange.createdFrom !== undefined) {
    params.set("createdFrom", createdRange.createdFrom);
  }
  if (createdRange.createdTo !== undefined) {
    params.set("createdTo", createdRange.createdTo);
  }
}

export function buildTicketListUrl(
  metric: DashboardMetricKey,
  createdRange: CreatedRangeQuery,
  urgentPolicyId?: string | null,
): string {
  const params = new URLSearchParams();

  switch (metric) {
    case "total":
      break;
    case "unassigned":
      params.set("status", "unassigned");
      break;
    case "assigned":
      params.set("status", "assigned");
      break;
    case "processing":
      params.set("status", "processing");
      break;
    case "completed":
      params.set("status", "completed");
      break;
    case "pendingTimeout":
      params.set("status", "pending_timeout");
      break;
    case "overdue":
      params.set("status", "overdue");
      break;
    case "urgent":
      if (urgentPolicyId) {
        params.set("policyId", urgentPolicyId);
      }
      break;
  }

  appendCreatedRange(params, createdRange);

  const search = params.toString();
  return `/tickets${search ? `?${search}` : ""}`;
}

export function buildChannelTicketListUrl(
  channelId: string,
  createdRange: CreatedRangeQuery,
): string {
  const params = new URLSearchParams();
  params.set("channel", channelId);
  appendCreatedRange(params, createdRange);

  const search = params.toString();
  return `/tickets?${search}`;
}
