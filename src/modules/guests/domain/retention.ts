/**
 * How far back guest records are kept, and what "too far" means.
 *
 * This is a whole file for one small calculation because the calculation guards
 * the only irreversible operation in the system: anonymizeOldRegistrations
 * permanently replaces every guest's name, passport number, address, email and
 * phone for everything older than the cutoff.
 *
 * It used to be computed in SQL — `date('now', '-' || ? || ' months')`. A
 * negative window produced the modifier `'--6 months'`, which SQLite cannot
 * parse, which made the comparison NULL, which matched no rows. Bad input was
 * harmless BY ACCIDENT, and the accident vanished the moment the arithmetic
 * moved into JavaScript: subtracting a negative number puts the cutoff in the
 * future, and `check_out < future` is true for nearly every reservation ever
 * taken. `?months=-6` on the cron endpoint was enough.
 *
 * No imports, so retention.check.ts can prove it under plain node — the module
 * aliases the repositories use do not resolve there.
 */

/** The largest window that is plausibly a policy rather than a typo. */
const MAX_MONTHS = 600;

/**
 * The date before which records may be anonymised, as 'YYYY-MM-DD'.
 *
 * Throws rather than clamping: a caller that asked for something impossible has
 * a bug, and quietly substituting six months would hide it behind a number that
 * looks deliberate.
 */
export function retentionCutoff(monthsToKeep: number, now: Date = new Date()): string {
  if (!Number.isInteger(monthsToKeep) || monthsToKeep < 1 || monthsToKeep > MAX_MONTHS) {
    throw new Error(
      `Retention window must be a whole number of months between 1 and ${MAX_MONTHS}, got ${monthsToKeep}`,
    );
  }

  // UTC throughout, and month-end overflow left as JavaScript does it
  // (31 Aug − 6 months → 3 Mar): that is what SQLite's '-N months' did here,
  // and matching it keeps the boundary rows identical to before.
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - monthsToKeep);
  return cutoff.toISOString().slice(0, 10);
}
