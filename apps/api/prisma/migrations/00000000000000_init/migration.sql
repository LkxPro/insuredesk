-- Initial migration for the walking skeleton.
--
-- The schema has no domain models yet, so this migration creates no tables. It
-- exists so the `migrate deploy` pipeline is real and provable end-to-end: the
-- Testcontainers integration test asserts this migration is recorded in
-- `_prisma_migrations` against a real Postgres. Domain tables arrive with their
-- feature tickets.
SELECT 1;
