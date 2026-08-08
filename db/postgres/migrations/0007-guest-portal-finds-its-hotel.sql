-- The guest portal can find the booking whose link the guest is holding.
--
-- A guest is not a tenant. They follow a link and carry one thing: a
-- `guest_page_token` in the URL — no session, no site key, no organization.
-- Everything the portal touches is scoped, so with no organization set the
-- policies returned nothing and the whole portal answered 404: the guest's own
-- booking, invisible to the guest. Services, registration, feedback, payment —
-- all of it, from the day production moved to Postgres.
--
-- It cannot be fixed the way the widget was. The widget arrives with a public
-- site key, and `booking_sites` is readable before a tenant is known because a
-- list of booking sites is public information. A list of reservations is not.
--
-- So two things change, and the second is the narrow one.
--
--   1. `reservations` names its own organization, as `booking_sites` did in
--      migration 0004. Until now it reached one only through
--      `guests.organization_id` — and a guest cannot read `guests` either, so
--      there was no way to derive the hotel from the row the token names.
--      The policy becomes direct, which also removes a per-row subquery from
--      the busiest table in the schema.
--
--   2. The token itself becomes a credential the policy understands. The route
--      puts it on the connection (`app.guest_token`) exactly as it puts the
--      organization, and the policy matches the one row whose token equals it.
--
-- What that opens, precisely:
--
--   - one row, the one whose token was presented, and only on READ;
--   - NULLIF, so an unset or empty setting matches nothing — a reservation
--     whose own token happens to be '' must never become world-readable;
--   - WITH CHECK is untouched and stays strict: a guest cannot write anywhere.
--
-- Having read that row the application knows the organization and runs
-- everything else under the ordinary tenant context, so the window in which the
-- token matters is one statement wide.
--
-- Re-runnable.

BEGIN;

ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "organization_id" TEXT REFERENCES "organizations"("id");

-- Backfill from the guest, which is where the scope used to come from.
UPDATE "reservations" r
   SET "organization_id" = g."organization_id"
  FROM "guests" g
 WHERE g."id" = r."guest_id"
   AND r."organization_id" IS DISTINCT FROM g."organization_id";

CREATE INDEX IF NOT EXISTS "idx_reservations_org" ON "reservations" ("organization_id");

-- New rows take the tenant of the statement that writes them, like every other
-- directly scoped table (migration 0005).
ALTER TABLE "reservations" ALTER COLUMN "organization_id"
  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');

DROP POLICY IF EXISTS "reservations_tenant" ON "reservations";
CREATE POLICY "reservations_tenant" ON "reservations"
  USING ("organization_id" = current_setting('app.organization_id')
         OR "guest_page_token" = NULLIF(current_setting('app.guest_token', true), ''))
  WITH CHECK ("organization_id" = current_setting('app.organization_id'));

DO $$
DECLARE orphans int;
BEGIN
  SELECT count(*) INTO orphans FROM "reservations" WHERE "organization_id" IS NULL;
  IF orphans > 0 THEN
    -- Not fatal: such a row was already unreachable, because the scope it used
    -- to depend on is the same guest row that is missing. Said out loud rather
    -- than left for someone to find.
    RAISE NOTICE '% reservation(s) have no organization — their guest row is gone', orphans;
  END IF;
END $$;

COMMIT;
