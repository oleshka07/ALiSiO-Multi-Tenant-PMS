/**
 * Folios, their charges, and turning them into an invoice.
 *
 * The one operation worth reading carefully is `issueInvoice`. It does four
 * things that must happen together or not at all: take the next number from
 * the series, freeze the charges into invoice lines, write the recapitulation,
 * and mark the charges as invoiced. Any one of those happening without the
 * others leaves a legal document in an impossible state — a number with no
 * lines, or lines that can still be edited.
 */
import { getSql } from '@core/db/async';
import type { Sql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { allocateInvoiceNumber, isPeriodLocked, seriesForChannel } from '../domain/invoice-numbering';
import { buildSnapshot, buildStorno, type FolioItem } from '../domain/invoice-snapshot';

export interface Folio {
  id: string;
  reservation_id: string | null;
  payer_kind: 'guest' | 'company';
  payer_name: string | null;
  status: 'open' | 'settled';
  label: string | null;
}

export async function listFolios(reservationId?: string): Promise<Folio[]> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  // Awaited, not returned as a promise from a ternary: check-await.mjs reads a
  // seam call without `await` as the bug it usually is, and being right nine
  // times out of ten is worth writing the tenth explicitly.
  if (reservationId) {
    return await sql.rows<Folio>(
      'SELECT * FROM fin_folios WHERE organization_id = ? AND reservation_id = ? ORDER BY created_at',
      [organizationId, reservationId]);
  }
  return await sql.rows<Folio>(
    'SELECT * FROM fin_folios WHERE organization_id = ? ORDER BY created_at DESC',
    [organizationId]);
}

export async function createFolio(input: {
  reservationId?: string | null;
  /** For a folio with no reservation (events): where its invoice's jurisdiction comes from. */
  propertyId?: string | null;
  payerKind?: 'guest' | 'company';
  payerName?: string | null;
  payerAddress?: string | null;
  payerVatNo?: string | null;
  payerDebtorNo?: string | null;
  label?: string | null;
}): Promise<string> {
  const organizationId = await requireOrganizationId();
  const id = crypto.randomUUID();
  await getSql().run(
    `INSERT INTO fin_folios
       (id, organization_id, reservation_id, property_id, payer_kind, payer_name, payer_address, payer_vat_no, payer_debtor_no, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizationId, input.reservationId ?? null, input.propertyId ?? null, input.payerKind ?? 'guest',
     input.payerName ?? null, input.payerAddress ?? null, input.payerVatNo ?? null,
     input.payerDebtorNo ?? null, input.label ?? null],
  );
  return id;
}

export interface NewCharge {
  folioId: string;
  reservationId?: string | null;
  /** The order this came from, so posting the same one twice adds nothing. */
  serviceOrderId?: string | null;
  serviceDate: string;
  kind: 'lodging' | 'service' | 'fee' | 'city_tax' | 'manual';
  description: string;
  guestName?: string | null;
  unitCode?: string | null;
  quantity: number;
  unitPriceGross: number;
  totalGross: number;
  vatRate: number;
  source?: 'nightly' | 'ota_split' | 'manual' | 'restaurant' | 'import' | 'service';
}

/** Add charges to a folio. Several at once, because a split produces three. */
export async function addCharges(charges: readonly NewCharge[], t?: Sql): Promise<number> {
  if (charges.length === 0) return 0;
  const organizationId = await requireOrganizationId();
  const sql = t ?? getSql();
  for (const c of charges) {
    await sql.run(
      `INSERT INTO fin_folio_items
         (id, organization_id, folio_id, reservation_id, service_order_id, service_date, kind, description,
          guest_name, unit_code, quantity, unit_price_gross, total_gross, vat_rate, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), organizationId, c.folioId, c.reservationId ?? null,
       c.serviceOrderId ?? null, c.serviceDate,
       c.kind, c.description, c.guestName ?? null, c.unitCode ?? null, c.quantity,
       c.unitPriceGross, c.totalGross, c.vatRate, c.source ?? 'manual'],
    );
  }
  return charges.length;
}

/** Charges on a folio that no invoice has taken yet. */
export async function openCharges(folioId: string, t?: Sql): Promise<FolioItem[]> {
  const organizationId = await requireOrganizationId();
  return (t ?? getSql()).rows<FolioItem>(
    `SELECT id, service_date, description, guest_name, unit_code,
            quantity, unit_price_gross, total_gross, vat_rate
       FROM fin_folio_items
      WHERE organization_id = ? AND folio_id = ? AND invoice_id IS NULL AND voided_by_item_id IS NULL
      ORDER BY service_date, created_at`,
    [organizationId, folioId],
  );
}

/**
 * Move uninvoiced charges onto another folio of the same stay.
 *
 * This is the verb behind splitting a bill: the room's charges land on one
 * folio, reception drags half of them onto the second payer's, each folio
 * becomes its own invoice. Only the folio_id moves — amounts, dates and VAT
 * stay exactly as posted, because splitting who PAYS must not be able to
 * change what is OWED.
 *
 * Refused, not filtered, when a charge is already invoiced: its line is frozen
 * under a numbered document, and silently skipping it would leave reception
 * believing the guest's share moved when part of it did not.
 */
export async function moveCharges(itemIds: readonly string[], toFolioId: string): Promise<number> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  if (!itemIds.length) return 0;

  const target = await sql.row<any>(
    'SELECT id, reservation_id FROM fin_folios WHERE id = ? AND organization_id = ?',
    [toFolioId, organizationId]);
  if (!target) throw new Error('Folio not found');

  let moved = 0;
  await sql.tx(async (t) => {
    for (const itemId of itemIds) {
      const item = await t.row<any>(
        `SELECT id, folio_id, reservation_id, invoice_id, voided_by_item_id
           FROM fin_folio_items WHERE id = ? AND organization_id = ?`,
        [itemId, organizationId]);
      if (!item) throw new Error('Charge not found');
      if (item.invoice_id) throw new Error('Charge is already invoiced — storno the invoice first');
      if (item.voided_by_item_id) throw new Error('Charge is voided');
      // Same stay on both sides. Money moving between two bookings' bills is
      // not a split, it is a transfer nobody asked for.
      if (item.reservation_id && target.reservation_id
          && item.reservation_id !== target.reservation_id) {
        throw new Error('Charge and folio belong to different reservations');
      }
      await t.run(
        'UPDATE fin_folio_items SET folio_id = ? WHERE id = ? AND organization_id = ?',
        [toFolioId, itemId, organizationId]);
      moved += 1;
    }
  });
  return moved;
}

/**
 * Everything the split-bill screen needs about one stay, in one query burst:
 * each folio with its payer, its still-open charges and the invoices already
 * raised from it. The alternative — the UI stitching this from three endpoints
 * per folio — is N+1 over HTTP with loading flicker as the failure mode.
 */
export async function foliosOverview(reservationId: string): Promise<Array<Folio & {
  openGross: number;
  openItems: FolioItem[];
  invoices: Array<{ id: string; invoice_number: string; status: string; amount: number }>;
}>> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const heads = await sql.rows<Folio>(
    'SELECT * FROM fin_folios WHERE organization_id = ? AND reservation_id = ? ORDER BY created_at',
    [organizationId, reservationId]);

  const out = [];
  for (const folio of heads) {
    const openItems = await openCharges(folio.id);
    const invoices = await sql.rows<any>(
      `SELECT id, invoice_number, status, amount FROM invoices
        WHERE organization_id = ? AND folio_id = ? ORDER BY issued_at, invoice_number`,
      [organizationId, folio.id]);
    out.push({
      ...folio,
      openItems,
      openGross: Math.round(openItems.reduce((s, i) => s + Number(i.total_gross), 0) * 100) / 100,
      invoices: invoices.map((i: any) => ({ ...i, amount: Number(i.amount) })),
    });
  }
  return out;
}

export interface IssueResult {
  invoiceId: string;
  invoiceNumber: string;
  series: string;
  gross: number;
  lines: number;
}

/**
 * Freeze a folio into an invoice.
 *
 * Refuses, rather than half-succeeds, on three things:
 *
 *   - nothing to invoice. An invoice with no lines is a number burned out of a
 *     legal sequence for nothing;
 *   - the accounting month is locked. That is the whole point of locking it:
 *     after the monthly export, corrections go through a storno, not through a
 *     new document slipped into a closed period;
 *   - anything failing mid-way. All four writes are one transaction, so a
 *     number is never allocated without the lines that justify it.
 */
export async function issueInvoice(input: {
  folioId: string;
  channel?: string | null;
  issueDate?: string;
}): Promise<IssueResult> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10);
  const month = issueDate.slice(0, 7);
  const year = Number(issueDate.slice(0, 4));

  const folio = await sql.row<any>(
    'SELECT * FROM fin_folios WHERE id = ? AND organization_id = ?',
    [input.folioId, organizationId]);
  if (!folio) throw new Error('Folio not found');

  const items = await openCharges(input.folioId);
  if (items.length === 0) throw new Error('Nothing to invoice on this folio');

  const { series } = seriesForChannel(input.channel);
  if (await isPeriodLocked(sql, organizationId, series, month)) {
    throw new Error(`The accounting month ${month} is closed — issue a storno instead`);
  }

  const snapshot = buildSnapshot(items);
  const invoiceId = crypto.randomUUID();
  let number = '';
  let allocatedSeries = '';

  await sql.tx(async (t) => {
    const allocated = await allocateInvoiceNumber(t, organizationId, input.channel ?? 'house', year);
    number = allocated.invoiceNumber;
    allocatedSeries = allocated.series;

    await t.run(
      // folio_id, not only reservation_id. The reservation says which room the
      // charges came from; the folio says whose document this is. When two
      // guests split one room, that is the only thing telling their invoices
      // apart — and the only thing stopping a correction to one of them from
      // cancelling the other.
      `INSERT INTO invoices (id, organization_id, invoice_number, issued_at, amount, currency, status, reservation_id, folio_id)
       VALUES (?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
      [invoiceId, organizationId, number, issueDate, snapshot.gross,
       folio.currency ?? 'EUR', folio.reservation_id, folio.id],
    );

    for (const l of snapshot.lines) {
      await t.run(
        `INSERT INTO fin_invoice_lines
           (id, organization_id, invoice_id, position, service_date, description, guest_name, unit_code,
            quantity, unit_price_gross, total_gross, net_amount, tax_amount, vat_rate, source_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), organizationId, invoiceId, l.position, l.service_date, l.description,
         l.guest_name, l.unit_code, l.quantity, l.unit_price_gross, l.total_gross,
         l.net_amount, l.tax_amount, l.vat_rate, l.source_item_id],
      );
    }

    for (const g of snapshot.taxTotals) {
      await t.run(
        `INSERT INTO fin_invoice_tax_totals
           (id, organization_id, invoice_id, vat_rate, gross_amount, net_amount, tax_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), organizationId, invoiceId, g.vat_rate,
         g.gross_amount, g.net_amount, g.tax_amount],
      );
    }

    // The charges are taken. Anything added to the folio after this belongs to
    // the next invoice, which is what makes a mid-stay invoice possible.
    for (const item of items) {
      await t.run(
        'UPDATE fin_folio_items SET invoice_id = ? WHERE id = ? AND organization_id = ?',
        [invoiceId, item.id, organizationId],
      );
    }
  });

  return {
    invoiceId,
    invoiceNumber: number,
    series: allocatedSeries,
    gross: snapshot.gross,
    lines: snapshot.lines.length,
  };
}

/**
 * Reverse an issued invoice.
 *
 * The original is never touched: it keeps its number, its lines and its place
 * in the sequence. The storno is a second document with its own number and
 * mirrored amounts, and the charges it releases become invoiceable again — so
 * a corrected invoice is "storno, fix the folio, issue again", three visible
 * steps rather than one silent edit.
 */
export async function stornoInvoice(input: {
  invoiceId: string;
  channel?: string | null;
  issueDate?: string;
}): Promise<IssueResult> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10);
  const year = Number(issueDate.slice(0, 4));

  const original = await sql.row<any>(
    'SELECT * FROM invoices WHERE id = ? AND organization_id = ?',
    [input.invoiceId, organizationId]);
  if (!original) throw new Error('Invoice not found');
  if (original.status === 'storno') throw new Error('This invoice is already a reversal');

  const lines = await sql.rows<any>(
    `SELECT position, service_date, description, guest_name, unit_code, quantity,
            unit_price_gross, total_gross, net_amount, tax_amount, vat_rate, source_item_id
       FROM fin_invoice_lines WHERE invoice_id = ? AND organization_id = ? ORDER BY position`,
    [input.invoiceId, organizationId]);
  const totals = await sql.rows<any>(
    'SELECT vat_rate, gross_amount, net_amount, tax_amount FROM fin_invoice_tax_totals WHERE invoice_id = ? AND organization_id = ?',
    [input.invoiceId, organizationId]);

  const mirrored = buildStorno({
    lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) })),
    taxTotals: totals.map((t) => ({
      vat_rate: Number(t.vat_rate), gross_amount: Number(t.gross_amount),
      net_amount: Number(t.net_amount), tax_amount: Number(t.tax_amount),
    })),
    gross: Number(original.amount), net: 0, tax: 0,
  });

  const stornoId = crypto.randomUUID();
  let number = '';
  let series = '';

  await sql.tx(async (t) => {
    const allocated = await allocateInvoiceNumber(t, organizationId, input.channel ?? 'house', year);
    number = allocated.invoiceNumber;
    series = allocated.series;

    await t.run(
      // The reversal inherits the folio of what it reverses: a credit note for
      // one guest belongs to that guest's document trail, not to the room's.
      `INSERT INTO invoices (id, organization_id, invoice_number, issued_at, amount, currency, status, reservation_id, folio_id, corrects_invoice_id)
       VALUES (?, ?, ?, ?, ?, ?, 'storno', ?, ?, ?)`,
      [stornoId, organizationId, number, issueDate, mirrored.gross,
       original.currency ?? 'EUR', original.reservation_id, original.folio_id ?? null, input.invoiceId],
    );

    for (const l of mirrored.lines) {
      await t.run(
        `INSERT INTO fin_invoice_lines
           (id, organization_id, invoice_id, position, service_date, description, guest_name, unit_code,
            quantity, unit_price_gross, total_gross, net_amount, tax_amount, vat_rate, source_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), organizationId, stornoId, l.position, l.service_date, l.description,
         l.guest_name, l.unit_code, l.quantity, l.unit_price_gross, l.total_gross,
         l.net_amount, l.tax_amount, l.vat_rate, l.source_item_id],
      );
    }
    for (const g of mirrored.taxTotals) {
      await t.run(
        `INSERT INTO fin_invoice_tax_totals
           (id, organization_id, invoice_id, vat_rate, gross_amount, net_amount, tax_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), organizationId, stornoId, g.vat_rate,
         g.gross_amount, g.net_amount, g.tax_amount],
      );
    }

    // The original is marked, not modified: its number and lines stay exactly
    // as they were printed.
    await t.run(
      "UPDATE invoices SET status = 'corrected' WHERE id = ? AND organization_id = ?",
      [input.invoiceId, organizationId]);

    // And its charges go back on the folio, free to be invoiced again.
    await t.run(
      'UPDATE fin_folio_items SET invoice_id = NULL WHERE invoice_id = ? AND organization_id = ?',
      [input.invoiceId, organizationId]);
  });

  return { invoiceId: stornoId, invoiceNumber: number, series, gross: mirrored.gross, lines: mirrored.lines.length };
}
