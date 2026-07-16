import {
  PENDING_TIMEOUT_WINDOW_MS,
  type TicketDisplayStatus,
  TicketStatus,
} from "@insuredesk/shared";
import type { Prisma } from "../generated/prisma/client";

/**
 * The single source of truth for time-based ticket predicates in SQL:
 * the WHERE-clause mirror of the shared
 * `deriveDisplayStatus`. The list's computed-status filter uses it today; the
 * dashboard's 已超时数 card and 我的待办 must reuse these fragments — never
 * restate the conditions — so the whole system reddens at the same instant.
 *
 * Boundary semantics, kept in lockstep with `deriveDisplayStatus` (the
 * fixed-clock integration test enforces the agreement):
 *
 * - overdue        := open AND now  >  dueAt         (已超过 is strict)
 * - pending_timeout:= open AND now  <= dueAt < now+2h (不足 2 小时 is strict)
 * - open           := status ≠ completed; dueAt null (特急) never computes
 *
 * Every fragment takes `now` as a parameter: one instant per request, shared
 * with serialization, so filtering and display can never disagree mid-query.
 */

/** 已超时（实时运营视角）：在途且已过 dueAt；完结即移出. */
export function overdueTicketWhere(now: Date): Prisma.TicketWhereInput {
  return {
    status: { not: TicketStatus.Completed },
    dueAt: { lt: now },
  };
}

/** 待超时：在途且距 dueAt 不足 2 小时（含恰在 dueAt 的瞬间）. */
export function pendingTimeoutTicketWhere(now: Date): Prisma.TicketWhereInput {
  return {
    status: { not: TicketStatus.Completed },
    dueAt: { gte: now, lt: pendingTimeoutHorizon(now) },
  };
}

/**
 * WHERE fragment for one display status, exactly partitioning the (non-deleted)
 * ticket set: every ticket matches precisely one of the 6 filters at a given
 * `now`. A base status therefore only matches while no computed status
 * overrides it; completed matches on the stored status alone.
 */
export function displayStatusTicketWhere(
  status: TicketDisplayStatus,
  now: Date,
): Prisma.TicketWhereInput {
  switch (status) {
    case "overdue":
      return overdueTicketWhere(now);
    case "pending_timeout":
      return pendingTimeoutTicketWhere(now);
    case TicketStatus.Completed:
      return { status };
    default:
      return {
        status,
        OR: [{ dueAt: null }, { dueAt: { gte: pendingTimeoutHorizon(now) } }],
      };
  }
}

/** First instant whose dueAt is close enough to compute pending_timeout. */
function pendingTimeoutHorizon(now: Date): Date {
  return new Date(now.getTime() + PENDING_TIMEOUT_WINDOW_MS);
}
