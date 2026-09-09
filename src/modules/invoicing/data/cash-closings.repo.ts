/**
 * The Kassenabschluss: a day of the till, closed once, frozen.
 *
 * TSE Block D (docs/TSE-KASSENSICHV.md §6.4). A closing is a RECORD with a
 * sequential number per property — DSFinV-K's Z_NR — not a report recomputed
 * on every view. It freezes what fin_folio_payments held for that property
 * and day: cash and card-at-the-desk separately (different Zahlartn in the
 * export), how many operations were TSE-signed and how many failed, and the
 * first/last payment times.
 *
 * Closing the same day twice is REFUSED, not merged: two closings with one
 * date would give DSFinV-K two Z_NRs over the same money.
 *
 * The DSFinV-K ZIP itself is deliberately NOT generated here yet: the spec
 * leaves «власна генерація чи fiskaly DSFINVK DE» open until their API is
 * evaluated, and inventing the twenty-file CSV format from memory would
 * produce something that LOOKS like an export and validates as garbage. What
 * exists now is the till journal CSV — every till payment with its TSE
 * fields — which is the raw material either path consumes.
 */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { propertyScopeFilter, type PropertyScope } from '@core/property-scope';
import { TILL_METHODS } from './folio-payments.repo';

export async function closeDay(input: {
  propertyId: string;
  /** YYYY-MM-DD; the day being closed, by paid_at. */
  date: string;
  closedBy?: string | null;
  notes?: string | null;
}): Promise<{ id: string; closingNumber: number }> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('date must be YYYY-MM-DD');
  const prop = await sql.row<any>(
    'SELECT id FROM properties WHERE id = ? AND organization_id = ?',
    [input.propertyId, organizationId]);
  if (!prop) throw new Error('Property not found');

  const existing = await sql.row<any>(
    'SELECT id FROM fin_cash_closings WHERE property_id = ? AND closing_date = ?',
    [input.propertyId, input.date]);
  if (existing) throw new Error(`Day ${input.date} is already closed for this till`);

  // The day's till movements, by the moment the money changed hands.
  // substr() is the one date predicate both engines read identically on a
  // TIMESTAMPTZ/TEXT column that always starts YYYY-MM-DD.
  const payments = await sql.rows<any>(
    `SELECT amount, method, paid_at, tse_status FROM fin_folio_payments
      WHERE organization_id = ? AND property_id = ?
        AND substr(CAST(paid_at AS TEXT), 1, 10) = ?
      ORDER BY paid_at`,
    [organizationId, input.propertyId, input.date]);
  const till = payments.filter((p) => TILL_METHODS.has(p.method));

  const sum = (rows: any[]) => Math.round(rows.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
  const last = await sql.row<any>(
    'SELECT MAX(closing_number) AS n FROM fin_cash_closings WHERE property_id = ? AND organization_id = ?',
    [input.propertyId, organizationId]);
  const closingNumber = (Number(last?.n) || 0) + 1;

  const id = crypto.randomUUID();
  await sql.run(
    `INSERT INTO fin_cash_closings
       (id, organization_id, property_id, closing_date, closing_number,
        cash_total, card_total, payments_count, signed_count, failed_count,
        first_payment_at, last_payment_at, closed_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizationId, input.propertyId, input.date, closingNumber,
     sum(till.filter((p) => p.method === 'cash')),
     sum(till.filter((p) => p.method === 'card_terminal')),
     till.length,
     till.filter((p) => p.tse_status === 'signed').length,
     till.filter((p) => p.tse_status === 'tse_failed').length,
     till[0]?.paid_at ?? null, till[till.length - 1]?.paid_at ?? null,
     input.closedBy ?? null, input.notes ?? null]);
  return { id, closingNumber };
}

export async function listClosings(scope: PropertyScope, filter?: { from?: string; to?: string }) {
  const organizationId = await requireOrganizationId();
  // Вісь обʼєкта — ТИПОМ, а не необовʼязковим полем фільтра (INC-029, Д49).
  // Тут стояло `filter?.propertyId`: чужий обʼєкт давав порожній список
  // замість 404, а слово `all`, яким провайдер пише «усі обʼєкти» в адресу,
  // потрапило б у фільтр ідентифікатором. Колонка `NOT NULL`, тож двері
  // звичайні.
  // Вісь стоїть у САМОМУ шаблоні, а не в масиві `where`, який склеюється
  // нижче: гейт осі бачить оператор із вузла, де `FROM`, і фрагмент, доданий
  // окремим присвоєнням, до нього не доходить — запит рахувався б
  // «невизначеним», тобто виглядав би проскоупленим і лічився як недоведений
  // (Д50). Дати лишаються в масиві: про них гейт нічого не стверджує.
  const axis = propertyScopeFilter(scope, '');
  const extra: string[] = [];
  const params: unknown[] = [organizationId, ...axis.params];
  if (filter?.from) { extra.push('closing_date >= ?'); params.push(filter.from); }
  if (filter?.to) { extra.push('closing_date <= ?'); params.push(filter.to); }
  return await getSql().rows<any>(
    `SELECT * FROM fin_cash_closings
      WHERE organization_id = ? AND ${axis.sql}${extra.map((e) => ` AND ${e}`).join('')}
      ORDER BY closing_date DESC, closing_number DESC`,
    params);
}

/**
 * The till journal for a period — every till payment with its §6 fields.
 * This is the raw material a DSFinV-K export consumes, and readable on its
 * own by an accountant today. CSV with a semicolon, the way German
 * accounting software expects it; values quoted, quotes doubled.
 */
export async function tillJournalCsv(filter: {
  propertyId: string; from: string; to: string;
}): Promise<string> {
  const organizationId = await requireOrganizationId();
  const rows = await getSql().rows<any>(
    `SELECT p.paid_at, p.method, p.amount, i.invoice_number,
            p.tse_status, p.tse_serial, p.tse_tx_number, p.tse_signature_counter,
            p.tse_start_time, p.tse_end_time, p.received_by
       FROM fin_folio_payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.organization_id = ? AND p.property_id = ?
        AND substr(CAST(p.paid_at AS TEXT), 1, 10) >= ?
        AND substr(CAST(p.paid_at AS TEXT), 1, 10) <= ?
        AND p.method IN ('cash','card_terminal')
      ORDER BY p.paid_at`,
    [organizationId, filter.propertyId, filter.from, filter.to]);

  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['paid_at', 'method', 'amount', 'invoice_number', 'tse_status',
    'tse_serial', 'tse_tx_number', 'tse_signature_counter',
    'tse_start_time', 'tse_end_time', 'received_by'];
  return [
    header.join(';'),
    ...rows.map((r) => header.map((h) => q(r[h])).join(';')),
  ].join('\r\n');
}
