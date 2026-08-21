import type { Permission } from "@insuredesk/shared";
import type { AuthenticatedUser } from "./auth.service.ts";

/**
 * The returned fragment may carry a top-level `OR`, so call sites must not
 * spread it into a where that sets its own top-level `OR` — nest such
 * conditions under `AND` instead (as the list WHERE does for search).
 */

const DENY_ALL_WHERE = { id: { equals: "__impossible__" } } as const;

function applyDataScope(
  user: AuthenticatedUser | null,
  viewAllPermission: Permission,
  restrictedScope: (userId: string) => Record<string, unknown>,
): Record<string, unknown> {
  if (!user) {
    return DENY_ALL_WHERE;
  }

  if (user.permissions.includes(viewAllPermission)) {
    return {};
  }

  return restrictedScope(user.id);
}

/**
 * Ticket data scope: without `ticket.view_all`, users see tickets assigned to
 * them OR created by them — a creator keeps sight of their manual ticket
 * while it is unassigned or handled by someone else. External sources
 * (飞书表单/社区) have no creator account, so `creatorId` never matches them.
 */
export function applyTicketDataScope(user: AuthenticatedUser | null): Record<string, unknown> {
  return applyDataScope(user, "ticket.view_all", (userId) => ({
    OR: [{ assigneeId: userId }, { creatorId: userId }],
  }));
}

/**
 * Dashboard data scope: without `dashboard.view_all`, statistics only cover
 * tickets assigned to the user. Deliberately narrower than the ticket scope:
 * 考核口径按「我名下」— tickets someone merely created must not inflate
 * their dashboard numbers, even though the list shows them.
 */
export function applyDashboardDataScope(user: AuthenticatedUser | null): Record<string, unknown> {
  return applyDataScope(user, "dashboard.view_all", (userId) => ({ assigneeId: userId }));
}
