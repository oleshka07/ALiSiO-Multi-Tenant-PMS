-- The public entry point names its own organization.
--
-- A guest is not a tenant: the widget arrives with a site key and nothing else,
-- so booking_sites has to be readable before any organization is set. Reaching
-- one through property_id would have meant opening `properties` to anonymous
-- reads as well — the name, city and address of every hotel on the server. One
-- column keeps that exception to a single table.
--
-- The policy is replaced to match: scoped on organization_id directly, open on
-- the read side only while no tenant is set, strict on the write side as
-- before. scripts/pg-policies.mjs generates the same thing from schema.sql;
-- this migration exists because the column has to arrive first.
--
-- Re-runnable.

BEGIN;

ALTER TABLE "booking_sites" ADD COLUMN IF NOT EXISTS "organization_id" TEXT REFERENCES "organizations"("id");

UPDATE "booking_sites" bs
   SET "organization_id" = p."organization_id"
  FROM "properties" p
 WHERE p."id" = bs."property_id"
   AND bs."organization_id" IS DISTINCT FROM p."organization_id";

CREATE INDEX IF NOT EXISTS "idx_booking_sites_org" ON "booking_sites" ("organization_id");

DROP POLICY IF EXISTS "booking_sites_tenant" ON "booking_sites";
CREATE POLICY "booking_sites_tenant" ON "booking_sites"
  USING ("organization_id" = current_setting('app.organization_id') OR current_setting('app.organization_id') = '')
  WITH CHECK ("organization_id" = current_setting('app.organization_id'));

COMMIT;
