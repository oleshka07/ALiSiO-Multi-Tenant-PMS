-- A day of cash is closed once, and stays closed.
--
-- TSE Block D (docs/TSE-KASSENSICHV.md §6.4). The Kassenabschluss is a
-- RECORD, not a report: DSFinV-K is built around the closing as an entity
-- with a number, and a report recomputed on every view could tell a
-- different story on every view. The row freezes what the till held when
-- the day was closed — cash and card-at-the-desk separately, because they
-- are different Zahlartn in the export even though both count as till
-- turnover.
--
-- One closing per property per day (UNIQUE) — closing twice is refused,
-- not merged. NOT the day-sheets Tagesabschluss: same word, different
-- thing; that one is an operational morning list and stays as it is.
CREATE TABLE IF NOT EXISTS "fin_cash_closings" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT CONSTRAINT "fk_fin_cash_closings_organization_id_2"
                      REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"     TEXT NOT NULL CONSTRAINT "fk_fin_cash_closings_property_id_1"
                      REFERENCES "properties"("id") ON DELETE CASCADE,
  "closing_date"    DATE NOT NULL,
  -- Sequential per property, assigned at closing: DSFinV-K's Z_NR.
  "closing_number"  BIGINT NOT NULL,
  "cash_total"      NUMERIC(14,2) NOT NULL DEFAULT 0,
  "card_total"      NUMERIC(14,2) NOT NULL DEFAULT 0,
  "payments_count"  BIGINT NOT NULL DEFAULT 0,
  "signed_count"    BIGINT NOT NULL DEFAULT 0,
  "failed_count"    BIGINT NOT NULL DEFAULT 0,
  "first_payment_at" TIMESTAMPTZ,
  "last_payment_at" TIMESTAMPTZ,
  "closed_by"       TEXT,
  "notes"           TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_fin_cash_closings_row"
  ON "fin_cash_closings" ("property_id", "closing_date");
CREATE INDEX IF NOT EXISTS "idx_fin_cash_closings_org"
  ON "fin_cash_closings" ("organization_id", "closing_date");

DO $$
DECLARE r text;
BEGIN
  EXECUTE 'ALTER TABLE fin_cash_closings ALTER COLUMN "organization_id"
    SET DEFAULT NULLIF(current_setting(''app.organization_id'', true), '''')';
  EXECUTE 'ALTER TABLE fin_cash_closings ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE fin_cash_closings FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS fin_cash_closings_tenant ON fin_cash_closings';
  EXECUTE 'CREATE POLICY fin_cash_closings_tenant ON fin_cash_closings
    USING ("organization_id" = current_setting(''app.organization_id''))
    WITH CHECK ("organization_id" = current_setting(''app.organization_id''))';
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON fin_cash_closings TO %I', r);
  END LOOP;
END $$;
