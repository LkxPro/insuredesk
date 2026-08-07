-- Split the legacy external field whitelist into independently ordered list and
-- detail/search/export surfaces. Existing accounts inherit the old selection on
-- both surfaces so an upgrade never widens what they can see.
ALTER TABLE "users" RENAME COLUMN "visibleTicketFields" TO "externalDetailFields";
ALTER TABLE "users" ADD COLUMN "externalListFields" TEXT;
UPDATE "users"
SET "externalListFields" = "externalDetailFields"
WHERE "externalDetailFields" IS NOT NULL;

CREATE TABLE "external_account_field_audits" (
    "id" TEXT NOT NULL,
    "targetAccountId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT,
    "grantedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revokedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "external_account_field_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_account_field_audits_targetAccountId_at_idx"
ON "external_account_field_audits"("targetAccountId", "at");

CREATE INDEX "external_account_field_audits_actorId_at_idx"
ON "external_account_field_audits"("actorId", "at");
