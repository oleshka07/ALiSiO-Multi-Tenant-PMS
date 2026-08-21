/**
 * From the rows an invoice left in the database to the document the law wants.
 *
 * invoice-document.ts knows WHAT a German invoice must say and invoice-pdf-de.ts
 * knows the millimetres — both existed, fully tested, and nothing called them:
 * the PDF route still rendered every invoice through the Czech layout. This
 * file is the missing middle: load one issued invoice with its lines, tax
 * totals, payer and seller, and assemble the InvoiceDocument the renderer
 * consumes.
 *
 * Returns null rather than inventing:
 *
 *   No lines — the invoice predates folios (one amount, no VAT split). A
 *   German document without its MwSt-Übersicht is not a German document, and
 *   synthesizing rates for money that was never split would put invented tax
 *   into a legal paper. The caller falls back to the legacy renderer, which is
 *   exactly what produced that invoice in the first place.
 *
 *   No reservation — the jurisdiction comes from the property the stay
 *   belongs to. A folio without a reservation — a seminar room, a walk-in
 *   sale — carries its property itself (fin_folios.property_id); a folio
 *   with neither is a custom invoice and stays with the legacy renderer.
 */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { documentLanguage } from '@core/i18n/resolve';
import {
  buildInvoiceDocument, localeForLanguage,
  type InvoiceDocument, type DocumentLine, type DocumentTaxTotal, type Party,
  type FiscalBeleg,
} from '../domain/invoice-document';

/**
 * §33 UStDV: up to this gross, a German invoice may omit the buyer.
 * A legal constant, not a setting — it changes by amendment, not per hotel.
 */
const DE_SMALL_AMOUNT_LIMIT = 250;

export async function loadInvoiceDocument(invoiceId: string): Promise<InvoiceDocument | null> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  const inv = await sql.row<any>(
    `SELECT i.*, f.payer_name, f.payer_address, f.payer_vat_no,
            COALESCE(r.property_id, f.property_id) AS property_id, r.check_in, r.check_out,
            g.first_name AS guest_first_name, g.last_name AS guest_last_name,
            g.address AS guest_address, g.city AS guest_city, g.country AS guest_country
       FROM invoices i
       LEFT JOIN fin_folios f ON f.id = i.folio_id
       LEFT JOIN reservations r ON r.id = i.reservation_id
       LEFT JOIN guests g ON g.id = r.guest_id
      WHERE i.id = ? AND i.organization_id = ?`,
    [invoiceId, organizationId]);
  if (!inv || !inv.property_id) return null;

  const lines = await sql.rows<any>(
    `SELECT position, service_date, description, guest_name, unit_code, quantity,
            unit_price_gross, total_gross, net_amount, tax_amount, vat_rate
       FROM fin_invoice_lines WHERE invoice_id = ? AND organization_id = ?
      ORDER BY position`,
    [invoiceId, organizationId]);
  if (!lines.length) return null;

  const taxTotals = await sql.rows<any>(
    `SELECT vat_rate, gross_amount, net_amount, tax_amount
       FROM fin_invoice_tax_totals WHERE invoice_id = ? AND organization_id = ?
      ORDER BY vat_rate DESC`,
    [invoiceId, organizationId]);

  const org = await sql.row<any>(
    `SELECT name, legal_name, legal_address, registration_no, vat_no, iban, bank_name,
            invoice_email
       FROM organizations WHERE id = ?`,
    [organizationId]);
  if (!org) return null;

  // The jurisdiction of the property, never the operator's interface language
  // — the same resolver the folio charges already use.
  const locale = localeForLanguage(await documentLanguage(inv.property_id));

  const seller: Party = {
    name: org.legal_name || org.name,
    address: org.legal_address ?? null,
    // The settings screen collects one registration number (IČO / Handelsregister)
    // and one VAT number. §14 Abs. 4 Nr. 2 accepts the Steuernummer OR the
    // USt-IdNr — the VAT number satisfies it. There is deliberately no
    // taxNumber column to map yet: inventing a Steuernummer from the company
    // register number would print a wrong identifier on a tax document.
    taxNumber: null,
    vatId: org.vat_no ?? null,
    registrationNo: org.registration_no ?? null,
    iban: org.iban ?? null,
    bankName: org.bank_name ?? null,
    email: org.invoice_email ?? null,
  };

  // The payer of THIS document: the folio's named payer when there is one,
  // the stay's lead guest otherwise. Two guests splitting a room differ
  // exactly here — same reservation, different folio, different name.
  const payerName = inv.payer_name
    || `${inv.guest_first_name ?? ''} ${inv.guest_last_name ?? ''}`.trim();
  const payerAddress = inv.payer_address
    || [inv.guest_address, inv.guest_city, inv.guest_country].filter(Boolean).join(', ');
  const buyer: Party | null = payerName
    ? { name: payerName, address: payerAddress || null, vatId: inv.payer_vat_no ?? null }
    : null;

  // §6 KassenSichV on the beleg: every till payment of this invoice that a
  // TSE signed — or loudly failed to. `tse_status IS NOT NULL` is the filter
  // on purpose: a transfer never went near the TSE and prints nothing, but a
  // failed signature prints the legally required outage wording.
  const fiscalRows = await sql.rows<any>(
    `SELECT p.*, s.recording_system_serial
       FROM fin_folio_payments p
       LEFT JOIN fin_fiscal_settings s ON s.property_id = p.property_id
      WHERE p.invoice_id = ? AND p.organization_id = ? AND p.tse_status IS NOT NULL
      ORDER BY p.paid_at, p.created_at`,
    [invoiceId, organizationId]);
  const fiscal: FiscalBeleg[] = fiscalRows.map((p: any) => ({
    recordingSystemSerial: p.recording_system_serial ?? null,
    tseSerial: p.tse_serial ?? null,
    txNumber: p.tse_tx_number ?? null,
    signatureCounter: p.tse_signature_counter ?? null,
    signature: p.tse_signature ?? null,
    startTime: p.tse_start_time ?? null,
    endTime: p.tse_end_time ?? null,
    qrPayload: p.tse_qr_payload ?? null,
    failed: p.tse_status === 'tse_failed',
  }));

  return buildInvoiceDocument({
    number: inv.invoice_number,
    issueDate: String(inv.issued_at).slice(0, 10),
    serviceFrom: inv.check_in ? String(inv.check_in).slice(0, 10) : null,
    serviceTo: inv.check_out ? String(inv.check_out).slice(0, 10) : null,
    status: inv.status,
    correctsNumber: inv.corrects_invoice_id
      ? (await sql.row<any>('SELECT invoice_number FROM invoices WHERE id = ? AND organization_id = ?',
          [inv.corrects_invoice_id, organizationId]))?.invoice_number ?? null
      : null,
    currency: inv.currency || 'EUR',
    locale,
    seller,
    buyer,
    lines: lines.map((l: any, i: number): DocumentLine => ({
      position: Number(l.position) || i + 1,
      service_date: String(l.service_date).slice(0, 10),
      description: l.description,
      guest_name: l.guest_name ?? null,
      unit_code: l.unit_code ?? null,
      quantity: Number(l.quantity),
      unit_price_gross: Number(l.unit_price_gross),
      total_gross: Number(l.total_gross),
      net_amount: Number(l.net_amount),
      tax_amount: Number(l.tax_amount),
      vat_rate: Number(l.vat_rate),
    })),
    taxTotals: taxTotals.map((t: any): DocumentTaxTotal => ({
      vat_rate: Number(t.vat_rate),
      gross_amount: Number(t.gross_amount),
      net_amount: Number(t.net_amount),
      tax_amount: Number(t.tax_amount),
    })),
    smallAmountLimit: locale === 'de-DE' ? DE_SMALL_AMOUNT_LIMIT : null,
    fiscal: fiscal.length ? fiscal : null,
  });
}
