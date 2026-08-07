ALTER TABLE "users"
ADD COLUMN "externalListOrder" TEXT,
ADD COLUMN "externalExportOrder" TEXT;

CREATE TABLE "external_ticket_export_audits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filterSnapshot" TEXT NOT NULL,
    "fieldKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rowCount" INTEGER NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "external_ticket_export_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_ticket_export_audits_userId_at_idx"
ON "external_ticket_export_audits"("userId", "at");
