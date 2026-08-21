-- The till signs what it takes — or says, out loud, that it could not.
--
-- TSE Block B (docs/TSE-KASSENSICHV.md §6.4). Three pieces:
--
--   the SIGNATURE lands on the payment row — §6 KassenSichV wants it on the
--   beleg, and fin_folio_payments IS the beleg's fact of payment;
--
--   fin_fiscal_settings names the property's TSE — tss_id and client_id are
--   IDENTIFIERS, not secrets (api key and secret live in channel_credentials
--   like every other integration), plus the recording-system serial that §6
--   prints and the ELSTER registration names — one value, two consumers;
--
--   fin_fiscal_outages is the outage journal a Betriebsprüfung asks for:
--   when the TSE was unreachable, from when to when. A failed signature does
--   NOT block the guest's checkout — but it never passes silently either:
--   the payment carries tse_status='tse_failed' and the outage has a row.
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_status" TEXT;
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_serial" TEXT;
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_tx_number" TEXT;
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_signature_counter" TEXT;
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_signature" TEXT;
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_start_time" TEXT;
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_end_time" TEXT;
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_qr_payload" TEXT;
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_client_id" TEXT;
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_process_type" TEXT;
ALTER TABLE "fin_folio_payments" ADD COLUMN IF NOT EXISTS "tse_process_data" TEXT;

CREATE TABLE IF NOT EXISTS "fin_fiscal_settings" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT CONSTRAINT "fk_fin_fiscal_settings_organization_id_2"
                      REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"     TEXT NOT NULL CONSTRAINT "fk_fin_fiscal_settings_property_id_1"
                      REFERENCES "properties"("id") ON DELETE CASCADE,
  "tss_id"          TEXT,
  "tse_client_id"   TEXT,
  -- §6 Nr. 2: Seriennummer des elektronischen Aufzeichnungssystems. The same
  -- value the hotel writes into the ELSTER Kassenmeldung.
  "recording_system_serial" TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_fin_fiscal_settings_row"
  ON "fin_fiscal_settings" ("property_id");
CREATE INDEX IF NOT EXISTS "idx_fin_fiscal_settings_org"
  ON "fin_fiscal_settings" ("organization_id");

CREATE TABLE IF NOT EXISTS "fin_fiscal_outages" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT CONSTRAINT "fk_fin_fiscal_outages_organization_id_2"
                      REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"     TEXT CONSTRAINT "fk_fin_fiscal_outages_property_id_1"
                      REFERENCES "properties"("id") ON DELETE CASCADE,
  "started_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ended_at"        TIMESTAMPTZ,
  "note"            TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fin_fiscal_outages_org"
  ON "fin_fiscal_outages" ("organization_id", "started_at");

DO $$
DECLARE tbl text; r text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['fin_fiscal_settings','fin_fiscal_outages'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "organization_id"
      SET DEFAULT NULLIF(current_setting(''app.organization_id'', true), '''')', tbl);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant', tbl);
    EXECUTE format('CREATE POLICY %I ON %I
      USING ("organization_id" = current_setting(''app.organization_id''))
      WITH CHECK ("organization_id" = current_setting(''app.organization_id''))',
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
