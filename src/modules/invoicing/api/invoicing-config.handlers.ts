/**
 * The two things a hotel must be able to say about its own invoices, without
 * anybody editing code: what VAT it charges, and what its numbers look like.
 *
 * Both used to be constants. VAT did not exist at all; the series and the
 * `PREFIX-YYYY-NNN` shape were one customer's arrangement with one accountant.
 * A second country made both untenable — see fin_tax_rates and invoice_series
 * in db/postgres/migrations/0010 and /0011.
 *
 * Owner-only, on purpose. A tax rate is a statement about the company's
 * position with its tax office, and an invoice number is a legal sequence;
 * neither belongs on a receptionist's screen — and «owner-only» is the finance
 * module's own policy, so it is asked here through the finance guard rather
 * than through `withOwner`, which also admits a director. That divergence was
 * live: this file said owner-only in prose while its guard let a director set
 * VAT rates, skipped the finance step-up passphrase and ignored a restricted
 * finance user's read-only flag — on routes under /api/finance/ at that. The
 * guard establishes the tenant too, so every query below is already scoped.
 *
 * Nothing here validates a rate against a country. We do not know what
 * Germany, Czechia or the next jurisdiction will charge next year, and a
 * product that thinks it knows is a product that argues with an accountant.
 */
/**
 * Варта — у фасаді (`api/index.ts`), не тут.
 *
 * Раніше тут стояли `withFinanceRead` / `withFinanceWrite` з `_guard`, а той
 * тримається на фінансовому PIN (`finance_security`). PIN писався, щоб
 * сховати від персоналу прибуток і витрати — і для ставок ПДВ це
 * неправильна варта двічі: по-перше, вона вимагає від рецепції PIN власника
 * там, де та просто виписує документ; по-друге, вона лишає фактурування
 * привʼязаним до модуля обліку, який має вимикатись окремо.
 *
 * Тепер тут звичайні функції, а `withModule('invoicing', …)` у фасаді
 * питає три речі одразу: хто це, чи має право, і чи є в готеля цей модуль.
 */
import { NextResponse } from 'next/server';
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { DEFAULT_TEMPLATE, formatInvoiceNumber } from '../domain/invoice-number-format';
import {
  propertyOrSharedFilter, requirePropertyScope, requestedPropertyParam, scopedPropertyId,
} from '@core/property-scope';

/**
 * Вісь обʼєкта на екрані конфігурації (INC-038, Д54).
 *
 * «не можуть бути одні фінанси на 2 обʼєкти, бо в них різна бухгалтерія і різні
 * правила по ПДВ і всьому можуть бути» — рішення власника 09.09. Тому список
 * показує СВОЄ І СПІЛЬНЕ (`propertyOrSharedFilter`, як Д51: рядок рахунку має
 * бути видимий з обох будинків, інакше спільні ставки зникли б з кожного
 * екрана), а писач ставить обʼєкт з ОБЛАСТІ ЗАПИТУ, не з тіла: тіло приходить
 * від форми, а форма не знає, який будинок обрано в шапці — і саме так
 * зʼявляється рядок, який приписали не тому.
 *
 * «Усі обʼєкти» в шапці означає спільний рядок (NULL), а не рядок першого
 * будинку. Мовчазного дефолту тут не буває (інваріант 8).
 */
const scopeOf = async (request: Request) =>
  await requirePropertyScope(requestedPropertyParam(request.url));

const CODES = ['standard', 'reduced', 'zero'] as const;
const isCode = (v: unknown): v is (typeof CODES)[number] =>
  typeof v === 'string' && (CODES as readonly string[]).includes(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ── VAT rates ───────────────────────────────────────────────────────────────

export const listTaxRates = async (request: Request) => {
  const organizationId = await requireOrganizationId();
  const axis = propertyOrSharedFilter(await scopeOf(request), '');
  const rows = await getSql().rows(
    `SELECT id, code, rate, label, valid_from, valid_to, property_id
       FROM fin_tax_rates WHERE organization_id = ? AND ${axis.sql}
      ORDER BY property_id, code, valid_from DESC`,
    [organizationId, ...axis.params],
  );
  return NextResponse.json({ rates: rows });
};

export const createTaxRate = async (request: Request) => {
  const body = await request.json().catch(() => null) as any;

  if (!isCode(body?.code)) {
    return NextResponse.json({ error: 'code must be standard, reduced or zero' }, { status: 400 });
  }
  const rate = Number(body.rate);
  // 0 is a real rate (zero-rated supplies), so the test is a range, not falsiness.
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return NextResponse.json({ error: 'rate must be a percentage between 0 and 100' }, { status: 400 });
  }
  if (!isDate(body.valid_from)) {
    return NextResponse.json({ error: 'valid_from must be YYYY-MM-DD' }, { status: 400 });
  }
  if (body.valid_to != null && !isDate(body.valid_to)) {
    return NextResponse.json({ error: 'valid_to must be YYYY-MM-DD or empty' }, { status: 400 });
  }
  if (body.valid_to && body.valid_to < body.valid_from) {
    return NextResponse.json({ error: 'valid_to is before valid_from' }, { status: 400 });
  }

  // organization_id written explicitly.
  //
  // AGENTS §3.12 says a scoped INSERT need not name it — but that DEFAULT is a
  // Postgres mechanism (migration 0005) and SQLite, which every developer
  // machine runs, has no equivalent. Omitting it there wrote rows with a NULL
  // tenant: the INSERT answered 201 and the list came back empty.
  const organizationId = await requireOrganizationId();
  const propertyId = scopedPropertyId(await scopeOf(request));
  const id = crypto.randomUUID();
  await getSql().run(
    `INSERT INTO fin_tax_rates (id, organization_id, property_id, code, rate, label, valid_from, valid_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizationId, propertyId, body.code, rate, body.label ?? null, body.valid_from, body.valid_to || null],
  );
  return NextResponse.json({ id }, { status: 201 });
};

/**
 * Close a rate rather than delete it.
 *
 * A rate that has been used is written onto charges that are already invoiced.
 * Deleting the row does not un-charge them, but it does destroy the record of
 * what the hotel was charging and when — which is the one thing a tax audit
 * asks for. So the only edit offered is an end date.
 */
export const closeTaxRate = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => null) as any;
  if (!isDate(body?.valid_to)) {
    return NextResponse.json({ error: 'valid_to must be YYYY-MM-DD' }, { status: 400 });
  }
  const organizationId = await requireOrganizationId();
  const res = await getSql().run(
    'UPDATE fin_tax_rates SET valid_to = ? WHERE id = ? AND organization_id = ?',
    [body.valid_to, id, organizationId],
  );
  if (res.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
};

/**
 * A rate that has never been used may be removed outright — a typo entered
 * two minutes ago is not history worth keeping. Once a charge carries it, the
 * only exit is an end date.
 *
 * The usage test is deliberately absent for now: no table yet stores charges
 * with a rate on them (that is the folio work). When fin_folio_items lands,
 * this must start refusing. Written down here rather than left to be
 * rediscovered.
 */
export const deleteTaxRate = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const organizationId = await requireOrganizationId();
  const res = await getSql().run(
    'DELETE FROM fin_tax_rates WHERE id = ? AND organization_id = ?',
    [id, organizationId],
  );
  if (res.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
};

// ── Invoice series ──────────────────────────────────────────────────────────

export const listInvoiceSeries = async (request: Request) => {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const scope = await scopeOf(request);
  const axis = propertyOrSharedFilter(scope, '');
  const rows = await sql.rows<any>(
    `SELECT id, code, channel, prefix, number_format, is_default, sort_order, property_id
       FROM invoice_series WHERE organization_id = ? AND ${axis.sql}
      ORDER BY property_id, sort_order, code`,
    [organizationId, ...axis.params],
  );
  // Where each series has actually got to. An operator configuring numbering
  // needs to see this: it is what says whether a change is still free.
  //
  // Лічильник шукається за РЯДКОМ серії, не за її кодом: два будинки можуть
  // тримати один код і два незалежні прогони (Д54), і `.find()` за самим кодом
  // показав би одному будинку чужий номер — саме той рід помилки, який AGENTS §7
  // називає «твердження про рядок, якого може бути кілька».
  const counters = await sql.rows<any>(
    `SELECT series, year, last_no, property_id FROM invoice_counters
      WHERE organization_id = ? AND ${axis.sql}`,
    [organizationId, ...axis.params],
  );
  const year = new Date().getFullYear();
  return NextResponse.json({
    series: rows.map((r) => {
      const used = counters.find((c) => c.series === r.code && Number(c.year) === year
        && (c.property_id ?? null) === (r.property_id ?? null));
      return {
        ...r,
        last_no: used?.last_no ?? 0,
        // What the next number will look like, so nobody has to imagine it.
        preview: formatInvoiceNumber(r.number_format || DEFAULT_TEMPLATE, {
          prefix: r.prefix ?? '',
          year,
          seq: (used?.last_no ?? 0) + 1,
        }),
      };
    }),
    default_template: DEFAULT_TEMPLATE,
  });
};

export const createInvoiceSeries = async (request: Request) => {
  const body = await request.json().catch(() => null) as any;
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{1,16}$/.test(code)) {
    return NextResponse.json({ error: 'code: 1–16 characters, A–Z 0–9 _ -' }, { status: 400 });
  }

  const template = body.number_format || DEFAULT_TEMPLATE;
  // A template with no counter in it would issue the same number forever.
  if (!/\{seq(?::\d+)?\}/.test(template)) {
    return NextResponse.json({ error: 'number_format must contain {seq}' }, { status: 400 });
  }

  const organizationId = await requireOrganizationId();
  const sql = getSql();
  // Зіткнення коду — В МЕЖАХ БУДИНКУ, не рахунку (Д54). Саме заради цього і
  // знімався `UNIQUE (organization_id, code)`: два будинки з двома
  // бухгалтеріями можуть мати кожен свою серію під тим самим кодом.
  const propertyId = scopedPropertyId(await scopeOf(request));
  const clash = await sql.row(
    `SELECT id FROM invoice_series
      WHERE organization_id = ? AND COALESCE(property_id, '') = ? AND code = ?`,
    [organizationId, propertyId ?? '', code],
  );
  if (clash) return NextResponse.json({ error: 'This series already exists' }, { status: 409 });

  // is_default goes in as a SQL literal: better-sqlite3 refuses a JS boolean as
  // a bound value, and Postgres refuses the integer 1 in a BOOLEAN column.
  const id = crypto.randomUUID();
  await sql.run(
    `INSERT INTO invoice_series (id, organization_id, property_id, code, channel, prefix, number_format, is_default, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${body.is_default ? 'TRUE' : 'FALSE'}, ?)`,
    [id, organizationId, propertyId, code, body.channel || null, body.prefix ?? '', template,
     Number(body.sort_order) || 0],
  );
  if (body.is_default) await clearOtherDefaults(id, organizationId, propertyId);
  return NextResponse.json({ id }, { status: 201 });
};

export const updateInvoiceSeries = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = await request.json().catch(() => null) as any;
  const template = body?.number_format;
  if (template != null && !/\{seq(?::\d+)?\}/.test(template)) {
    return NextResponse.json({ error: 'number_format must contain {seq}' }, { status: 400 });
  }

  const organizationId = await requireOrganizationId();
  // `code` is not editable. Renaming a series moves its counter: the numbers
  // already issued under the old name stay behind and the new name starts at 1.
  // Whoever wants that can create a second series deliberately.
  const res = await getSql().run(
    `UPDATE invoice_series
        SET channel = ?, prefix = ?, number_format = COALESCE(?, number_format),
            is_default = ${body.is_default ? 'TRUE' : 'FALSE'}, sort_order = ?
      WHERE id = ? AND organization_id = ?`,
    [body.channel || null, body.prefix ?? '', template ?? null,
     Number(body.sort_order) || 0, id, organizationId],
  );
  if (res.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (body.is_default) {
    const row = await getSql().row<{ property_id: string | null }>(
      'SELECT property_id FROM invoice_series WHERE id = ? AND organization_id = ?', [id, organizationId]);
    await clearOtherDefaults(id, organizationId, row?.property_id ?? null);
  }
  return NextResponse.json({ ok: true });
};

export const deleteInvoiceSeries = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  // A series that has issued a number is not removable. The counter is the
  // evidence that documents exist under it; deleting the series would make the
  // application fall back to the built-in map and re-issue numbers that are
  // already on paper.
  const row = await sql.row<any>(
    'SELECT code, property_id FROM invoice_series WHERE id = ? AND organization_id = ?', [id, organizationId]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Лічильник ЦЬОГО рядка: серія сусіднього будинку під тим самим кодом веде
  // свій прогін, і його номери не є доказом про цей рядок ані в один бік.
  const used = await sql.row<any>(
    `SELECT last_no FROM invoice_counters
      WHERE organization_id = ? AND COALESCE(property_id, '') = ? AND series = ?`,
    [organizationId, row.property_id ?? '', row.code]);
  if (used && Number(used.last_no) > 0) {
    return NextResponse.json(
      { error: 'This series has already issued invoices and cannot be removed' },
      { status: 409 },
    );
  }

  await sql.run('DELETE FROM invoice_series WHERE id = ? AND organization_id = ?', [id, organizationId]);
  return NextResponse.json({ ok: true });
};

/**
 * Exactly one default, or the fallback order stops being predictable — але
 * рівно один НА БУДИНОК (Д54): дефолт будинку А не сміє знімати дефолт
 * будинку Б, інакше кожне збереження в одному обʼєкті мовчки лишало б інший
 * без серії за замовчуванням.
 */
async function clearOtherDefaults(
  keepId: string, organizationId: string, propertyId: string | null,
): Promise<void> {
  await getSql().run(
    `UPDATE invoice_series SET is_default = FALSE
      WHERE organization_id = ? AND COALESCE(property_id, '') = ? AND id <> ?`,
    [organizationId, propertyId ?? '', keepId],
  );
}
