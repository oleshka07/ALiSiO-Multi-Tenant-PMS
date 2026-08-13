-- The price matrix: what a night costs at a given occupancy.
--
-- `price_calendar` has `base_price` and `weekend_price` and nothing else. For
-- the German market that is not a gap but a blocker: the same double room is
-- sold to one person at one price and to two at another, and both are the same
-- category, the same room, the same bed. DIRS21 sends prices per occupancy.
--
--   OCCUPANCY CHANGES THE PRICE, NEVER THE CATEGORY.
--
-- A model where "EZ" is its own category would make a hotel keep two room
-- lists for one set of rooms, and availability would be wrong on the first
-- booking that used either of them.
--
-- Nothing here replaces price_calendar. That table carries what a channel
-- manager writes — per-day restrictions (min_stay, closed, CTA/CTD) and the
-- rates PriceLabs pushes. This one carries what the owner types. Merging them
-- would mean an automatic sync overwriting a rate card.
--
-- Nullable on purpose:
--   unit_type_id  NULL = any type in this property, a house-wide price that a
--                 type-specific row overrides.
--   valid_from/to NULL = open-ended. A season is entered as a narrower row
--                 laid OVER the standing price, never by editing it.
--   persons (tiers) NULL = the discount applies at any occupancy.
--
-- property_id sits on the row rather than being derived through the unit type,
-- because a house-wide row has no unit type to derive it from — and an
-- organization with two hotels must not price one of them from the other.
--
-- Which row wins is decided in pricing/domain/occupancy-price.ts, and it is
-- decided there once for the calendar, the widget and the channel export.
--
-- Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS "price_occupancy" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"     TEXT REFERENCES "properties"("id") ON DELETE CASCADE,
  "unit_type_id"    TEXT REFERENCES "unit_types"("id") ON DELETE CASCADE,
  "persons"         BIGINT NOT NULL,
  "price_gross"     NUMERIC(14,2) NOT NULL DEFAULT 0,
  "valid_from"      DATE,
  "valid_to"        DATE,
  "label"           TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "price_los_tiers" (
  "id"               TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id"  TEXT REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"      TEXT REFERENCES "properties"("id") ON DELETE CASCADE,
  "unit_type_id"     TEXT REFERENCES "unit_types"("id") ON DELETE CASCADE,
  "min_nights"       BIGINT NOT NULL,
  "adjustment_gross" NUMERIC(14,2) NOT NULL DEFAULT 0,
  "persons"          BIGINT,
  "label"            TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two rows answering one question ("this type, this occupancy, this day") is
-- how a price becomes a matter of insertion order. COALESCE rather than the
-- bare columns because the duplicate worth stopping is precisely the one with
-- NULLs in it — the house-wide, open-ended row — and a UNIQUE index does not
-- constrain NULLs. The date sentinels are dates, not '': these columns are
-- DATE here and TEXT in SQLite, and COALESCE(date, '') does not typecheck.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_price_occupancy_row"
  ON "price_occupancy" ("organization_id", "property_id", (COALESCE("unit_type_id", '')),
                        "persons", (COALESCE("valid_from", '0001-01-01')), (COALESCE("valid_to", '9999-12-31')));
CREATE INDEX IF NOT EXISTS "idx_price_occupancy_lookup"
  ON "price_occupancy" ("organization_id", "property_id", "unit_type_id", "persons");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_price_los_tiers_row"
  ON "price_los_tiers" ("organization_id", "property_id", (COALESCE("unit_type_id", '')),
                        "min_nights", (COALESCE("persons", -1)));
CREATE INDEX IF NOT EXISTS "idx_price_los_tiers_lookup"
  ON "price_los_tiers" ("organization_id", "property_id", "unit_type_id");

DO $$
DECLARE tbl text; r text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['price_occupancy','price_los_tiers'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "organization_id" SET DEFAULT NULLIF(current_setting(''app.organization_id'', true), '''')', tbl);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("organization_id" = current_setting(''app.organization_id'')) WITH CHECK ("organization_id" = current_setting(''app.organization_id''))',
      tbl || '_tenant', tbl);
    -- Granted to whoever can already read reservations: that is the
    -- application role, whatever it is called in this installation.
    FOR r IN
      SELECT DISTINCT grantee FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'reservations'
         AND privilege_type = 'SELECT' AND grantee <> current_user
    LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', tbl, r);
    END LOOP;
  END LOOP;
END $$;

-- ── Two columns whose type was wrong, from the same generator gap ────────────
--
-- The generator decides a column is money by its NAME, and its list of money
-- words did not include `gross` or `net`. So `fin_channel_receivables.
-- expected_net` came out DOUBLE PRECISION — a float, for a figure that is
-- reconciled against a bank statement to the cent. `adjustment_gross` above
-- would have been the third.
--
-- And `fin_tax_rates.valid_to` came out TEXT while `valid_from` beside it came
-- out DATE, because only `valid_from` was in the date list. One end of a
-- validity window that cannot be compared with the other is a bug waiting for
-- the first rate change.
--
-- Both are corrected in scripts/pg-schema.mjs, so a database built fresh from
-- schema.sql gets them right; these ALTERs are for one already running.
--
-- Each one asks what the column is now, because a USING clause is written for
-- the OLD type and stops making sense once the change is in place: run
-- `USING NULLIF(valid_to, '')::date` against a column that is already a date
-- and Postgres tries to compare a date with an empty string and fails. That is
-- how a migration passes on the first server and breaks the second.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fin_channel_receivables'
       AND column_name = 'expected_net' AND data_type <> 'numeric'
  ) THEN
    ALTER TABLE "fin_channel_receivables"
      ALTER COLUMN "expected_net" TYPE NUMERIC(14,2) USING ROUND("expected_net"::numeric, 2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fin_tax_rates'
       AND column_name = 'valid_to' AND data_type <> 'date'
  ) THEN
    ALTER TABLE "fin_tax_rates"
      ALTER COLUMN "valid_to" TYPE DATE USING NULLIF(TRIM("valid_to"), '')::date;
  END IF;
END $$;

COMMIT;
