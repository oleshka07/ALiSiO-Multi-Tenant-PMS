-- A payment is a fact, not a word in a ledger.
--
-- Money already flows through fin_operations, where `method` is a string on
-- a journal row. But the DOCUMENT — the folio and its invoice — never learns
-- how it was paid. KassenSichV asks the document two questions the journal
-- cannot answer: does this beleg need a TSE signature at all (cash and
-- card-at-the-desk do, a bank transfer does not), and which Zahlungsart goes
-- into the DSFinV-K export. So the payment becomes a first-class row on the
-- folio. TSE-Spezifikation: docs/TSE-KASSENSICHV.md §6.4, Block A.
--
-- `card_terminal` is deliberately separate from `transfer`: a card paid at
-- reception counts toward the cash-register turnover, a bank transfer does
-- not. Collapsing them into "card/bank" is exactly the mistake that makes a
-- DSFinV-K export disagree with the till.
CREATE TABLE IF NOT EXISTS "fin_folio_payments" (
  "id"              TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  "organization_id" TEXT CONSTRAINT "fk_fin_folio_payments_organization_id_2"
                      REFERENCES "organizations"("id") ON DELETE CASCADE,
  -- The property whose till this payment belongs to. Nullable the same way
  -- fin_folios.property_id is: a custom folio may not have one.
  "property_id"     TEXT CONSTRAINT "fk_fin_folio_payments_property_id_1"
                      REFERENCES "properties"("id") ON DELETE SET NULL,
  "folio_id"        TEXT NOT NULL CONSTRAINT "fk_fin_folio_payments_folio_id_3"
                      REFERENCES "fin_folios"("id") ON DELETE CASCADE,
  -- Which numbered document this payment settles, once one exists. A payment
  -- can precede its invoice (deposit at check-in, invoice at check-out).
  "invoice_id"      TEXT CONSTRAINT "fk_fin_folio_payments_invoice_id_4"
                      REFERENCES "invoices"("id") ON DELETE SET NULL,
  -- Negative = money handed back. A refund in cash is a till movement too,
  -- and DSFinV-K wants it with its sign, not as a deleted row.
  "amount"          NUMERIC(14,2) NOT NULL,
  "method"          TEXT NOT NULL,
  "paid_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who took the money — user id, snapshot at the moment of taking.
  "received_by"     TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("method" IN ('cash','card_terminal','transfer','voucher'))
);
CREATE INDEX IF NOT EXISTS "idx_fin_folio_payments_folio"
  ON "fin_folio_payments" ("folio_id");
CREATE INDEX IF NOT EXISTS "idx_fin_folio_payments_org"
  ON "fin_folio_payments" ("organization_id", "paid_at");

DO $$
DECLARE r text;
BEGIN
  EXECUTE 'ALTER TABLE fin_folio_payments ALTER COLUMN "organization_id"
    SET DEFAULT NULLIF(current_setting(''app.organization_id'', true), '''')';
  EXECUTE 'ALTER TABLE fin_folio_payments ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE fin_folio_payments FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS fin_folio_payments_tenant ON fin_folio_payments';
  EXECUTE 'CREATE POLICY fin_folio_payments_tenant ON fin_folio_payments
    USING ("organization_id" = current_setting(''app.organization_id''))
    WITH CHECK ("organization_id" = current_setting(''app.organization_id''))';
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'reservations'
       AND privilege_type = 'SELECT' AND grantee <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON fin_folio_payments TO %I', r);
  END LOOP;
END $$;
