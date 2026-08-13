-- A service says what VAT it carries.
--
-- A hotel sells breakfast, a parking space, an extra bed and a lunch packet.
-- On a German invoice those are not one rate: food and the extra bed are
-- reduced, parking and the pet fee are standard. `additional_services` had
-- nowhere to say which — it had a price, a unit label and names in six
-- languages, and no tax at all.
--
-- The consequence is not a missing feature. A service reaching a folio lands
-- there at no rate, and an invoice with a line at no rate is not a document a
-- tax office accepts. It is also why the direct-sale flow could not be
-- completed while the channel flow could: a channel booking gets its rates
-- from channel_rate_rules, where the codes are already written down.
--
-- The ROLE, not the number: 'standard' / 'reduced' / 'zero' point at
-- fin_tax_rates, which holds the percentages and the dates they changed. A 7
-- written here would still say 7 after the next change of the law.
--
-- NULLABLE, WITH NO DEFAULT, and that is the decision worth reading. A default
-- of 'standard' would silently charge 19 % on a breakfast nobody got round to
-- configuring — a wrong tax return that looks like a working system. NULL
-- means "not said", and a service with NULL is refused when it reaches a
-- folio, by name, on a screen where somebody can fix it.
--
-- Re-runnable.

BEGIN;

ALTER TABLE "additional_services" ADD COLUMN IF NOT EXISTS "vat_code" TEXT;

-- A folio charge remembers which service order it came from.
--
-- Not decoration: it is what makes posting twice add nothing. Without it the
-- only way to ask "is this order already on the bill" is to match description
-- and amount, and two saunas on the same day are indistinguishable that way.
ALTER TABLE "fin_folio_items" ADD COLUMN IF NOT EXISTS "service_order_id" TEXT;
CREATE INDEX IF NOT EXISTS "idx_fin_folio_items_order"
  ON "fin_folio_items" ("service_order_id");

-- A folio charge may now come from a service order.
--
-- `source` said where a charge came from and had five answers, none of them
-- "the guest ordered this". Reusing 'manual' would work and would make "which
-- charges came from service orders" unanswerable — which is the question
-- reception asks when a bill looks wrong.
--
-- The constraint is dropped by name and rebuilt. Postgres names an unnamed
-- table CHECK `<table>_<column>_check`, but a table created by an earlier
-- schema.sql may carry a different one, so the name is looked up rather than
-- assumed.
DO $$
DECLARE con text;
BEGIN
  SELECT conname INTO con
    FROM pg_constraint
   WHERE conrelid = 'fin_folio_items'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%source%'
   LIMIT 1;

  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "fin_folio_items" DROP CONSTRAINT %I', con);
  END IF;

  ALTER TABLE "fin_folio_items"
    ADD CONSTRAINT "fin_folio_items_source_check"
    CHECK (source IN ('nightly','ota_split','manual','restaurant','import','service'));
END $$;

COMMIT;
