/**
 * A reservation's own invoice: raise one, replace one.
 *
 * Moved out of api/invoices.handlers.ts, which imports `next/server`. Nothing
 * here needs a request or a response — this is what happens when a stay is
 * marked paid, called from the booking and payment lifecycle where there is no
 * session to read. It sat behind an HTTP boundary it never used, and that made
 * it unreachable from `node file.check.ts`, so the one rule in it that matters
 * — which invoices a reissue may cancel — had no test.
 *
 * The handlers module re-exports both functions, so every existing caller and
 * `@finance` keep working unchanged.
 */
import { getSql } from '@core/db/async';
import { organizationCurrency } from '@core/currency';
import { allocateInvoiceNumber, isInvoiceLocked } from '@/modules/invoicing/domain/invoice-numbering';

/**
 * The organization of a reservation, through its property. Invoice generation
 * is called from the payment and booking lifecycle, where there is no session
 * to read — the reservation itself is the authority on whose invoice this is.
 */
async function organizationOfReservation(reservationId: string): Promise<string | null> {
  const sql = getSql();
  const row = await sql.row<any>('SELECT p.organization_id AS org FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.id = ?', [reservationId]) as { org: string } | undefined;
  return row?.org ?? null;
}

/**
 * Real accounting date for a document: check-in (stay) → payment date → creation.
 * Never the statement-import date. Returns YYYY-MM-DD.
 */
export function resolveDocumentDate(row: {
  check_in?: string | null; payment_date?: string | null; issued_at?: string | null;
}): string {
  const pick = row.check_in || row.payment_date || row.issued_at || '';
  return pick.slice(0, 10);
}

// ─── Core Business Logic ─────────────────────────────────────────────────────

/**
 * Create an invoice record for a reservation.
 * Idempotent — if invoice already exists for this reservation, returns existing id.
 */
export async function generateInvoiceForReservation(
  reservationId: string,
  opts: { confirmed?: boolean; source?: string } = {},
): Promise<string | null> {
  try {
    const sql = getSql();
    const confirmed = opts.confirmed ? 1 : 0;
    const confirmationSource = opts.source || (opts.confirmed ? 'confirmed' : 'manual');

    // Idempotency check — skip if invoice already exists (not cancelled). If it
    // exists but was unconfirmed and this call carries a confirmation (Teya/cash),
    // upgrade it to confirmed.
    //
    // Deliberately NOT narrowed to `folio_id IS NULL`, unlike the reissue
    // below. This runs automatically when a stay is marked paid. If it ignored
    // the payers' invoices it would raise a second document for the same money
    // — the guests' invoices plus one more for the whole room — and that one
    // would carry a real number out of the same sequence. Refusing to add
    // anything is the safe answer; a stay that already has documents has them.
    const existing = await sql.row<any>("SELECT id, confirmed FROM invoices WHERE reservation_id = ? AND status != 'cancelled'", [reservationId]) as { id: string; confirmed: number } | undefined;

    if (existing) {
      if (confirmed && !existing.confirmed) {
        await sql.run("UPDATE invoices SET confirmed = TRUE, confirmation_source = ? WHERE id = ?", [confirmationSource, existing.id]);
      }
      return existing.id;
    }

    // Fetch reservation basic data
    const res = await sql.row<any>(`
      SELECT total_price, currency, check_out, property_id
      FROM reservations
      WHERE id = ?
    `, [reservationId]) as { total_price: number; currency: string; check_out: string; property_id: string | null } | undefined;

    if (!res) return null;

    const organizationId = await organizationOfReservation(reservationId);
    if (!organizationId) {
      console.error('[Invoices] reservation', reservationId, 'has no organization — refusing to number an invoice');
      return null;
    }

    const invoiceId = `inv_${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    // Direct-booking invoices use the HOUSE series (plain YYYY-NNN), allocated
    // atomically — from the series of the reservation's HOUSE (INC-038, Д54):
    // two properties under one account keep two sets of books.
    const { invoiceNumber } = await allocateInvoiceNumber(
      sql, organizationId, res.property_id ?? null, 'house', new Date().getFullYear());
    // Due date: check-out date (service rendered on departure)
    const dueDate = res.check_out > today ? res.check_out : today;
    const period = (res.check_out || today).slice(0, 7);

    // Валюта броні, а якщо її немає — валюта ГОТЕЛЮ, не крони. Фактура з
    // чужою валютою — не «майже правильна»: 4200 EUR і 4200 CZK це різні
    // зобовʼязання, і виправити виписаний документ можна лише сторно.
    //
    // Коментар стоїть ТУТ, а не всередині шаблону: `//` SQL коментарем не
    // вважає, і з 28.08.2026 (`7cd6a91`) цей INSERT не парсився взагалі —
    // `near "/": syntax error`, `catch` нижче ковтав виняток, виклик із
    // `reservation.handlers` fire-and-forget, і фактури просто не було
    // (рецензія 07.09 раунд 5, правка 5.1).
    await sql.run(`
      INSERT INTO invoices (id, organization_id, reservation_id, invoice_number, issued_at, due_date, amount, currency, status, series, period, confirmed, confirmation_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', 'HOUSE', ?, ?, ?)
    `, [invoiceId, organizationId, reservationId, invoiceNumber, today, dueDate, res.total_price, res.currency || await organizationCurrency(organizationId), period, confirmed, confirmationSource]);

    console.log(`[Invoices] Created ${invoiceNumber} for reservation ${reservationId}`);
    return invoiceId;
  } catch (e: any) {
    console.error('[Invoices] Error generating invoice:', e.message);
    return null;
  }
}

/**
 * Cancel an existing invoice and generate a fresh one for the same reservation.
 * The old invoice is soft-deleted (status → 'cancelled'), not removed from DB.
 */
export async function reissueInvoiceForReservation(reservationId: string): Promise<string | null> {
  try {
    const sql = getSql();
    // A locked (filed) invoice cannot be cancelled/renumbered — it must be
    // corrected with a storno (credit note) instead.
    // `folio_id IS NULL` on both statements below, and it is the whole point.
    //
    // Reissue is the legacy route: one invoice per stay, cancel it, number a
    // new one. Once a stay can have a document per payer — two guests sharing
    // a room, each with their own number — cancelling "every invoice of this
    // reservation" stops being a correction and becomes destruction: fixing
    // the first guest's invoice would void the second guest's, which they have
    // already paid and taken home. The number stays spent, the document turns
    // invalid, and nobody is told.
    //
    // A folio invoice is corrected the way German law expects anyway: a storno
    // with its own number, mirroring the original, leaving it readable. That
    // path exists (stornoInvoice) and this one must not compete with it.
    const current = await sql.row<any>("SELECT id FROM invoices WHERE reservation_id = ? AND folio_id IS NULL AND status != 'cancelled'", [reservationId]) as { id: string } | undefined;
    const organizationId = await organizationOfReservation(reservationId);
    if (!organizationId) return null;
    if (current && await isInvoiceLocked(sql, organizationId, current.id)) {
      throw new Error('Invoice period is locked — use a storno (credit note) to correct it.');
    }
    // Cancel the stay's own invoices — never a payer's.
    await sql.run("UPDATE invoices SET status = 'cancelled' WHERE reservation_id = ? AND folio_id IS NULL AND status != 'cancelled'", [reservationId]);
    // Force-create a new invoice (existing check now passes since all are cancelled)
    return await generateInvoiceForReservation(reservationId);
  } catch (e: any) {
    console.error('[Invoices] reissue error:', e.message);
    return null;
  }
}
