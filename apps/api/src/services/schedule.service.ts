import {
  type ScheduleCreateData,
  type ScheduleDeleteInput,
  type ScheduleListInput,
  shiftTypeSegmentsSchema,
} from "@insuredesk/shared";
import { Prisma, type PrismaClient, type Schedule } from "../generated/prisma/client.ts";

/** Dates and times are wall-clock strings, so comparisons remain independent of timezone conversion. */

export class ScheduleNotFoundError extends Error {
  constructor() {
    super("排班记录不存在");
    this.name = "ScheduleNotFoundError";
  }
}

export class DutyUserNotSchedulableError extends Error {
  constructor() {
    super("所选客服人员不存在或已停用");
    this.name = "DutyUserNotSchedulableError";
  }
}

export class ScheduleShiftNotFoundError extends Error {
  constructor() {
    super("所选班次不存在");
    this.name = "ScheduleShiftNotFoundError";
  }
}

function scheduleDto(
  row: Schedule & {
    user: { name: string; username: string; active: boolean };
    shift: { name: string; color: string; segments: Prisma.JsonValue };
  },
) {
  return {
    id: row.id,
    date: row.date,
    userId: row.userId,
    userName: row.user.name,
    username: row.user.username,
    userActive: row.user.active,
    shiftId: row.shiftId,
    shiftName: row.shift.name,
    shiftColor: row.shift.color,
    shiftSegments: shiftTypeSegmentsSchema.parse(row.shift.segments),
    remark: row.remark,
  };
}

const scheduleInclude = {
  user: { select: { name: true, username: true, active: true } },
  shift: { select: { name: true, color: true, segments: true } },
} satisfies Prisma.ScheduleInclude;

export async function listSchedules(prisma: PrismaClient, input: ScheduleListInput) {
  const dateWhere = { gte: input.startDate, lte: input.endDate };
  const [rows, users, shifts] = await Promise.all([
    prisma.schedule.findMany({
      where: { date: dateWhere },
      include: scheduleInclude,
      orderBy: [{ date: "asc" }, { user: { name: "asc" } }, { userId: "asc" }],
    }),
    prisma.user.findMany({
      where: {
        OR: [{ active: true }, { schedules: { some: { date: dateWhere } } }],
      },
      select: { id: true, name: true, username: true, active: true },
      orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
    }),
    prisma.shiftType.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  return {
    entries: rows.map(scheduleDto),
    users,
    shifts: shifts.map((shift) => ({
      id: shift.id,
      name: shift.name,
      color: shift.color,
      segments: shiftTypeSegmentsSchema.parse(shift.segments),
      displayOrder: shift.displayOrder,
    })),
  };
}

export async function createSchedule(prisma: PrismaClient, input: ScheduleCreateData) {
  const [user, shift] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, active: true },
    }),
    prisma.shiftType.findUnique({
      where: { id: input.shiftId },
      select: { id: true },
    }),
  ]);
  if (!user?.active) throw new DutyUserNotSchedulableError();
  if (!shift) throw new ScheduleShiftNotFoundError();

  const row = await prisma.schedule.upsert({
    where: { date_userId: { date: input.date, userId: input.userId } },
    update: { shiftId: input.shiftId, remark: input.remark },
    create: input,
    include: scheduleInclude,
  });
  return scheduleDto(row);
}

export async function deleteSchedule(prisma: PrismaClient, input: ScheduleDeleteInput) {
  try {
    await prisma.schedule.delete({ where: { id: input.id } });
    return { id: input.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new ScheduleNotFoundError();
    }
    throw error;
  }
}

export function localDateTimeParts(now: Date): { date: string; time: string } {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

function previousDate(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function segmentCovers(
  scheduleDate: string,
  currentDate: string,
  time: string,
  segment: { start: string; end: string },
) {
  if (segment.start === segment.end) return false;
  if (segment.start < segment.end) {
    return scheduleDate === currentDate && segment.start <= time && time < segment.end;
  }
  return (
    (scheduleDate === currentDate && time >= segment.start) ||
    (scheduleDate === previousDate(currentDate) && time < segment.end)
  );
}

/**
 * Active users whose scheduled shift covers `date` + `wallClockTime`. Normal segments
 * are start-inclusive/end-exclusive. Overnight segments also inspect the
 * previous day's roster for the after-midnight tail.
 */
export async function findOnDutyUserIds(
  db: PrismaClient | Prisma.TransactionClient,
  date: string,
  wallClockTime: string,
): Promise<string[]> {
  const priorDate = previousDate(date);
  const rows = await db.schedule.findMany({
    where: {
      date: { in: [priorDate, date] },
      user: { active: true },
    },
    select: {
      date: true,
      userId: true,
      shift: { select: { segments: true } },
    },
    orderBy: [{ userId: "asc" }, { date: "asc" }],
  });

  const ids = new Set<string>();
  for (const row of rows) {
    const segments = shiftTypeSegmentsSchema.parse(row.shift.segments);
    if (segments.some((segment) => segmentCovers(row.date, date, wallClockTime, segment))) {
      ids.add(row.userId);
    }
  }
  return [...ids];
}
