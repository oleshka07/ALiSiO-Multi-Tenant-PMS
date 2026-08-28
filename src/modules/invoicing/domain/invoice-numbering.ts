/**
 * ALiSiO ERP — per-channel invoice numbering + monthly period locking.
 *
 * Series (each its own sequence):
 *   booking → BKG-YYYY-NNN
 *   airbnb  → AIR-YYYY-NNN
 *   cash / house (direct) → YYYY-NNN  (HOUSE series, no prefix)
 *
 * Every sequence is per organization. An invoice number is a legal document
 * identifier and each company owns its own run of them: two hotels on the same
 * server both issue 2026-001, and neither may see or advance the other's
 * counter. Callers pass the organization from the session — there is no
 * default, because a wrong default here silently misnumbers someone's books.
 *
 * A (series, month) period is "open" until the operator locks it at the monthly
 * export. While open, invoices in it can be freely deleted/renumbered. Once
 * locked, numbers are frozen — corrections must go through a storno (credit note).
 */
import type { Sql } from '../../../core/db/async.ts';
import { formatInvoiceNumber, DEFAULT_TEMPLATE } from './invoice-number-format.ts';
/* eslint-disable @typescript-eslint/no-explicit-any */

interface SeriesDef { series: string; prefix: string; }

const SERIES: Record<string, SeriesDef> = {
  booking: { series: 'BKG',   prefix: 'BKG-' },
  airbnb:  { series: 'AIR',   prefix: 'AIR-' },
  cash:    { series: 'HOUSE', prefix: '' },
  house:   { series: 'HOUSE', prefix: '' },
};

export function seriesForChannel(channel?: string | null): SeriesDef {
  return SERIES[(channel || 'house').toLowerCase()] || SERIES.house;
}

/**
 * The organization's own series for this channel, if it has configured one.
 *
 * The map above is one hotel's arrangement with its accountant. A hotel that
 * has said what its series are gets those; a hotel that has not keeps the map,
 * unchanged, down to the character — which is what makes this safe to add
 * while a customer is issuing invoices through it.
 *
 * Returns null rather than a default so the caller can tell "configured" from
 * "not configured" and fall back deliberately.
 */
async function configuredSeries(
  sql: Sql,
  organizationId: string,
  channel?: string | null,
): Promise<(SeriesDef & { numberFormat: string }) | null> {
  const ch = (channel || 'house').toLowerCase();
  const row = await sql.row<any>(
    `SELECT code, prefix, number_format FROM invoice_series
      WHERE organization_id = ? AND (channel = ? OR is_default = TRUE)
      ORDER BY CASE WHEN channel = ? THEN 0 ELSE 1 END, sort_order
      LIMIT 1`,
    [organizationId, ch, ch],
  ).catch(() => undefined); // table absent on a database that has not migrated
  if (!row) return null;
  return {
    series: row.code,
    prefix: row.prefix ?? '',
    numberFormat: row.number_format || DEFAULT_TEMPLATE,
  };
}

export interface AllocatedNumber { invoiceNumber: string; series: string; seqNo: number; }

/**
 * Allocate the next invoice number for an organization + channel + year,
 * atomically. Wrapped in a better-sqlite3 transaction (synchronous,
 * single-writer) so concurrent requests can never get the same number.
 */
export async function allocateInvoiceNumber(
  sql: Sql,
  organizationId: string,
  channel: string,
  year: number,
): Promise<AllocatedNumber> {
  const configured = await configuredSeries(sql, organizationId, channel);
  const { series, prefix } = configured ?? seriesForChannel(channel);
  const template = configured?.numberFormat ?? DEFAULT_TEMPLATE;
  // Increment and read in one transaction: two requests must never come away
  // with the same number.
  const seqNo = await sql.tx(async (t) => {
    // `invoice_counters.last_no`, qualified, not a bare `last_no`.
    //
    // Inside DO UPDATE SET, Postgres sees two rows: the existing one and the
    // rejected `excluded` one. A bare column on the right-hand side could mean
    // either, so it refuses — "column reference last_no is ambiguous" — and the
    // whole statement fails. SQLite resolves it to the target row and never
    // complains, so this read as correct SQL for as long as SQLite was the only
    // engine. It is the numbering of every invoice: nothing could be issued.
    await t.run(
      'INSERT INTO invoice_counters (organization_id, series, year, last_no) VALUES (?, ?, ?, 1) ' +
      'ON CONFLICT(organization_id, series, year) DO UPDATE SET last_no = invoice_counters.last_no + 1',
      [organizationId, series, year],
    );
    const row = await t.row<{ last_no: number }>(
      'SELECT last_no FROM invoice_counters WHERE organization_id = ? AND series = ? AND year = ?',
      [organizationId, series, year],
    );
    return row!.last_no;
  });
  return { invoiceNumber: formatInvoiceNumber(template, { prefix, year, seq: seqNo }), series, seqNo };
}

export async function periodStatus(sql: Sql, organizationId: string, series: string, month: string): Promise<'open' | 'locked'> {
  const row = await sql.row<{ status: string }>('SELECT status FROM invoice_periods WHERE organization_id = ? AND series = ? AND month = ?', [organizationId, series, month]);
  return (row?.status === 'locked') ? 'locked' : 'open';
}

export async function isPeriodLocked(sql: Sql, organizationId: string, series: string, month: string): Promise<boolean> {
  return (await periodStatus(sql, organizationId, series, month)) === 'locked';
}

/** Lock a (series, month): freeze numbers and mark member invoices immutable. */
export async function lockPeriod(sql: Sql, organizationId: string, series: string, month: string): Promise<void> {
  // CAST(issued_at AS TEXT) in every COALESCE below.
  //
  // `period` is TEXT ('YYYY-MM') and `issued_at` is TIMESTAMPTZ, so Postgres
  // refuses to pick a common type — "COALESCE types text and timestamp with
  // time zone cannot be matched" — and the same applies to substr() over the
  // timestamp itself. On SQLite both columns were text and neither said
  // anything. Locking an accounting period, unlocking it, and asking whether
  // one invoice is locked all went through this; the month could not be closed
  // at all. The GET on /api/accounting/lock-period already had the cast, which
  // is why the list of periods kept working while nothing could be locked.
  await sql.tx(async (t) => {
    await t.run(
      "INSERT INTO invoice_periods (organization_id, series, month, status, locked_at) VALUES (?, ?, ?, 'locked', CURRENT_TIMESTAMP) " +
      "ON CONFLICT(organization_id, series, month) DO UPDATE SET status = 'locked', locked_at = CURRENT_TIMESTAMP",
      [organizationId, series, month],
    );
    await t.run("UPDATE invoices SET locked = TRUE WHERE organization_id = ? AND series = ? AND substr(COALESCE(period, CAST(issued_at AS TEXT)), 1, 7) = ?", [organizationId, series, month]);
  });
}

/** Re-open a locked period (admin correction before it's been filed). */
export async function unlockPeriod(sql: Sql, organizationId: string, series: string, month: string): Promise<void> {
  await sql.tx(async (t) => {
    await t.run(
      "INSERT INTO invoice_periods (organization_id, series, month, status) VALUES (?, ?, ?, 'open') " +
      "ON CONFLICT(organization_id, series, month) DO UPDATE SET status = 'open', locked_at = NULL",
      [organizationId, series, month],
    );
    await t.run("UPDATE invoices SET locked = FALSE WHERE organization_id = ? AND series = ? AND substr(COALESCE(period, CAST(issued_at AS TEXT)), 1, 7) = ?", [organizationId, series, month]);
  });
}

/**
 * True when this invoice may no longer be edited/deleted (period locked).
 * An invoice belonging to another organization is not this caller's to judge,
 * so it reads as locked rather than as editable.
 */
export async function isInvoiceLocked(sql: Sql, organizationId: string, invoiceId: string): Promise<boolean> {
  const row = await sql.row<{ series: string; month: string; locked: number }>(
    'SELECT series, COALESCE(period, substr(CAST(issued_at AS TEXT),1,7)) AS month, locked FROM invoices WHERE id = ? AND organization_id = ?',
    [invoiceId, organizationId],
  );
  if (!row) return true;
  if (row.locked) return true;
  return await isPeriodLocked(sql, organizationId, row.series || 'HOUSE', row.month);
}
