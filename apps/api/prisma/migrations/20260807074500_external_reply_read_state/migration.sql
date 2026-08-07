CREATE TABLE "external_ticket_read_states" (
    "userId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "lastReadReplyAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "external_ticket_read_states_pkey" PRIMARY KEY ("userId", "ticketId")
);

CREATE INDEX "external_ticket_read_states_ticketId_idx"
ON "external_ticket_read_states"("ticketId");

ALTER TABLE "external_ticket_read_states"
ADD CONSTRAINT "external_ticket_read_states_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_ticket_read_states"
ADD CONSTRAINT "external_ticket_read_states_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
