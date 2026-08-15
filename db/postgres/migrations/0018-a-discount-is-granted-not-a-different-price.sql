-- A discount is granted, not a different price.
--
-- The pilot's owner asked for one thing in one sentence: «Es muss bitte
-- möglich sein, eine 10- bzw. 20%-Rabattierung auf den ÜN-Preis manuell
-- eingeben zu können» — for regulars, and for guests booking through a Greiz
-- company that has an entitlement while the invoice goes to a different
-- company. Until now reception did it by editing the price by hand.
--
-- Why a percent on the reservation rather than a cheaper rate:
--
--   A corporate RATE is a price list — it belongs to the tariff, applies to
--   everyone who books it, and lives in price_occupancy. The hotel already has
--   one (its corporate figures are the standard ones ÷ 0,9).
--
--   This is not that. It is a reduction GRANTED to one guest on one stay, by a
--   person, for a reason that is not in any table: they come every month, or
--   their employer has an arrangement that the invoice address does not show.
--   Encoding it as a rate would mean a new rate for every such case and no way
--   to tell later which was policy and which was a favour.
--
-- Stored as the percent and not as the resulting amount, because the amount
-- answers "how much" and the percent answers "why it is less". An invoice has
-- to be able to show the reduction, and a reduction that leaves no trace is
-- indistinguishable from a typo in the price.
--
-- ACCOMMODATION ONLY, which is what the request says and what the code does
-- (modules/finance/domain/ota-split.ts). Breakfast is bought at its price
-- whoever the guest is, and discounting across two VAT rates at once moves
-- money between them — on a German invoice that is a different kind of error
-- than being generous.
--
-- DEFAULT 0, NOT NULL: every existing booking had no discount, and "no
-- discount" is a number, not a missing value. NULL here would make every
-- caller decide what an absent discount means.
ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "lodging_discount_percent" NUMERIC(5,2) DEFAULT 0 NOT NULL;

-- 0…100, refused by the database as well as by the code.
--
-- Below zero is a surcharge typed into a discount box — it would raise a
-- guest's bill. Above one hundred would make the hotel owe money for the stay.
-- The domain clamps both, and the constraint means a row that reached the
-- table another way cannot carry one either.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_lodging_discount_range'
  ) THEN
    ALTER TABLE "reservations"
      ADD CONSTRAINT "reservations_lodging_discount_range"
      CHECK ("lodging_discount_percent" >= 0 AND "lodging_discount_percent" <= 100);
  END IF;
END $$;

-- Why it was given. Free text on purpose: «Stammkunde», «Firma Müller», a name
-- — the hotel's own words, not a list somebody has to maintain. It is what a
-- tax audit asks for when it sees a reduced line, and what the next
-- receptionist reads to know whether to grant it again.
ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "lodging_discount_reason" TEXT;
