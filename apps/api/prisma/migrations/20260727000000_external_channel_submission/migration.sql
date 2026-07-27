-- CreateTable: external_orgs
CREATE TABLE "external_orgs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelId" TEXT,
    "visibleTicketFields" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "external_orgs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_orgs_name_key" ON "external_orgs"("name");

-- AddForeignKey
ALTER TABLE "external_orgs" ADD CONSTRAINT "external_orgs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: users - add externalOrgId
ALTER TABLE "users" ADD COLUMN "externalOrgId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_externalOrgId_fkey" FOREIGN KEY ("externalOrgId") REFERENCES "external_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: tickets - add submissionText and externalOrgId
ALTER TABLE "tickets" ADD COLUMN "submissionText" TEXT,
ADD COLUMN "externalOrgId" TEXT;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_externalOrgId_fkey" FOREIGN KEY ("externalOrgId") REFERENCES "external_orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: process_logs - add internalOnly
ALTER TABLE "process_logs" ADD COLUMN "internalOnly" BOOLEAN NOT NULL DEFAULT false;

-- Seed: external user role
INSERT INTO "roles" ("id", "name", "permissions", "system", "requiredTicketFields", "createdAt", "updatedAt")
VALUES (
    'external_user_role_seed',
    '外部用户',
    ARRAY['ticket.create_external', 'ticket.process_external']::TEXT[],
    false,
    ARRAY[]::TEXT[],
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
