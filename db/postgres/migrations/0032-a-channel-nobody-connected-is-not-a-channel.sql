-- A channel nobody connected is not a channel.
--
-- The Connectivity API of Booking.com lived here as roughly 3 500 lines of
-- code and six tables: OAuth token exchange, a rate limiter, an OTA-XML
-- builder and parser, an ARI queue with retries, a room-type mapping screen
-- and a request log keyed by Booking's RUID. It was never connected to a live
-- account. Not «not yet in production» — never at all: the six tables below
-- are empty on every database this project has, the settings screen for it
-- rendered a form that pointed at an environment variable nobody set, and the
-- ARI push priced nights from `price_calendar` alone with its own private copy
-- of the weekend rule, so the first hotel that had ever switched it on would
-- have sold rooms at prices its own widget disagreed with (audit A2).
--
-- The owner's decision is to build the reliable core first and attach channels
-- to it later, carefully, from the outside. Dead code with its own schema, its
-- own auth path and its own pricing rules is the opposite of that: it costs
-- attention at every audit, it holds an org-scoped table hostage in the RLS
-- registry, and it is exactly the kind of half-finished thing that later gets
-- switched on by somebody who assumes it works because it is there.
--
-- So it goes. What stays, and why:
--
--   channel_credentials — outlived its origin. The German fiscalisation keys
--     (fiskaly SIGN DE) are stored there through @core/integration-credentials,
--     and one TSS signs for one taxpayer, so the row must stay tenant-scoped.
--   channel_rate_rules — never belonged to this module. It is the finance
--     rule for what an OTA's single figure contains (breakfast, commission)
--     and it is read when an invoice is built, not when a channel syncs.
--   reservations.source = 'booking_com' — a fact about where a booking came
--     from. Historical bookings keep it, the badge keeps rendering it, and the
--     source list keeps offering it for manual entry. We are deleting an
--     integration, not rewriting what happened.
--
-- The four reservation columns dropped below are the wire format of the
-- Connectivity API and nothing else — no screen reads them, no importer writes
-- them, and no row anywhere has a value in them. `promotions_applied`,
-- `meal_plan` and `cancellation_policy` are NOT dropped: the booking widget
-- writes the first and the CSV export reads the other two.
--
-- If a database somewhere really did receive a reservation through this API,
-- the guard below stops the migration and says so, rather than dropping the
-- evidence quietly.
DO $$
DECLARE n BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reservations' AND column_name = 'bcom_reservation_id'
  ) THEN
    EXECUTE 'SELECT COUNT(*) FROM "reservations" WHERE "bcom_reservation_id" IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'Migration 0032 stopped: % reservation(s) carry a bcom_reservation_id. The Connectivity API was believed unused. Export these rows before continuing.', n;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS "ari_sync_log" CASCADE;
DROP TABLE IF EXISTS "ari_sync_queue" CASCADE;
DROP TABLE IF EXISTS "channel_room_mapping" CASCADE;
DROP TABLE IF EXISTS "channel_connections" CASCADE;

-- Hostex left these behind when it was removed; they were never in the RLS
-- registry and never scoped to an organization, which is its own reason.
DROP TABLE IF EXISTS "hostex_sync_log" CASCADE;
DROP TABLE IF EXISTS "hostex_property_map" CASCADE;

ALTER TABLE "reservations" DROP COLUMN IF EXISTS "bcom_reservation_id";
ALTER TABLE "reservations" DROP COLUMN IF EXISTS "price_per_night_json";
ALTER TABLE "reservations" DROP COLUMN IF EXISTS "smoking_preference";
ALTER TABLE "reservations" DROP COLUMN IF EXISTS "rate_rewriting_info";

-- And the same sweep for the Telegram bridge, removed a few days earlier.
-- That removal took the table out of `src/lib/db.ts` and out of `schema.sql`,
-- which is enough for a new customer and nothing at all for the two databases
-- that already exist: a schema file is a description, not an instruction. The
-- drift was invisible until `check-fresh-schema.mjs` was pointed at a database
-- that had lived through the change. Deleting code is only half of deleting a
-- feature — this is the other half, and it is the half that gets forgotten.
DROP TABLE IF EXISTS "tg_booking_messages" CASCADE;
ALTER TABLE "app_users" DROP COLUMN IF EXISTS "telegram_chat_id";
