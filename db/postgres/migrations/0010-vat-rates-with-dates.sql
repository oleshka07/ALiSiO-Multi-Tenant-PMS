-- What VAT this organization charges, and since when.
--
-- The date matters as much as the number. German hospitality moved food to the
-- reduced rate on 2026-01-01, so a breakfast served on 31 December is 19% and
-- the same breakfast on 1 January is 7% — on documents that may be issued in
-- the same week. The rate is therefore chosen by the date of SERVICE and then
-- written onto the charge as a number; this table is consulted to pick, never
-- read back to re-derive an old document. That is what lets an invoice from
-- 2026 still print correctly in 2036, after every rate in the country has
-- changed.
--
-- `code` is the closed part: standard / reduced / zero says what ROLE a rate
-- plays, and a service points at the role. `rate` is the open part, and it is
-- per organization — Germany 19/7, Czechia 21/12, and whatever comes next.
-- Nothing in the application code knows those numbers.
--
-- No rows are seeded. A rate is a statement about somebody's tax position; the
-- hotel enters its own, and a wrong default is worse than an empty table
-- because it looks like an answer.
--
-- Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "fin_tax_rates" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE CASCADE,
  "code"            TEXT NOT NULL CHECK ("code" IN ('standard','reduced','zero')),
  "rate"            NUMERIC(5,2) NOT NULL,
  "label"           TEXT,
  "valid_from"      DATE NOT NULL,
  "valid_to"        DATE,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookups are always "this organization, this role, on this day".
CREATE INDEX IF NOT EXISTS "idx_fin_tax_rates_lookup"
  ON "fin_tax_rates" ("organization_id", "code", "valid_from");
CREATE INDEX IF NOT EXISTS "idx_fin_tax_rates_org"
  ON "fin_tax_rates" ("organization_id");

ALTER TABLE "fin_tax_rates" ALTER COLUMN "organization_id"
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

ALTER TABLE "fin_tax_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_tax_rates" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fin_tax_rates_tenant" ON "fin_tax_rates";
CREATE POLICY "fin_tax_rates_tenant" ON "fin_tax_rates"
  USING ("organization_id" = current_setting('app.organization_id'))
  WITH CHECK ("organization_id" = current_setting('app.organization_id'));

-- Grant to whoever can already read `reservations` — that is the application
-- role, whatever it is called on this server (see migration 0008).
DO $$
DECLARE r text;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON "fin_tax_rates" TO %I', r);
  END LOOP;
END $$;

COMMIT;
