/**
 * Turning a folio into an invoice, and an invoice into its reversal.
 *
 * The whole point of this file is that it is a COPY, not a view. A folio item
 * can still be corrected; an invoice line never can. When the document is
 * issued, everything it prints is written onto its own rows: the description,
 * the guest's name, the room number, the quantity, the price and the rate that
 * was in force. No foreign key to the service, the price list or the rate
 * table — a German invoice has to be reproducible for ten years (GoBD), and by
 * then the service may be renamed, the rate changed and the room gone.
 *
 * Pure functions: no database, no clock, no ids. What they return is what the
 * caller writes, in one transaction, together with the number allocation.
 */
import { money } from '../../../core/money.ts';
import { lineAmounts, taxGroups, type TaxedLine } from './invoice-vat.ts';

/** A charge sitting on a folio, ready to be invoiced. */
export interface FolioItem {
  id: string;
  service_date: string;
  description: string;
  guest_name?: string | null;
  unit_code?: string | null;
  quantity: number;
  unit_price_gross: number;
  total_gross: number;
  vat_rate: number;
}

export interface InvoiceLine {
  position: number;
  service_date: string;
  description: string;
  guest_name: string | null;
  unit_code: string | null;
  quantity: number;
  unit_price_gross: number;
  total_gross: number;
  net_amount: number;
  tax_amount: number;
  vat_rate: number;
  source_item_id: string | null;
}

export interface TaxTotal {
  vat_rate: number;
  gross_amount: number;
  net_amount: number;
  tax_amount: number;
}

export interface Snapshot {
  lines: InvoiceLine[];
  taxTotals: TaxTotal[];
  gross: number;
  net: number;
  tax: number;
}

/**
 * Freeze these charges into invoice lines plus the recapitulation.
 *
 * Order is the order given: reception decides what the guest reads first, and
 * re-sorting an invoice after the fact is how a document stops matching the one
 * that was handed over.
 *
 * The document totals come from the tax groups, not from adding the lines —
 * see invoice-vat.ts. Both are on the invoice, and they may differ by a cent;
 * the group figure is the one the tax office has seen.
 */
export function buildSnapshot(items: readonly FolioItem[]): Snapshot {
  const taxed: TaxedLine[] = items.map((i) => ({ gross: i.total_gross, vatRate: i.vat_rate }));

  const lines: InvoiceLine[] = items.map((item, index) => {
    const amounts = lineAmounts({ gross: item.total_gross, vatRate: item.vat_rate });
    return {
      position: index + 1,
      service_date: item.service_date,
      description: item.description,
      guest_name: item.guest_name ?? null,
      unit_code: item.unit_code ?? null,
      quantity: item.quantity,
      unit_price_gross: money(item.unit_price_gross),
      total_gross: amounts.gross,
      net_amount: amounts.net,
      tax_amount: amounts.tax,
      vat_rate: item.vat_rate,
      source_item_id: item.id,
    };
  });

  const groups = taxGroups(taxed);
  const taxTotals: TaxTotal[] = groups.map((g) => ({
    vat_rate: g.vatRate,
    gross_amount: g.gross,
    net_amount: g.net,
    tax_amount: g.tax,
  }));

  return {
    lines,
    taxTotals,
    gross: money(groups.reduce((s, g) => s + g.gross, 0)),
    net: money(groups.reduce((s, g) => s + g.net, 0)),
    tax: money(groups.reduce((s, g) => s + g.tax, 0)),
  };
}

/**
 * The reversal of an issued invoice.
 *
 * Every amount negated, nothing else touched: same descriptions, same dates,
 * same rates, same order. A storno is a mirror, so that the two documents read
 * together sum to nothing — which is exactly what an accountant checks.
 *
 * It gets its OWN number from the same series. The original keeps its number
 * forever; a legal sequence has no holes, and "delete and reissue" is what
 * makes one.
 *
 * Note what is NOT here: no `reason`, no partial reversal. A partial correction
 * is a full storno plus a new invoice — two documents, both complete. Anything
 * cleverer produces a document that cannot be read on its own.
 */
export function buildStorno(snapshot: Snapshot): Snapshot {
  const negate = (n: number) => money(-n);
  return {
    lines: snapshot.lines.map((l) => ({
      ...l,
      // Quantity keeps its sign; the money is what reverses. An invoice that
      // says "-3 breakfasts" reads as a returned breakfast, which is not what
      // happened — the charge was withdrawn, not the meal.
      total_gross: negate(l.total_gross),
      net_amount: negate(l.net_amount),
      tax_amount: negate(l.tax_amount),
    })),
    taxTotals: snapshot.taxTotals.map((t) => ({
      ...t,
      gross_amount: negate(t.gross_amount),
      net_amount: negate(t.net_amount),
      tax_amount: negate(t.tax_amount),
    })),
    gross: negate(snapshot.gross),
    net: negate(snapshot.net),
    tax: negate(snapshot.tax),
  };
}
