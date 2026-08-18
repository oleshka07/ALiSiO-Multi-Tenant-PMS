-- A room the website must not sell.
--
-- The pilot's two Appartements (111, 112) exist, are rented, and are priced —
-- and are «online nicht buchbar, nur auf Anfrage bzw. Alternative, wenn 31
-- Zimmer ausgebucht». They are also kept for the hotel's own emergencies.
--
-- Until now a unit type had two states: is_active — visible everywhere,
-- including the booking widget — or inactive, visible nowhere, which reception
-- cannot sell either. "Reception can sell it, the website cannot" had no way
-- to be said, and entering the Appartements would have put them on the
-- website the moment the file was applied.
--
-- DEFAULT TRUE: every existing type is sold online today, and a migration
-- must not un-sell a hotel's rooms.
ALTER TABLE "unit_types"
  ADD COLUMN IF NOT EXISTS "bookable_online" BOOLEAN DEFAULT TRUE NOT NULL;

-- Whether this type's PRICES include breakfast. Nullable on purpose, same
-- three states as reservations.breakfast_included (migration 0020), one level
-- up the decision chain:
--
--   the booking answers first  (what was actually sold to this guest),
--   then the unit type         (what this room's price list means),
--   then the channel rule      (the property-wide guess, as before).
--
-- The Appartements are why the middle level exists: their prices are
-- «zzgl. FRST 15,00 € / Person» — breakfast on top, never inside — while
-- every hotel-room tariff includes it. One property, two truths, and the
-- channel rule can only hold one.
ALTER TABLE "unit_types"
  ADD COLUMN IF NOT EXISTS "breakfast_included" BOOLEAN;
