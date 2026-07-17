-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "importBatchId" TEXT;

-- CreateTable
CREATE TABLE "ticket_import_batches" (
    "id" TEXT NOT NULL,
    "importerId" TEXT NOT NULL,
    "importedAt" TIMESTAMPTZ NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,

    CONSTRAINT "ticket_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_import_batches_importerId_idx" ON "ticket_import_batches"("importerId");

-- CreateIndex
CREATE INDEX "tickets_importBatchId_idx" ON "tickets"("importBatchId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ticket_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_import_batches" ADD CONSTRAINT "ticket_import_batches_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
