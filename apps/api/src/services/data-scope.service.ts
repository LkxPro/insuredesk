import type { AuthenticatedUser } from "./auth.service";

/**
 * Query-layer data-scope helper for enforcing RBAC data permissions.
 *
 * From the acceptance criteria:
 * "Query-layer data-scope helper: absence of `ticket.view_all` forces
 * `WHERE assigneeId = 当前用户` (unit of reuse for all ticket reads)"
 *
 * This helper automatically restricts queries to only data the user is
 * allowed to see based on their permissions. It's the enforcement point
 * for data-level RBAC (see PRD §5.2).
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

/**
 * Apply ticket data scope based on user permissions.
 *
 * - If user has `ticket.view_all`, returns empty filter (see all tickets)
 * - Otherwise, returns filter restricting to tickets assigned to the user
 *
 * @param user - Authenticated user (pass null to deny all access)
 * @returns Prisma where clause to add to ticket queries
 */
export function applyTicketDataScope(user: AuthenticatedUser | null): Record<string, any> {
  // No user = no access
  if (!user) {
    return { id: { equals: "__impossible__" } }; // Never matches
  }

  // Users with ticket.view_all can see everything
  if (user.permissions.includes("ticket.view_all")) {
    return {}; // No restriction
  }

  // Frontline users can only see their own assigned tickets
  return {
    assigneeId: user.id,
  };
}

/**
 * Check if user can view a specific ticket.
 * Used for single-ticket operations (view detail, edit, etc).
 *
 * @param user - Authenticated user
 * @param ticket - Ticket to check (must include assigneeId)
 * @returns true if user can view this ticket
 */
export function canViewTicket(
  user: AuthenticatedUser,
  ticket: { assigneeId: string | null },
): boolean {
  // Users with ticket.view_all can see any ticket
  if (user.permissions.includes("ticket.view_all")) {
    return true;
  }

  // Otherwise, can only view tickets assigned to them
  return ticket.assigneeId === user.id;
}

/**
 * Apply dashboard data scope based on user permissions.
 *
 * Similar to ticket scope but for dashboard statistics:
 * - If user has `dashboard.view_all`, see all data
 * - Otherwise, only see data for tickets assigned to them
 *
 * @param user - Authenticated user
 * @returns Prisma where clause for dashboard queries
 */
export function applyDashboardDataScope(user: AuthenticatedUser | null): Record<string, any> {
  if (!user) {
    return { id: { equals: "__impossible__" } };
  }

  if (user.permissions.includes("dashboard.view_all")) {
    return {};
  }

  // Frontline users only see stats for their own tickets
  return {
    assigneeId: user.id,
  };
}

// Note: The Ticket model doesn't exist yet (will come in a future issue).
// This data-scope helper is defined now to satisfy issue #2's acceptance
// criteria. It will be used when ticket queries are implemented.
