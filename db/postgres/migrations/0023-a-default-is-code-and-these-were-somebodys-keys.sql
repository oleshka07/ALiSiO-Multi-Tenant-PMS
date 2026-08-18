-- A default is code, and these were somebody's keys.
--
-- guest_page_config and property_guest_config were born with column DEFAULTS
-- carrying the FIRST CUSTOMER'S real life: their wifi password, their door
-- code (4971#), a Google-Maps pin on their driveway, their restaurant's name.
-- Every database created since then started with those values, and every
-- hotel that never opened the guest-page settings served them to its guests —
-- one customer's door code, on another customer's page, as a "default".
--
-- Two things happen here, and the difference matters:
--
--   the DEFAULTS are dropped — from now on an unset wifi password is NULL,
--   which the guest page reads as "don't show this section's row";
--
--   the LEAKED VALUES are erased from every organization EXCEPT the oldest
--   one. The oldest organization on an installation is the customer these
--   values belong to — they are that hotel's real configuration and must
--   survive. For everyone else the same bytes are somebody else's keys.
--   "Oldest" rather than a name, because migrations may not know customers
--   by name (scripts/check-no-tenant-names.mjs) and because it is true on
--   every installation including a fresh one, where there is nobody to
--   clean after.
ALTER TABLE "guest_page_config" ALTER COLUMN "wifi_network" DROP DEFAULT;
ALTER TABLE "guest_page_config" ALTER COLUMN "wifi_password" DROP DEFAULT;
ALTER TABLE "guest_page_config" ALTER COLUMN "restaurant_name" DROP DEFAULT;
ALTER TABLE "guest_page_config" ALTER COLUMN "lock_code" DROP DEFAULT;
ALTER TABLE "guest_page_config" ALTER COLUMN "maps_url" DROP DEFAULT;

ALTER TABLE "property_guest_config" ALTER COLUMN "wifi_network" DROP DEFAULT;
ALTER TABLE "property_guest_config" ALTER COLUMN "wifi_password" DROP DEFAULT;
ALTER TABLE "property_guest_config" ALTER COLUMN "restaurant_name" DROP DEFAULT;
ALTER TABLE "property_guest_config" ALTER COLUMN "maps_url" DROP DEFAULT;
ALTER TABLE "property_guest_config" ALTER COLUMN "parking_info" DROP DEFAULT;

DO $$
DECLARE first_org TEXT;
BEGIN
  SELECT id INTO first_org FROM organizations ORDER BY created_at, id LIMIT 1;
  IF first_org IS NULL THEN RETURN; END IF;

  UPDATE guest_page_config gpc SET
    wifi_network    = CASE WHEN gpc.wifi_network    = 'ALiSiO_Guest'  THEN NULL ELSE gpc.wifi_network    END,
    wifi_password   = CASE WHEN gpc.wifi_password   = 'ALiSiO2026!'   THEN NULL ELSE gpc.wifi_password   END,
    restaurant_name = CASE WHEN gpc.restaurant_name = 'Ресторан ALiSiO' THEN NULL ELSE gpc.restaurant_name END,
    lock_code       = CASE WHEN gpc.lock_code       = '4971#'         THEN NULL ELSE gpc.lock_code       END,
    maps_url        = CASE WHEN gpc.maps_url        = 'https://maps.app.goo.gl/WH2CKhTydtDx9EBe7' THEN NULL ELSE gpc.maps_url END
  WHERE gpc.unit_type_id IN (
    SELECT ut.id FROM unit_types ut
    JOIN properties p ON p.id = ut.property_id
    WHERE p.organization_id <> first_org
  );

  UPDATE property_guest_config pgc SET
    wifi_network    = CASE WHEN pgc.wifi_network    = 'ALiSiO_Guest'  THEN NULL ELSE pgc.wifi_network    END,
    wifi_password   = CASE WHEN pgc.wifi_password   = 'ALiSiO2026!'   THEN NULL ELSE pgc.wifi_password   END,
    restaurant_name = CASE WHEN pgc.restaurant_name = 'Ресторан ALiSiO' THEN NULL ELSE pgc.restaurant_name END,
    maps_url        = CASE WHEN pgc.maps_url        = 'https://maps.app.goo.gl/WH2CKhTydtDx9EBe7' THEN NULL ELSE pgc.maps_url END,
    parking_info    = CASE WHEN pgc.parking_info    = 'Free parking at the entrance' THEN NULL ELSE pgc.parking_info END
  WHERE pgc.property_id IN (
    SELECT p.id FROM properties p WHERE p.organization_id <> first_org
  );
END $$;
