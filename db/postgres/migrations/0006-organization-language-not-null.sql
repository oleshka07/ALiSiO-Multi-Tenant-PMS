-- The hotel's base language is not optional, and migrated databases said it was.
--
-- Migration 0003 added the column the way a migration usually does:
--
--   ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "language" TEXT;
--
-- nullable, no default — because adding a NOT NULL column to a table with rows
-- in it needs a value for those rows, and 0003 did not stop to pick one.
-- db/postgres/schema.sql, meanwhile, declares it `TEXT DEFAULT 'uk' NOT NULL`.
-- So a database loaded from the schema and a database brought up by migrations
-- disagree about the same column, which is the kind of difference that is
-- invisible until something depends on it.
--
-- Nothing is visibly broken today: parseLanguage() falls back to the default
-- when it is handed NULL, which is why this went unnoticed. The reason to close
-- it anyway is that the fallback is in one code path and the column is read by
-- several, and "the base language is never null" is either true everywhere or
-- it is not a thing anyone can rely on.
--
-- 'uk' as the backfill is the same choice schema.sql makes, and it is right for
-- the rows that exist: an organization created before there was a language
-- column was created by a Ukrainian-speaking operator. A hotel whose staff work
-- in another language sets it in Settings, or is provisioned with --language.
--
-- app_users.language stays nullable on purpose — there, NULL is meaningful: it
-- means "this person has not chosen, follow the hotel". Only the hotel's own
-- language has no such state.
--
-- Re-runnable.

BEGIN;

UPDATE "organizations" SET "language" = 'uk' WHERE "language" IS NULL;

ALTER TABLE "organizations" ALTER COLUMN "language" SET DEFAULT 'uk';
ALTER TABLE "organizations" ALTER COLUMN "language" SET NOT NULL;

COMMIT;
