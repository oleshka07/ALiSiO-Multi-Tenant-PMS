-- A hall is rented by the hour, not slept in.
--
-- The pilot's second building block after rooms: Saal, kleiner Saal, Atrium,
-- Bar, Küche — rented «bis 2 h / bis 4 h / bis 8 h / über 8 h», with
-- per-person add-ons (Wasser 5, Frühstück 8, Kaffeepause 7 …) and flat ones
-- (Technikpaket 24, Flipchart 15). The owner's one requirement: «Preise sind
-- variabel — müssen manuell einpflegbar sein».
--
-- NOT reservations. A reservation counts nights and drags the whole stay
-- pipeline behind it — Meldeschein for guests that do not exist, Kurtaxe,
-- occupancy statistics, housekeeping tasks, pre-arrival mail to a company
-- that booked a projector. An event books a SPACE for a TIME RANGE and its
-- money flows through the folio backbone (fin_folios → invoice), which is
-- the part of the stay machinery that IS shared on purpose.

CREATE TABLE IF NOT EXISTS "event_spaces" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT CONSTRAINT "fk_event_spaces_organization_id_2"
                      REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"     TEXT NOT NULL CONSTRAINT "fk_event_spaces_property_id_1"
                      REFERENCES "properties"("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  "code"            TEXT NOT NULL,
  -- «max. 100; Kino 120» — words, not a number: capacity depends on seating.
  "capacity_note"   TEXT,
  -- Suggested gross prices per time block, JSON {"h2":49,"h4":79,"h8":119,"h8plus":149}.
  -- null/absent block = the hall is not offered for that duration.
  "block_prices"    TEXT,
  "sort_order"      BIGINT DEFAULT 0 NOT NULL,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_event_spaces_row"
  ON "event_spaces" ("property_id", "code");
CREATE INDEX IF NOT EXISTS "idx_event_spaces_org" ON "event_spaces" ("organization_id");

-- The add-on catalogue: what can be sold WITH a hall. Per person (Wasser 5 €),
-- flat (Flipchart 15 €), per hour (Sonderreinigung 35 €/h), per piece
-- (Tischdecke 5 €/Stück). The vat_code names a ROLE from fin_tax_rates, same
-- as everywhere else — hall catering will mostly be 'standard', and the final
-- word on the rent's own rate belongs to the Steuerberater, not this table.
CREATE TABLE IF NOT EXISTS "event_addons" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT CONSTRAINT "fk_event_addons_organization_id_2"
                      REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"     TEXT NOT NULL CONSTRAINT "fk_event_addons_property_id_1"
                      REFERENCES "properties"("id") ON DELETE CASCADE,
  "name"            TEXT NOT NULL,
  "kind"            TEXT NOT NULL,
  "price_gross"     NUMERIC(14,2) NOT NULL DEFAULT 0,
  "vat_code"        TEXT NOT NULL DEFAULT 'standard',
  -- «bis 30 Pers», «Tagespauschale 8-10h» — the sheet's own footnotes.
  "note"            TEXT,
  "sort_order"      BIGINT DEFAULT 0 NOT NULL,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("kind" IN ('per_person','flat','per_hour','per_piece'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_event_addons_row"
  ON "event_addons" ("property_id", "name");
CREATE INDEX IF NOT EXISTS "idx_event_addons_org" ON "event_addons" ("organization_id");

CREATE TABLE IF NOT EXISTS "event_bookings" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT CONSTRAINT "fk_event_bookings_organization_id_2"
                      REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"     TEXT NOT NULL CONSTRAINT "fk_event_bookings_property_id_1"
                      REFERENCES "properties"("id") ON DELETE CASCADE,
  "space_id"        TEXT NOT NULL CONSTRAINT "fk_event_bookings_space_id_3"
                      REFERENCES "event_spaces"("id") ON DELETE CASCADE,
  "event_date"      DATE NOT NULL,
  -- 'HH:MM', half-open [from, to): an event ending 12:00 and one starting
  -- 12:00 share a doorway, not the hall.
  "time_from"       TEXT NOT NULL,
  "time_to"         TEXT NOT NULL,
  "persons"         BIGINT DEFAULT 0 NOT NULL,
  "customer_name"   TEXT NOT NULL,
  "customer_email"  TEXT,
  "customer_phone"  TEXT,
  "company"         TEXT,
  "status"          TEXT NOT NULL DEFAULT 'confirmed',
  "notes"           TEXT,
  -- The running bill. Same backbone as a stay: folio → items → numbered
  -- invoice. Nullable — a draft may not have one yet.
  "folio_id"        TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("status" IN ('draft','confirmed','cancelled')),
  CHECK ("time_from" < "time_to")
);
CREATE INDEX IF NOT EXISTS "idx_event_bookings_day"
  ON "event_bookings" ("space_id", "event_date");
CREATE INDEX IF NOT EXISTS "idx_event_bookings_org" ON "event_bookings" ("organization_id");

-- An invoice for a folio with no reservation has no property to take its
-- jurisdiction from — the German renderer refused those on purpose
-- (invoice-document.repo.ts said this column would appear when events came).
-- Nullable: every existing folio reaches its property through the stay.
ALTER TABLE "fin_folios" ADD COLUMN IF NOT EXISTS "property_id" TEXT;

DO $$
DECLARE tbl text; r text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['event_spaces','event_addons','event_bookings'] LOOP
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
