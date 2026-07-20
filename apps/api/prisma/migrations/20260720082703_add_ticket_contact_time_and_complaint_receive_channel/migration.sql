-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "complaintReceiveChannel" TEXT,
ADD COLUMN     "contactTime" TIMESTAMPTZ;
