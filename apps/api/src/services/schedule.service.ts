import type {
  Channel,
  ScheduleCreateData,
  ScheduleDeleteInput,
  ScheduleListInput,
} from "@insuredesk/shared";
import { SHIFT_LABELS, SHIFT_TIMES } from "@insuredesk/shared";
import { Prisma } from "@prisma/client";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * 排班 domain logic (issue #31, PRD §2.4/§3.6): the 排班日历 CRUD plus the
 * on-duty predicate that 按排班自动分配 (PRD §4.3.4) builds its candidate set
 * from. Pure service layer per ADR 0006 — the router maps the domain errors
 * below to transport codes.
 *
 * Time model: a schedule row is a wall-clock roster fact — date (YYYY-MM-DD)
 * and shift window (HH:mm) in the server's local timezone (ADR 0006 时间处理).
 * "当前在班" therefore renders clock.now() the same way and compares the
 * zero-padded strings lexicographically; no instants, no timezone math.
 */

export class ScheduleNotFoundError extends Error {
  constructor() {
    super("排班记录不存在");
    this.name = "ScheduleNotFoundError";
  }
}

/** Target user missing or deactivated — mirrors AssigneeNotAssignableError. */
export class DutyUserNotSchedulableError extends Error {
  constructor() {
    super("所选值班人不存在或已停用");
    this.name = "DutyUserNotSchedulableError";
  }
}

/** The same person is already on this date × shift × channel cell. */
export class DuplicateScheduleError extends Error {
  constructor(userName: string, shift: keyof typeof SHIFT_LABELS) {
    super(`「${userName}」已在该日${SHIFT_LABELS[shift]}的此渠道排班中`);
    this.name = "DuplicateScheduleError";
  }
}

/** clock.now() rendered the way schedule rows store their wall-clock fields. */
export function localDateTimeParts(now: Date): { date: string; time: string } {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

/**
 * 当前在岗值班人 per channel at `now`: today's schedule rows whose window
 * covers the moment — on duty from startTime inclusive to endTime exclusive
 * (at 18:00 sharp the 早班 has left), deactivated accounts excluded. The two
 * shifts overlap 12:00–18:00 by design: both are on duty then.
 *
 * Accepts a transaction client so 按排班自动分配 reads the roster inside the
 * same transaction that assigns.
 */
export async function findOnDutyUserIdsByChannel(
  db: Prisma.TransactionClient,
  channels: readonly string[],
  now: Date,
): Promise<Map<string, Set<string>>> {
  const { date, time } = localDateTimeParts(now);
  const rows = await db.schedule.findMany({
    where: {
      date,
      channel: { in: [...channels] },
      startTime: { lte: time },
      endTime: { gt: time },
      user: { active: true },
    },
    select: { channel: true, userId: true },
  });

  const byChannel = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = byChannel.get(row.channel) ?? new Set<string>();
    ids.add(row.userId);
    byChannel.set(row.channel, ids);
  }
  return byChannel;
}

/**
 * One day of the 排班日历: every duty entry of `date`, user names joined live
 * (renames show current names — the roster is a forward-looking plan, not an
 * audit log). Ordered for a stable 班次 × 渠道 grid render.
 */
export async function listSchedules({ prisma }: TicketServiceDeps, input: ScheduleListInput) {
  const rows = await prisma.schedule.findMany({
    where: { date: input.date },
    include: { user: { select: { name: true, username: true, active: true } } },
    orderBy: [{ shift: "asc" }, { channel: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    shift: row.shift,
    startTime: row.startTime,
    endTime: row.endTime,
    channel: row.channel as Channel,
    remark: row.remark,
    userId: row.userId,
    userName: row.user.name,
    userActive: row.user.active,
  }));
}

/**
 * Add one on-duty entry. The shift window is stamped here from SHIFT_TIMES —
 * callers pick only date/shift/channel/user, so a stored row can never
 * disagree with its shift's hours (PRD §3.6 班次配置).
 */
export async function createSchedule({ prisma }: TicketServiceDeps, input: ScheduleCreateData) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, active: true },
  });
  if (!user?.active) {
    throw new DutyUserNotSchedulableError();
  }

  try {
    const created = await prisma.schedule.create({
      data: {
        date: input.date,
        shift: input.shift,
        channel: input.channel,
        userId: input.userId,
        remark: input.remark,
        ...SHIFT_TIMES[input.shift],
      },
    });
    return { id: created.id, userName: user.name };
  } catch (error) {
    // P2002 = the @@unique(date, shift, channel, userId) cell is already taken
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicateScheduleError(user.name, input.shift);
    }
    throw error;
  }
}

/** Remove one duty entry (hard delete — the roster is a plan, not history). */
export async function deleteSchedule({ prisma }: TicketServiceDeps, input: ScheduleDeleteInput) {
  try {
    await prisma.schedule.delete({ where: { id: input.id } });
  } catch (error) {
    // P2025 = no row with that id
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new ScheduleNotFoundError();
    }
    throw error;
  }
  return { id: input.id };
}
