-- A service may point at any category this hotel actually has.
--
-- `additional_services.available_for` carried
--   CHECK (available_for IN ('glamping','resort','camping','all'))
-- — a dictionary of one customer's business words, in the schema. NAMING.md §9
-- forbids exactly this, and it is not cosmetic: a German hotel, a hostel or a
-- pension cannot point a service at its own category, because the database
-- refuses any value outside those three. The widget already worked around it by
-- reading only 'all'.
--
-- The column stays and keeps its meaning — "this category type, or all". Only
-- the closed list goes. Nothing is rewritten: rows holding 'glamping' or 'all'
-- keep their values and keep working.
--
-- Re-runnable.

BEGIN;

ALTER TABLE "additional_services" DROP CONSTRAINT IF EXISTS "additional_services_available_for_check";

-- The constraint's generated name differs between databases built from
-- schema.sql and ones grown by migrations, so drop by what it CHECKS rather
-- than by a name we would have to guess.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'additional_services'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%available_for%'
  LOOP
    EXECUTE format('ALTER TABLE "additional_services" DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

COMMIT;
