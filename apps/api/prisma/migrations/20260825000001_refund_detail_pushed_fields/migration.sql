ALTER TABLE "ticket_refund_details"
    ADD COLUMN IF NOT EXISTS "pushedFields" TEXT[] NOT NULL DEFAULT '{}';
