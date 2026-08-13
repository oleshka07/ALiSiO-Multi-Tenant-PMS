-- The frozen half of the invoice: its lines and its VAT recapitulation.
--
-- A folio item can still be corrected; an invoice line never can. When the
-- document is issued, everything it prints is copied onto its own rows — the
-- description, the guest's name, the room number, the quantity, the price and
-- the rate that was in force.
--
-- Deliberately NO foreign key to the service, the price list or fin_tax_rates.
-- A German invoice must be reproducible for ten years (GoBD), and by then the
-- service may be renamed, the rate changed and the room gone. A join would
-- make the document depend on data that is allowed to move.
--
-- fin_invoice_tax_totals is the MwSt-Übersicht block, one row per rate, holding
-- the GROUP figures. Those differ from the sum of the line nets by a cent, and
-- that is correct — see invoice-vat.check.ts, which asserts both against a real
-- invoice the customer's Steuerberater has accepted.
--
-- Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "fin_invoice_lines" (
  "id"               TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id"  TEXT REFERENCES "organizations"("id") ON DELETE CASCADE,
  "invoice_id"       TEXT NOT NULL,
  "position"         BIGINT NOT NULL DEFAULT 0,
  "service_date"     DATE,
  "description"      TEXT NOT NULL,
  "guest_name"       TEXT,
  "unit_code"        TEXT,
  "quantity"         NUMERIC(12,3) NOT NULL DEFAULT 1,
  "unit_price_gross" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "total_gross"      NUMERIC(14,2) NOT NULL DEFAULT 0,
  "net_amount"       NUMERIC(14,2) NOT NULL DEFAULT 0,
  "tax_amount"       NUMERIC(14,2) NOT NULL DEFAULT 0,
  "vat_rate"         NUMERIC(5,2) NOT NULL DEFAULT 0,
  "source_item_id"   TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fin_invoice_tax_totals" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE CASCADE,
  "invoice_id"      TEXT NOT NULL,
  "vat_rate"        NUMERIC(5,2) NOT NULL,
  "label"           TEXT,
  "gross_amount"    NUMERIC(14,2) NOT NULL DEFAULT 0,
  "net_amount"      NUMERIC(14,2) NOT NULL DEFAULT 0,
  "tax_amount"      NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "idx_fin_invoice_lines_invoice"
  ON "fin_invoice_lines" ("invoice_id", "position");
-- One row per rate per document: a second row for the same rate would print
-- the recapitulation twice and total it wrong.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_fin_invoice_tax_totals_rate"
  ON "fin_invoice_tax_totals" ("invoice_id", "vat_rate");

DO $$
DECLARE tbl text; r text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['fin_invoice_lines','fin_invoice_tax_totals'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "organization_id" SET DEFAULT NULLIF(current_setting(''app.organization_id'', true), '''')', tbl);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organization_id" = current_setting(''app.organization_id'')) WITH CHECK ("organization_id" = current_setting(''app.organization_id''))',
      tbl || '_tenant', tbl);
    FOR r IN
      SELECT DISTINCT grantee FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'reservations'
         AND privilege_type = 'SELECT' AND grantee <> current_user
    LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', tbl, r);
    END LOOP;
  END LOOP;
END $$;

COMMIT;
