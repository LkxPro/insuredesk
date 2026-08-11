-- Drop visibleTicketFields column from users table
-- External accounts now show all ticket fields (including customer PII, which
-- comes from the external party's own submission).

ALTER TABLE "users" DROP COLUMN "visibleTicketFields";
