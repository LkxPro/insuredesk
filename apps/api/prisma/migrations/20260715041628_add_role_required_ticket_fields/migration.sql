-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "requiredTicketFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
