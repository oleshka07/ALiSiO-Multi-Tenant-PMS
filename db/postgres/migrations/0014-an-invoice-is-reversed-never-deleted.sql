-- Invoices learn about reversal.
--
-- `CHECK (status IN ('issued','cancelled'))` and no link from a reversal to
-- the document it reverses. Both come from a time when a wrong invoice was
-- deleted.
--
-- A German invoice is never deleted and never edited: it is reversed by a
-- second document that mirrors it, and the pair stays in the books forever
-- (GoBD). That needs two statuses the CHECK refused — `storno` for the mirror,
-- `corrected` for the original it cancels — and a column saying which document
-- a reversal belongs to.
--
-- Nothing is rewritten: every existing invoice keeps `issued` or `cancelled`.
--
-- Re-runnable.

BEGIN;

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "corrects_invoice_id" TEXT;

-- Drop the constraint by what it CHECKS rather than by a generated name, which
-- differs between a database built from schema.sql and one grown by migrations.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'invoices' AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE "invoices" DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_check"
  CHECK ("status" IN ('issued', 'cancelled', 'storno', 'corrected'));

CREATE INDEX IF NOT EXISTS "idx_invoices_corrects" ON "invoices" ("corrects_invoice_id");

COMMIT;
