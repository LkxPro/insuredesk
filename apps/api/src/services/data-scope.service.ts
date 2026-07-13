import type { Permission } from "@insuredesk/shared";
import type { AuthenticatedUser } from "./auth.service";

/**
 * Query-layer data-scope helpers for enforcing RBAC data permissions — the
 * unit of reuse for all ticket reads: absence of `ticket.view_all` forces
 * `WHERE assigneeId = 当前用户`.
 *
 * These helpers automatically restrict queries to only data the user is
 * allowed to see based on their permissions. They are the enforcement point
 * for data-level RBAC.
 *
 * Usage pattern:
 * ```ts
 * const tickets = await prisma.ticket.findMany({
 *   where: {
 *     ...applyTicketDataScope(user),
 *     // ... other filters
 *   },
 * });
 * ```
 */

/** Where-clause that can never match: the scope for unauthenticated callers. */
const DENY_ALL_WHERE = { id: { equals: "__impossible__" } } as const;

/**
 * Build a Prisma where-clause fragment scoping a query to the rows the user
 * may see:
 *
 * - No user (unauthenticated) → filter that never matches
 * - User holds `viewAllPermission` → no restriction
 * - Otherwise → only rows assigned to the user (`assigneeId = user.id`)
 */
function applyDataScope(
  user: AuthenticatedUser | null,
  viewAllPermission: Permission,
): Record<string, unknown> {
  if (!user) {
    return DENY_ALL_WHERE;
  }

  if (user.permissions.includes(viewAllPermission)) {
    return {}; // No restriction
  }

  return { assigneeId: user.id };
}

/**
 * Ticket data scope: without `ticket.view_all`, users only see tickets
 * assigned to them.
 */
export function applyTicketDataScope(user: AuthenticatedUser | null): Record<string, unknown> {
  return applyDataScope(user, "ticket.view_all");
}

/**
 * Dashboard data scope: without `dashboard.view_all`, statistics only cover
 * tickets assigned to the user.
 */
export function applyDashboardDataScope(user: AuthenticatedUser | null): Record<string, unknown> {
  return applyDataScope(user, "dashboard.view_all");
}
