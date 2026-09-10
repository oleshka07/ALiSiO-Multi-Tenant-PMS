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
 * ── The property axis (INC-038, Д54) ──────────────────────────────────────
 *
 * A series belongs to a HOUSE first, to the account second: two properties
 * under one account keep two sets of books, and an invoice number is the
 * identifier of one legal entity's document. `property_id IS NULL` is the
 * account-wide row, and it is what a hotel that has never thought about
 * properties has — so nothing changes for it.
 *
 * `COALESCE(property_id, '') = ?` with `propertyId ?? ''` rather than
 * `property_id = ?` with a null parameter: a NULL parameter has no type for
 * Postgres to infer here, and `= NULL` is never true anyway. The comparison is
 * written once, the same way, in the filter and in the ordering.
 *
 * Returns null rather than a default so the caller can tell "configured" from
 * "not configured" and fall back deliberately.
 */
async function configuredSeries(
  sql: Sql,
  organizationId: string,
  propertyId: string | null,
  channel?: string | null,
): Promise<(SeriesDef & { numberFormat: string; seriesPropertyId: string | null }) | null> {
  const ch = (channel || 'house').toLowerCase();
  const prop = propertyId ?? '';
  const row = await sql.row<any>(
    `SELECT code, prefix, number_format, property_id FROM invoice_series
      WHERE organization_id = ?
        AND (COALESCE(property_id, '') = ? OR property_id IS NULL)
        AND (channel = ? OR is_default = TRUE)
      ORDER BY CASE WHEN COALESCE(property_id, '') = ? THEN 0 ELSE 1 END,
               CASE WHEN channel = ? THEN 0 ELSE 1 END, sort_order
      LIMIT 1`,
    [organizationId, prop, ch, prop, ch],
  ).catch(() => undefined); // table absent on a database that has not migrated
  if (!row) return null;
  return {
    series: row.code,
    prefix: row.prefix ?? '',
    numberFormat: row.number_format || DEFAULT_TEMPLATE,
    seriesPropertyId: row.property_id ?? null,
  };
}

/**
 * Which series ROW a (house, code) pair resolves to — the house's own row if it
 * has one, otherwise the account-wide row.
 *
 * The counter and the period lock hang on the row, not on the code. Two houses
 * may now hold the same code (that is the whole point of Д54), and keying the
 * sequence on the code alone would put both of them in one run: the second
 * house would continue the first one's numbers, and closing the month in one
 * would freeze the other's documents. Neither raises an error anywhere.
 */
async function seriesRowProperty(
  sql: Sql,
  organizationId: string,
  propertyId: string | null,
  series: string,
): Promise<string | null> {
  if (!propertyId) return null;
  const own = await sql.row<{ property_id: string }>(
    'SELECT property_id FROM invoice_series WHERE organization_id = ? AND property_id = ? AND code = ?',
    [organizationId, propertyId, series],
  ).catch(() => undefined);
  return own ? propertyId : null;
}

export interface AllocatedNumber {
  invoiceNumber: string;
  series: string;
  seqNo: number;
  /** The house whose run this number came from; null = the account-wide run. */
  seriesPropertyId: string | null;
}

/**
 * Allocate the next invoice number for an organization + property + channel +
 * year, atomically. Wrapped in a better-sqlite3 transaction (synchronous,
 * single-writer) so concurrent requests can never get the same number.
 *
 * `propertyId` is required and has no default: a wrong house here misnumbers
 * someone's books silently, and a document with no house at all (a company
 * invoice, an event) is a real case that must say so by passing null.
 */
export async function allocateInvoiceNumber(
  sql: Sql,
  organizationId: string,
  propertyId: string | null,
  channel: string,
  year: number,
): Promise<AllocatedNumber> {
  const configured = await configuredSeries(sql, organizationId, propertyId, channel);
  const { series, prefix } = configured ?? seriesForChannel(channel);
  const template = configured?.numberFormat ?? DEFAULT_TEMPLATE;
  // A hotel that configured nothing keeps ONE run per account, exactly as
  // before: the fallback map has no house, so its counter has none either.
  const seriesProperty = configured?.seriesPropertyId ?? null;
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
    //
    // The conflict target is the EXPRESSION index, because `property_id` is
    // nullable and neither engine treats NULL as equal to NULL in a unique key.
    await t.run(
      'INSERT INTO invoice_counters (organization_id, property_id, series, year, last_no) VALUES (?, ?, ?, ?, 1) ' +
      'ON CONFLICT(organization_id, (COALESCE(property_id, \'\')), series, year) ' +
      'DO UPDATE SET last_no = invoice_counters.last_no + 1',
      [organizationId, seriesProperty, series, year],
    );
    const row = await t.row<{ last_no: number }>(
      `SELECT last_no FROM invoice_counters
        WHERE organization_id = ? AND COALESCE(property_id, '') = ? AND series = ? AND year = ?`,
      [organizationId, seriesProperty ?? '', series, year],
    );
    return row!.last_no;
  });
  return {
    invoiceNumber: formatInvoiceNumber(template, { prefix, year, seq: seqNo }),
    series,
    seqNo,
    seriesPropertyId: seriesProperty,
  };
}

export async function periodStatus(sql: Sql, organizationId: string, propertyId: string | null, series: string, month: string): Promise<'open' | 'locked'> {
  const seriesProperty = await seriesRowProperty(sql, organizationId, propertyId, series);
  const row = await sql.row<{ status: string }>(
    `SELECT status FROM invoice_periods
      WHERE organization_id = ? AND COALESCE(property_id, '') = ? AND series = ? AND month = ?`,
    [organizationId, seriesProperty ?? '', series, month]);
  return (row?.status === 'locked') ? 'locked' : 'open';
}

export async function isPeriodLocked(sql: Sql, organizationId: string, propertyId: string | null, series: string, month: string): Promise<boolean> {
  return (await periodStatus(sql, organizationId, propertyId, series, month)) === 'locked';
}

/**
 * The house a document belongs to.
 *
 * `invoices` has no `property_id` of its own — checked against the schema, not
 * assumed: the axis has always been derived, from the reservation the document
 * was raised on, and for a folio without a reservation (a company, an event)
 * from the folio. `invoices.handlers.ts` filters the list the same way, through
 * `reservations r`.
 *
 * Adding the column would be the tidier answer and it is deliberately NOT done
 * here: it is a core table with writers in six places, and this task is the
 * finance configuration. Named in the report as left open.
 */
const INVOICE_PROPERTY =
  `COALESCE((SELECT r.property_id FROM reservations r WHERE r.id = invoices.reservation_id),
            (SELECT f.property_id FROM fin_folios f WHERE f.id = invoices.folio_id))`;

/** The house of an existing document — one place, so callers cannot disagree. */
export async function invoicePropertyId(sql: Sql, organizationId: string, invoiceId: string): Promise<string | null> {
  const row = await sql.row<{ property_id: string | null }>(
    `SELECT COALESCE(r.property_id, f.property_id) AS property_id
       FROM invoices i
       LEFT JOIN reservations r ON r.id = i.reservation_id
       LEFT JOIN fin_folios f ON f.id = i.folio_id
      WHERE i.id = ? AND i.organization_id = ?`,
    [invoiceId, organizationId],
  );
  return row?.property_id ?? null;
}

/**
 * The invoices that belong to ONE series row — the other half of the lock.
 *
 * A house's row owns the documents of that house. The account-wide row owns
 * every document whose house has NOT named a series with this code: that is
 * the same resolution `configuredSeries` did when the number was issued, said
 * once more in SQL. Written as `NOT EXISTS` rather than `property_id IS NULL`
 * because an invoice of a house without its own series is an account document
 * too, and freezing the month must reach it.
 */
function memberInvoices(seriesProperty: string | null): { where: string; params: unknown[] } {
  if (seriesProperty) return { where: `AND ${INVOICE_PROPERTY} = ?`, params: [seriesProperty] };
  return {
    where: `AND NOT EXISTS (SELECT 1 FROM invoice_series s
              WHERE s.organization_id = invoices.organization_id
                AND s.code = invoices.series
                AND s.property_id = ${INVOICE_PROPERTY})`,
    params: [],
  };
}

/** Lock a (property, series, month): freeze numbers and mark member invoices immutable. */
export async function lockPeriod(sql: Sql, organizationId: string, propertyId: string | null, series: string, month: string): Promise<void> {
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
  const seriesProperty = await seriesRowProperty(sql, organizationId, propertyId, series);
  const member = memberInvoices(seriesProperty);
  await sql.tx(async (t) => {
    await t.run(
      "INSERT INTO invoice_periods (organization_id, property_id, series, month, status, locked_at) VALUES (?, ?, ?, ?, 'locked', CURRENT_TIMESTAMP) " +
      "ON CONFLICT(organization_id, (COALESCE(property_id, '')), series, month) DO UPDATE SET status = 'locked', locked_at = CURRENT_TIMESTAMP",
      [organizationId, seriesProperty, series, month],
    );
    await t.run(
      'UPDATE invoices SET locked = TRUE WHERE organization_id = ? AND series = ? ' +
      'AND substr(COALESCE(period, CAST(issued_at AS TEXT)), 1, 7) = ? ' + member.where,
      [organizationId, series, month, ...member.params]);
  });
}

/** Re-open a locked period (admin correction before it's been filed). */
export async function unlockPeriod(sql: Sql, organizationId: string, propertyId: string | null, series: string, month: string): Promise<void> {
  const seriesProperty = await seriesRowProperty(sql, organizationId, propertyId, series);
  const member = memberInvoices(seriesProperty);
  await sql.tx(async (t) => {
    await t.run(
      "INSERT INTO invoice_periods (organization_id, property_id, series, month, status) VALUES (?, ?, ?, ?, 'open') " +
      "ON CONFLICT(organization_id, (COALESCE(property_id, '')), series, month) DO UPDATE SET status = 'open', locked_at = NULL",
      [organizationId, seriesProperty, series, month],
    );
    await t.run(
      'UPDATE invoices SET locked = FALSE WHERE organization_id = ? AND series = ? ' +
      'AND substr(COALESCE(period, CAST(issued_at AS TEXT)), 1, 7) = ? ' + member.where,
      [organizationId, series, month, ...member.params]);
  });
}

/**
 * True when this invoice may no longer be edited/deleted (period locked).
 * An invoice belonging to another organization is not this caller's to judge,
 * so it reads as locked rather than as editable.
 */
export async function isInvoiceLocked(sql: Sql, organizationId: string, invoiceId: string): Promise<boolean> {
  const row = await sql.row<{ series: string; month: string; locked: number; property_id: string | null }>(
    `SELECT i.series, COALESCE(i.period, substr(CAST(i.issued_at AS TEXT),1,7)) AS month, i.locked,
            COALESCE(r.property_id, f.property_id) AS property_id
       FROM invoices i
       LEFT JOIN reservations r ON r.id = i.reservation_id
       LEFT JOIN fin_folios f ON f.id = i.folio_id
      WHERE i.id = ? AND i.organization_id = ?`,
    [invoiceId, organizationId],
  );
  if (!row) return true;
  if (row.locked) return true;
  // The house comes off the invoice itself — asking the caller for it would let
  // a wrong house report someone else's month as open.
  return await isPeriodLocked(sql, organizationId, row.property_id ?? null, row.series || 'HOUSE', row.month);
}
