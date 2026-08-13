-- The running bill of a stay, kept apart from the invoice.
--
-- A folio accumulates charges while the guest is here; an invoice is a frozen
-- snapshot of part of it. Separating them is what makes five things possible
-- at once, each of them a real request from the German pilot:
--
--   - charges added during the stay without "redoing the bill";
--   - an invoice issued mid-stay, because the guest pays on arrival;
--   - two payers on one booking — the company takes the nights, the guest the
--     bar. That is why a booking may have SEVERAL folios;
--   - one monthly invoice to a company covering folios of many bookings;
--   - corrections that destroy nothing: an invoice is reversed, never edited.
--
-- Two decisions worth stating, because both look like duplication:
--
--   payer_*   a SNAPSHOT, not a foreign key. A company that changes address
--             next year must not change the invoice it was sent last year.
--   vat_rate  a NUMBER on the row, not a link to fin_tax_rates. The rate in
--             force is chosen once, when the charge is made, and frozen.
--             Otherwise a rate change restates old documents.
--
-- service_date is the Leistungsdatum: it decides the VAT rate and which day
-- report the charge belongs to. Not created_at — a bar tab entered next
-- morning still belongs to last night.
--
-- Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "fin_folios" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE CASCADE,
  "reservation_id"  TEXT REFERENCES "reservations"("id") ON DELETE SET NULL,
  "payer_kind"      TEXT NOT NULL DEFAULT 'guest' CHECK ("payer_kind" IN ('guest','company')),
  "guest_id"        TEXT,
  "payer_name"      TEXT,
  "payer_address"   TEXT,
  "payer_vat_no"    TEXT,
  "payer_debtor_no" TEXT,
  "status"          TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','settled')),
  "label"           TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fin_folio_items" (
  "id"                TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id"   TEXT REFERENCES "organizations"("id") ON DELETE CASCADE,
  "folio_id"          TEXT REFERENCES "fin_folios"("id") ON DELETE CASCADE,
  "reservation_id"    TEXT REFERENCES "reservations"("id") ON DELETE SET NULL,
  "service_date"      DATE NOT NULL,
  "kind"              TEXT NOT NULL CHECK ("kind" IN ('lodging','service','fee','city_tax','manual')),
  "description"       TEXT NOT NULL,
  "guest_name"        TEXT,
  "unit_code"         TEXT,
  "quantity"          NUMERIC(12,3) NOT NULL DEFAULT 1,
  "unit_price_gross"  NUMERIC(14,2) NOT NULL DEFAULT 0,
  "total_gross"       NUMERIC(14,2) NOT NULL DEFAULT 0,
  "vat_rate"          NUMERIC(5,2) NOT NULL DEFAULT 0,
  "source"            TEXT NOT NULL DEFAULT 'manual'
                      CHECK ("source" IN ('nightly','ota_split','manual','restaurant','import')),
  "voided_by_item_id" TEXT,
  "invoice_id"        TEXT,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fin_folios_res" ON "fin_folios" ("reservation_id");
CREATE INDEX IF NOT EXISTS "idx_fin_folios_org" ON "fin_folios" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "idx_fin_folio_items_folio" ON "fin_folio_items" ("folio_id");
CREATE INDEX IF NOT EXISTS "idx_fin_folio_items_date" ON "fin_folio_items" ("organization_id", "service_date");
CREATE INDEX IF NOT EXISTS "idx_fin_folio_items_invoice" ON "fin_folio_items" ("invoice_id");

DO $$
DECLARE tbl text; r text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['fin_folios','fin_folio_items'] LOOP
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
