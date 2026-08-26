-- A calendar feed nobody can read shows nothing — and the OTA sells the room again.
--
-- `/api/ical-export/<token>` is the URL a hotel pastes into Booking.com or
-- Airbnb so the channel sees which dates are taken. It is opened with no
-- session: the token in the path is the credential, exactly like the guest
-- page link. `src/proxy.ts` documents it that way.
--
-- What the handler did was read `ical_channels` by `export_token` on a plain
-- connection. On SQLite that works, because there are no policies. On Postgres
-- `scopeToTenant()` sets `app.organization_id` and `app.public_token` on every
-- checkout, and with no ambient context both are the empty string — so the
-- policy on `ical_channels`, which only compared the row's property against
-- `app.organization_id`, matched nothing. The handler read that as «no such
-- channel» and answered 200 with an empty VCALENDAR. For every valid token.
--
-- So the feed was not broken loudly: it was correct XML describing a hotel
-- with no bookings. Booking.com and Airbnb kept every date open, and the room
-- was available to sell twice. Locally it always worked, which is why nothing
-- pointed at it. Proven on a real Postgres before this migration was written:
-- one row in the table, application role with an empty context reads 0, with
-- the right tenant reads 1.
--
-- Two things change here.
--
-- 1. The channel carries its tenant. `property_id` reaches the organization
--    through `properties`, but that table's own policy is closed inside the
--    token context, so the chain cannot be walked from where the feed stands.
--    The column is what lets the handler switch into the hotel and read the
--    units, buildings and reservations the calendar is made of.
--
-- 2. The read policy accepts the token, the write policy does not. This is the
--    same shape `reservations.guest_page_token` and `partner_reports.token`
--    already have (`PUBLIC_TOKEN_READ` in scripts/pg-schema.mjs, updated in the
--    same commit so a regenerated schema keeps this). A token opens one row
--    for reading; changing anything still requires being the hotel.

ALTER TABLE "ical_channels" ADD COLUMN IF NOT EXISTS "organization_id" TEXT
  REFERENCES "organizations"("id") ON DELETE CASCADE;

-- Existing rows: the tenant is whoever owns the property the channel hangs on.
UPDATE "ical_channels" c
   SET "organization_id" = p."organization_id"
  FROM "properties" p
 WHERE p."id" = c."property_id"
   AND c."organization_id" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_ical_channels_org"
  ON "ical_channels" ("organization_id");

-- Read: this hotel's rows, or the single row whose export token is on the
-- connection. Write: this hotel's rows only.
DROP POLICY IF EXISTS "ical_channels_tenant" ON "ical_channels";

CREATE POLICY "ical_channels_tenant" ON "ical_channels"
  USING (
    "property_id" IN (SELECT "id" FROM "properties"
                       WHERE "organization_id" = current_setting('app.organization_id'))
    OR "export_token" = NULLIF(current_setting('app.public_token', true), '')
  )
  WITH CHECK (
    "property_id" IN (SELECT "id" FROM "properties"
                       WHERE "organization_id" = current_setting('app.organization_id'))
  );
