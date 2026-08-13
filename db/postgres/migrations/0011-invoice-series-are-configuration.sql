-- Which runs of invoice numbers an organization keeps, and what each looks like.
--
-- The five series and their prefixes lived in a constant in
-- finance/domain/invoice-numbering.ts: booking → BKG-, airbnb → AIR-,
-- teya → TEYA-, cash/house → no prefix, all formatted `PREFIX-YYYY-NNN`. That
-- is one hotel's arrangement with its accountant, written into the product.
-- The German pilot's numbers look nothing like it.
--
-- A row here overrides the built-in map FOR THAT ORGANIZATION ONLY. An
-- organization with no rows keeps behaving exactly as before, character for
-- character — which is what makes this safe to apply while a customer is
-- issuing invoices through it. invoice-numbering.check.ts asserts both halves
-- on both engines.
--
-- Note for a migrating hotel: invoice_counters is keyed on the SERIES, so
-- naming a new series starts a new run at 1. Continuing a previous system's
-- numbering is a deliberate seeding of invoice_counters and a question for the
-- customer's accountant, not a default.
--
-- Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "invoice_series" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE CASCADE,
  "code"            TEXT NOT NULL,
  "channel"         TEXT,
  "prefix"          TEXT NOT NULL DEFAULT '',
  "number_format"   TEXT NOT NULL DEFAULT '{prefix}{year}-{seq:3}',
  "reset_yearly"    BOOLEAN NOT NULL DEFAULT true,
  "is_default"      BOOLEAN NOT NULL DEFAULT false,
  "sort_order"      BIGINT NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One series per code per hotel: two rows sharing a code would be two counters
-- answering to one name, which is duplicate invoice numbers.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoice_series_code"
  ON "invoice_series" ("organization_id", "code");
CREATE INDEX IF NOT EXISTS "idx_invoice_series_channel"
  ON "invoice_series" ("organization_id", "channel");
CREATE INDEX IF NOT EXISTS "idx_invoice_series_org"
  ON "invoice_series" ("organization_id");

ALTER TABLE "invoice_series" ALTER COLUMN "organization_id"
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE "invoice_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_series" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_series_tenant" ON "invoice_series";
CREATE POLICY "invoice_series_tenant" ON "invoice_series"
  USING ("organization_id" = current_setting('app.organization_id'))
  WITH CHECK ("organization_id" = current_setting('app.organization_id'));

DO $$
DECLARE r text;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON "invoice_series" TO %I', r);
  END LOOP;
END $$;

COMMIT;
