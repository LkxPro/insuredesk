-- AlterTable
ALTER TABLE "ticket_import_batches" ADD COLUMN     "revokedAt" TIMESTAMPTZ,
ADD COLUMN     "revokedById" TEXT;

-- AddForeignKey
ALTER TABLE "ticket_import_batches" ADD CONSTRAINT "ticket_import_batches_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
