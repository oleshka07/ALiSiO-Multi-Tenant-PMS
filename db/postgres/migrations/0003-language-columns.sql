-- The two columns multilingual ALiSiO hangs on.
--
-- app_users.language is one person's override; organizations.language is the
-- hotel's base language, which everyone follows when they have not chosen.
-- Both were added to SQLite after beta's Postgres schema had been loaded, and
-- the first import would have copied every row without them and reported the
-- loss afterwards. pg-import now refuses instead — this is what it asks for.
--
-- db/postgres/schema.sql generates both; a database created from it since the
-- Czech work landed already has them. This is for one created before.
-- Re-runnable.

BEGIN;

ALTER TABLE "app_users"     ADD COLUMN IF NOT EXISTS "language" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "language" TEXT;

COMMIT;
