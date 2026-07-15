-- Issue #65 explicitly replaces the legacy channel-based roster without data migration.
DROP TABLE "schedules";

CREATE TABLE "shift_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shift_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shift_types_name_key" ON "shift_types"("name");

CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "remark" VARCHAR(200),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedules_date_idx" ON "schedules"("date");
CREATE UNIQUE INDEX "schedules_date_userId_key" ON "schedules"("date", "userId");

ALTER TABLE "schedules" ADD CONSTRAINT "schedules_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "shift_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
