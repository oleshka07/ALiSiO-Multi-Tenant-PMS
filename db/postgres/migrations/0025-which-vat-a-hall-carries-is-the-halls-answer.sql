-- Which VAT a hall carries is the hall's own answer.
--
-- The hall line was posted with the literal 'standard' in two places in code
-- (the handler default and the repo default), and the screen never sent the
-- field at all. So every hall in every hotel was 19 %, and no hotel file
-- could say otherwise — the pilot's note honestly called it «робоче
-- припущення», but an assumption in code is not something a file can correct.
--
-- The rate is not ours to decide. Room hire and short-term accommodation are
-- taxed differently in Germany, the line between them depends on what is
-- actually sold, and the answer comes from the hotel's Steuerberater — the
-- pilot's says its halls follow the rooms. So the answer belongs to the hall,
-- beside its prices, where the file can carry it and the provenance note can
-- say who said so.
--
-- DEFAULT 'standard' is deliberate: every hall that exists keeps the rate it
-- is already being invoiced at. Enabling this mechanism changes nobody's tax.

ALTER TABLE "event_spaces"
  ADD COLUMN IF NOT EXISTS "vat_code" TEXT NOT NULL DEFAULT 'standard';
