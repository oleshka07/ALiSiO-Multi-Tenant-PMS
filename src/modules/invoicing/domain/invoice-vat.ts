/**
 * VAT on an invoice: net and tax from gross, per line and per rate group.
 *
 * Prices are stored GROSS. That is not a shortcut — it is how a hotel thinks
 * ("das Zimmer kostet 143,05"), how an OTA sends a booking, and how the price
 * list is printed. Net and tax are derived; the gross is the number a human
 * agreed to.
 *
 * The one rule worth stating loudly, because it looks like a rounding bug:
 *
 *   THE RECAPITULATION IS COMPUTED FROM THE GROUP'S GROSS, NOT BY SUMMING
 *   THE LINES.
 *
 * On a real invoice those two differ by a cent, and the printed document
 * carries the group figure. See invoice-vat.check.ts, which asserts the exact
 * numbers off a live German invoice, on both of its rate groups. It is legal
 * (Abschn. 14.5 UStAE) and it is what the customer's Steuerberater accepts
 * every month. Anyone "fixing" the discrepancy would make our invoice disagree
 * with the one the tax office has already seen.
 *
 * Rates are not hardcoded anywhere here. A rate arrives as a number on the
 * line — snapshotted when the charge was made, chosen by the date of service,
 * from the organization's own table. Germany's 19/7 and Czechia's 21/12 go
 * through the same code.
 */
// Relative, not '@core/money': invoice-vat.check.ts runs under plain node,
// which resolves no tsconfig aliases. Same reason invoice-numbering.ts reaches
// for '../../../core/db/async.ts'.
import { money } from '../../../core/money.ts';

export interface TaxedLine {
  /** Gross amount of the whole line: quantity × unit price, already multiplied. */
  gross: number;
  /** Percent, as stored on the line: 19, 7, 0 — never a code, never a lookup. */
  vatRate: number;
}

export interface LineAmounts {
  gross: number;
  net: number;
  tax: number;
}

export interface TaxGroup {
  vatRate: number;
  gross: number;
  net: number;
  tax: number;
}

/**
 * Net and tax for one line, for the line-by-line columns of the document.
 *
 * These are for display. They are NOT what the recapitulation adds up — see
 * the module comment.
 */
export function lineAmounts(line: TaxedLine): LineAmounts {
  const gross = money(line.gross);
  const net = money(gross / (1 + line.vatRate / 100));
  return { gross, net, tax: money(gross - net) };
}

/**
 * The recapitulation block: one row per rate.
 *
 * Gross is summed first, then divided once. Doing it the other way — summing
 * the per-line nets — is the thing that produces a cent of disagreement with
 * the printed document.
 *
 * Sorted by rate descending, which is the order German invoices print
 * (19% before 7%).
 */
export function taxGroups(lines: readonly TaxedLine[]): TaxGroup[] {
  const byRate = new Map<number, number>();
  for (const l of lines) {
    byRate.set(l.vatRate, money((byRate.get(l.vatRate) ?? 0) + money(l.gross)));
  }

  return [...byRate.entries()]
    .map(([vatRate, gross]) => {
      const net = money(gross / (1 + vatRate / 100));
      return { vatRate, gross, net, tax: money(gross - net) };
    })
    .sort((a, b) => b.vatRate - a.vatRate);
}

/** Gross total of the document — the number the guest pays. */
export function invoiceGross(lines: readonly TaxedLine[]): number {
  return money(lines.reduce((sum, l) => sum + money(l.gross), 0));
}

// ─── Which rate applied on the day the service happened ─────────────────────

export interface TaxRate {
  /** The role a rate plays. A service points at this, never at a number. */
  code: 'standard' | 'reduced' | 'zero';
  /** Percent. Per organization: DE 19/7, CZ 21/12. */
  rate: number;
  /** ISO date, inclusive. */
  valid_from: string;
  /** ISO date, inclusive. Null means still in force. */
  valid_to?: string | null;
}

/**
 * The rate to stamp on a charge, chosen by the date the service was rendered.
 *
 * Not the invoice date, and the difference is not academic. German hospitality
 * moved food to the reduced rate on 2026-01-01: a breakfast served on
 * 31 December is 19%, the same breakfast on 1 January is 7%, and both can land
 * on an invoice issued in the same week. Choosing by the invoice date would
 * quietly restate the tax on a service that already happened.
 *
 * Returns null when nothing covers that day — a caller must refuse to post the
 * charge rather than guess. Guessing here means a wrong tax return.
 *
 * Where two entries overlap, the one that started later wins: that is how a
 * correction is entered (add the new row, leave the old one as history) and it
 * means an organization never has to edit a rate that has already been used.
 */
export function pickRate(
  rates: readonly TaxRate[],
  code: TaxRate['code'],
  serviceDate: string,
): TaxRate | null {
  const day = serviceDate.slice(0, 10);
  const candidates = rates
    .filter((r) => r.code === code)
    .filter((r) => r.valid_from.slice(0, 10) <= day)
    .filter((r) => !r.valid_to || r.valid_to.slice(0, 10) >= day)
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  return candidates[0] ?? null;
}
