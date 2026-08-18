-- An invoice belongs to a payer, not to a room.
--
-- The pilot's owner asked for it in one line: «es müssen bitte mind. 2
-- Rechnungen mit fortlaufender RG-Nr. aus einem Zimmer möglich sein» — and
-- noted that the program they use today manages three guests in one room.
--
-- Two people share a double, each pays their own half, each needs a document
-- with their own name on it and its own number from the same sequence. That is
-- an ordinary evening at a reception desk, not an edge case.
--
-- The machinery for it already exists here and has since folios were built:
-- fin_folios carries the payer, issueInvoice() numbers one invoice per folio,
-- and fin_folio_items.invoice_id stops a charge being billed twice. What was
-- missing is the other direction — an invoice could not say WHICH folio it
-- came from. It knew only its reservation, and a reservation is the room.
--
-- Why that gap is not cosmetic:
--
--   reissueInvoiceForReservation() cancels by reservation:
--     UPDATE invoices SET status='cancelled' WHERE reservation_id = ?
--
--   With one invoice per stay that is correct. With two payers it is
--   destruction: correcting the first guest's invoice silently cancels the
--   second guest's, who has already paid and taken their copy home. The
--   number stays used, the document becomes void, and nobody is told.
--
-- NULL is allowed and means what it says: an invoice raised before folios
-- reached the operator's screen, or one raised without a folio at all. Making
-- it NOT NULL would require inventing a folio for every historical row — a
-- payer that never existed, recorded as if it had.
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "folio_id" TEXT;

-- Asked on every invoice list of a stay: "which of these is this guest's?"
-- Without it the answer is a scan of the invoice table.
CREATE INDEX IF NOT EXISTS "idx_invoices_folio" ON "invoices" ("folio_id");
