/**
 * How a folio was paid — the fact KassenSichV keeps asking about.
 *
 * Two questions only the DOCUMENT can answer, and until this table it could
 * answer neither: does this beleg need a TSE signature at all (cash and
 * card-at-the-desk do, a bank transfer does not), and which Zahlungsart goes
 * into the DSFinV-K export. `fin_operations.method` knows the word, but the
 * journal is not the beleg. TSE spec: docs/TSE-KASSENSICHV.md §6.4, Block A.
 *
 * THE GUARD, and why it refuses instead of warning: until `fiscal_de` is
 * enabled for a German organization, recording a cash or card-terminal
 * payment here would make this PMS the "elektronisches Aufzeichnungssystem"
 * of §146a AO — an unregistered till. The agreed transition is that on-site
 * money stays in the hotel's old system until TSE is live, so the refusal IS
 * the agreement, enforced. This is not a pilot hack: the next German hotel
 * gets the same refusal until its fiscal module is switched on.
 *
 * There is no deletePayment on purpose. A payment is a till movement; a
 * wrong one is corrected by a counter-entry with the opposite sign, the same
 * way an invoice is corrected by storno, and DSFinV-K expects exactly that.
 */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { hasFeature } from '@core/features';

export const PAYMENT_METHODS = ['cash', 'card_terminal', 'transfer', 'voucher'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The methods that count toward the till — the ones §146a AO signs. */
export const TILL_METHODS: ReadonlySet<PaymentMethod> = new Set(['cash', 'card_terminal']);

export interface FolioPayment {
  id: string;
  folio_id: string;
  property_id: string | null;
  invoice_id: string | null;
  amount: number;
  method: PaymentMethod;
  paid_at: string;
  received_by: string | null;
}

export async function recordPayment(input: {
  folioId: string;
  amount: number;
  method: string;
  invoiceId?: string | null;
  paidAt?: string | null;
  receivedBy?: string | null;
}): Promise<string> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  if (!PAYMENT_METHODS.includes(input.method as PaymentMethod)) {
    throw new Error(`method must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  const amount = Number(input.amount);
  // Zero is not a payment; negative IS one — cash handed back is a till
  // movement with its sign, not a deleted row.
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error('amount must be a non-zero number');
  }

  // The folio's property: directly for a reservation-less folio (events),
  // through the stay otherwise. Both in one query so the answer cannot
  // disagree with the invoice's own jurisdiction resolution.
  const folio = await sql.row<any>(
    `SELECT f.id, COALESCE(r.property_id, f.property_id) AS property_id
       FROM fin_folios f
       LEFT JOIN reservations r ON r.id = f.reservation_id
      WHERE f.id = ? AND f.organization_id = ?`,
    [input.folioId, organizationId]);
  if (!folio) throw new Error('Folio not found');

  if (TILL_METHODS.has(input.method as PaymentMethod)) {
    // Cash belongs to a till and a till belongs to a property — that is
    // where §146a AO looks. A folio that does not know its property cannot
    // prove its till is NOT German, so it fails closed: organizations do not
    // carry a country, only properties do.
    if (!folio.property_id) {
      throw new Error('Cash and card payments need a folio with a property — the till belongs to a place');
    }
    const place = await sql.row<any>(
      'SELECT country FROM properties WHERE id = ?', [folio.property_id]);
    const country = String(place?.country || '').toUpperCase();
    if (country === 'DE' && !(await hasFeature(organizationId, 'fiscal_de'))) {
      throw new Error(
        'Cash and card payments for a German property are still recorded in the old till system — the fiscal module (TSE) is not enabled yet');
    }
  }

  if (input.invoiceId) {
    const inv = await sql.row<any>(
      'SELECT id FROM invoices WHERE id = ? AND organization_id = ?',
      [input.invoiceId, organizationId]);
    if (!inv) throw new Error('Invoice not found');
  }

  const id = crypto.randomUUID();
  await sql.run(
    `INSERT INTO fin_folio_payments
       (id, organization_id, property_id, folio_id, invoice_id, amount, method, paid_at, received_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)`,
    [id, organizationId, folio.property_id ?? null, input.folioId,
     input.invoiceId ?? null, amount, input.method,
     input.paidAt ?? null, input.receivedBy ?? null]);
  return id;
}

export async function listPayments(folioId: string): Promise<FolioPayment[]> {
  const organizationId = await requireOrganizationId();
  return await getSql().rows<FolioPayment>(
    `SELECT * FROM fin_folio_payments
      WHERE folio_id = ? AND organization_id = ?
      ORDER BY paid_at, created_at`,
    [folioId, organizationId]);
}
