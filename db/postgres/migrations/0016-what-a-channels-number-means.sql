-- What a channel's number means, and what we send it.
--
-- Booking.com and its kin send one figure — "91,05 € for this stay". A German
-- invoice cannot print that: it has to say how much was accommodation, how
-- much was breakfast food and how much was breakfast drinks, because those
-- three carry different VAT and a tax office reads them separately.
--
-- Reception at the pilot does that arithmetic by hand for every channel
-- booking. It is the most repeated calculation of their day and the one most
-- likely to be wrong, because the split depends on how many people slept
-- there.
--
-- A row here says, for one channel: whether its price includes breakfast, what
-- breakfast costs per person per night split into food and drink, which tax
-- ROLE each part carries, and what markup goes on the rate card when prices
-- are pushed to that channel.
--
-- `channel` NULL is the default — the arrangement that applies to any channel
-- without a row of its own, so a hotel with one policy writes one row and not
-- six.
--
-- Tax ROLES, not percentages: 'standard' / 'reduced' / 'zero' point at
-- fin_tax_rates, which holds the numbers and the dates they changed. German
-- hospitality moved food to 7% on 2026-01-01; a 19 written into this table
-- would still say 19 in 2031.
--
-- Nothing here is a number this code knows. A hotel whose rates never include
-- breakfast has no rows and nothing changes for it.
--
-- Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "channel_rate_rules" (
  "id"                     TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id"        TEXT REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"            TEXT REFERENCES "properties"("id") ON DELETE CASCADE,
  "channel"                TEXT,
  "includes_breakfast"     BOOLEAN NOT NULL DEFAULT false,
  "breakfast_food_price"   NUMERIC(14,2) NOT NULL DEFAULT 0,
  "breakfast_drinks_price" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "lodging_tax_code"       TEXT NOT NULL DEFAULT 'reduced',
  "food_tax_code"          TEXT NOT NULL DEFAULT 'reduced',
  "drinks_tax_code"        TEXT NOT NULL DEFAULT 'standard',
  "markup_percent"         NUMERIC(5,2) NOT NULL DEFAULT 0,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One rule per channel per property. Two rules for one channel would mean the
-- same booking splits differently depending on which row was read first.
-- COALESCE because the default row — the one with no channel — is exactly the
-- one a plain UNIQUE index would not constrain.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_channel_rate_rules_row"
  ON "channel_rate_rules" ("organization_id", "property_id", (COALESCE("channel", '')));

DO $$
DECLARE r text;
BEGIN
  ALTER TABLE "channel_rate_rules" ALTER COLUMN "organization_id"
    SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');
  ALTER TABLE "channel_rate_rules" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "channel_rate_rules" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "channel_rate_rules_tenant" ON "channel_rate_rules";
  CREATE POLICY "channel_rate_rules_tenant" ON "channel_rate_rules"
    USING ("organization_id" = current_setting('app.organization_id'))
    WITH CHECK ("organization_id" = current_setting('app.organization_id'));

  -- Granted to whoever can already read reservations: that is the application
  -- role, whatever it is called in this installation.
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON "channel_rate_rules" TO %I', r);
  END LOOP;
END $$;

-- ── A percentage is not a float ─────────────────────────────────────────────
--
-- The generator decided a column's type from its name and had no rule for
-- percentages, so three of them were listed by hand and the rest came out
-- DOUBLE PRECISION. `site_rate_plans.pricing_modifier_percent` is one: a rate
-- plan that takes 19.9% off stores the modifier as 19.899999999999999, and
-- every price it touches is a fraction out.
--
-- Now matched by name in scripts/pg-schema.mjs, so a fresh database is right
-- from schema.sql. This ALTER is for one already running, and it asks what the
-- column is first — a USING clause written for the old type stops making sense
-- once the change is in place.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'site_rate_plans'
       AND column_name = 'pricing_modifier_percent' AND data_type <> 'numeric'
  ) THEN
    ALTER TABLE "site_rate_plans"
      ALTER COLUMN "pricing_modifier_percent" TYPE NUMERIC(5,2)
      USING ROUND("pricing_modifier_percent"::numeric, 2);
  END IF;
END $$;

COMMIT;
