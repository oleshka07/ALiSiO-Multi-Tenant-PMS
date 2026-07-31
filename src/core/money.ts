/**
 * Money.
 *
 * Amounts live in the database as doubles (REAL), and a double cannot
 * represent 0.10 exactly. On its own that is invisible — 19.99 reads back as
 * 19.99. It stops being invisible the moment a value is *computed* and then
 * stored:
 *
 *     2870.55 * 0.15  ->  430.58250000000004
 *     0.1 summed 1000 times  ->  99.9999999999986
 *
 * Those stored tails accumulate, and a year later the P&L is off by a few
 * heller and nobody can say where. The fix is not to round on the way out —
 * by then the wrong number is already in the row — but to round at the point
 * a number is calculated, before it is written.
 *
 * Postgres uses NUMERIC(14,2) for these columns (see db/postgres/schema.sql),
 * where the arithmetic is exact and this helper becomes belt and braces. It is
 * deliberately not a cents refactor: moving every amount to integer minor
 * units would touch every calculation and every screen in the product, and a
 * single missed conversion is a bill wrong by a factor of a hundred.
 */

/**
 * Round to the currency's minor unit. Half away from zero, which is what an
 * invoice line is expected to do — JavaScript's Math.round breaks ties towards
 * +Infinity, so -0.005 would round to -0.00 and 0.005 to 0.01.
 *
 * The scaling goes through a string rather than `* 100`, because `1.005 * 100`
 * is 100.49999999999999 and would round down.
 */
export function money(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const shifted = Number(`${value}e${decimals}`);
  const rounded = Math.sign(shifted) * Math.round(Math.abs(shifted));
  const back = Number(`${rounded}e-${decimals}`);
  return Object.is(back, -0) ? 0 : back;
}

/** Sum amounts, rounding once at the end rather than at every step. */
export function sumMoney(values: readonly number[], decimals = 2): number {
  let total = 0;
  for (const v of values) total += Number.isFinite(v) ? v : 0;
  return money(total, decimals);
}

/** A share of an amount: percentages, commissions, deposits. */
export function percentOf(value: number, percent: number, decimals = 2): number {
  return money((value * percent) / 100, decimals);
}

/**
 * Split an amount into n parts that add back up to it exactly. Rounding each
 * part separately loses or invents up to n/2 minor units; the remainder is
 * handed out one unit at a time from the front.
 */
export function splitMoney(total: number, parts: number, decimals = 2): number[] {
  if (parts <= 0) return [];
  const unit = 10 ** -decimals;
  const base = money(total / parts, decimals);
  const out = new Array<number>(parts).fill(base);
  let remainder = Math.round((money(total, decimals) - base * parts) / unit);
  for (let i = 0; remainder !== 0; i = (i + 1) % parts) {
    const step = remainder > 0 ? unit : -unit;
    out[i] = money(out[i] + step, decimals);
    remainder += remainder > 0 ? -1 : 1;
  }
  return out;
}
