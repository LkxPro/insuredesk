-- Fix workOrderNumber generation past 6 digits (PRD §9.3).
--
-- The previous default used lpad(…, 6, '0'), and Postgres lpad TRUNCATES
-- strings longer than the target length: once the sequence passed 999999,
-- every 7-digit value would collapse to its first 6 characters, colliding on
-- the unique index and permanently breaking ticket creation. The sequence
-- starts at 100001, so values are always ≥6 digits and plain concatenation
-- yields the exact same numbers today without the truncation cliff.

-- AlterTable
ALTER TABLE "tickets" ALTER COLUMN "workOrderNumber" SET DEFAULT ('WO' || (nextval('work_order_number_seq'))::text);
