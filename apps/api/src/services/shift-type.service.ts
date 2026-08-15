import {
  type ShiftTypeCreateInput,
  type ShiftTypeUpdateInput,
  shiftTypeSegmentsSchema,
} from "@insuredesk/shared";
import { Prisma, type PrismaClient, type ShiftType } from "../generated/prisma/client.ts";

export class ShiftTypeNameConflictError extends Error {
  constructor() {
    super("班次名称已存在");
    this.name = "ShiftTypeNameConflictError";
  }
}

export class ShiftTypeNotFoundError extends Error {
  constructor() {
    super("班次不存在");
    this.name = "ShiftTypeNotFoundError";
  }
}

export class ShiftTypeInUseError extends Error {
  constructor() {
    super("该班次已有排班记录，无法删除");
    this.name = "ShiftTypeInUseError";
  }
}

function toDto(row: ShiftType) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    segments: shiftTypeSegmentsSchema.parse(row.segments),
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function writeData(input: ShiftTypeCreateInput | ShiftTypeUpdateInput) {
  return {
    name: input.name,
    color: input.color.toLowerCase(),
    segments: input.segments,
    displayOrder: input.displayOrder,
  } satisfies Prisma.ShiftTypeUncheckedCreateInput;
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new ShiftTypeNameConflictError();
    if (error.code === "P2025") throw new ShiftTypeNotFoundError();
  }
  throw error;
}

export async function listShiftTypes(prisma: PrismaClient) {
  const rows = await prisma.shiftType.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toDto);
}

export async function createShiftType(prisma: PrismaClient, input: ShiftTypeCreateInput) {
  try {
    return toDto(await prisma.shiftType.create({ data: writeData(input) }));
  } catch (error) {
    translateWriteError(error);
  }
}

export async function updateShiftType(prisma: PrismaClient, input: ShiftTypeUpdateInput) {
  try {
    return toDto(
      await prisma.shiftType.update({ where: { id: input.id }, data: writeData(input) }),
    );
  } catch (error) {
    translateWriteError(error);
  }
}

export async function deleteShiftType(prisma: PrismaClient, id: string) {
  try {
    await prisma.shiftType.delete({ where: { id } });
    return { id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new ShiftTypeInUseError();
    }
    translateWriteError(error);
  }
}
