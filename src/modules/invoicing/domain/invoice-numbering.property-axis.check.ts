/**
 * Дві бухгалтерії — два прогони номерів (INC-038, Д54).
 *
 *   node src/modules/invoicing/domain/invoice-numbering.property-axis.check.ts
 *
 * ── Що ламається ────────────────────────────────────────────────────────
 *
 * `invoice_series` не мала `property_id`, а `UNIQUE (organization_id, code)`
 * не пускав двом будинкам мати кожен СВОЮ серію з тим самим кодом. Готель із
 * двома обʼєктами і двома бухгалтеріями діставав одну наскрізну нумерацію на
 * обидва — а номер фактури це ідентифікатор документа юридичної особи.
 *
 * Знявши той UNIQUE (Д54), ми відкриваємо саме той випадок, задля якого його
 * знімали: дві серії з кодом `FA`, у різних будинках. І тут вилазить друга
 * половина, якої в Д54 не написано, бо її не було видно зі схеми:
 * `invoice_counters` і `invoice_periods` ключовані `(організація, серія,
 * рік/місяць)`. Дві серії з однаковим кодом ділять ОДИН лічильник і ОДИН
 * замок періоду — тобто зняття UNIQUE без осі на цих двох таблицях не
 * розвʼязує дві бухгалтерії, а ламає нумерацію мовчки: другий будинок
 * продовжує чужий прогін, а закриття місяця в одному замикає документи
 * іншого.
 *
 * Тому лічильник і період належать РЯДКОВІ СЕРІЇ, а не її коду.
 *
 * ── Старшинство ─────────────────────────────────────────────────────────
 *
 * Серія береться за будинком фактури; свого рядка немає — спільний
 * (`property_id IS NULL`). Той самий взірець, що Д51.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * 1. Будинок: два обʼєкти, і числа несумісні — якби лічильник був спільний,
 *    перший номер будинку Б був би 004, а не 001.
 * 2. Префікс: `A-`, `B-`, `SH-` — три різні, тож «узяли не ту серію» видно в
 *    самому номері, а не лише в полі `series`.
 * 3. Код серії в обох будинків НАВМИСНО ОДНАКОВИЙ (`FA`). Сцена з різними
 *    кодами була б зелена й на коді, який осі не має взагалі: два різні коди
 *    дають два лічильники самі собою. Саме однаковий код і є випадок Д54.
 *
 * Обидва рушії: `ON CONFLICT` з виразом у цілі й `COALESCE` по нульовій
 * колонці — рівно те місце, де SQLite і Postgres розходяться (клас INC-011).
 */
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { PGlite } from '@electric-sql/pglite';
import {
  allocateInvoiceNumber, lockPeriod, isPeriodLocked, isInvoiceLocked,
} from './invoice-numbering.ts';
import { sqliteSql, type Sql } from '../../../core/db/async.ts';
import { postgresSql, type PgConnection } from '../../../core/db/postgres.ts';

const ORG = 'org_two_books';
const PA = 'prop_a';
const PB = 'prop_b';
const YEAR = 2026;

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

/**
 * `invoices` НЕ має власного `property_id` — це перевірено по схемі, а не
 * припущено: будинок документа виводиться з броні, а для фоліо без броні — з
 * фоліо. Перша версія цієї сцени оголошувала колонку, якої в базі немає, і
 * була зелена на коді, який у справжній базі впав би на першому ж запиті:
 * фікстура, зроблена з уявлення, а не зі схеми (клас інваріанта 28).
 *
 * Тому обидва шляхи тут справжні і РІЗНІ: документ А приходить через бронь,
 * документ Б — через фоліо. З одним шляхом половина `COALESCE` не перевіряється
 * взагалі.
 */
type InsertInvoice = (id: string, property: string, series: string, no: string, via: 'reservation' | 'folio') => Promise<void>;

async function claims(sql: Sql, engine: string, insertInvoice: InsertInvoice) {
  const say2 = (cond: boolean, what: string) => say(cond, `${engine}: ${what}`);

  // ── Спільна серія: обидва будинки в одному прогоні ───────────────────────
  //
  // Це стан рахунку, який про обʼєкти не думає, і він мусить лишитись таким,
  // яким був: одна серія — один прогін, незалежно від того, у якому будинку
  // виписано документ.
  await sql.run(
    `INSERT INTO invoice_series (id, organization_id, property_id, code, channel, prefix, number_format, is_default)
     VALUES (?, ?, NULL, ?, ?, ?, ?, TRUE)`,
    ['s_shared', ORG, 'SH', 'house', 'SH-', '{prefix}{year}-{seq:3}'],
  );

  const sh1 = await allocateInvoiceNumber(sql, ORG, PA, 'house', YEAR);
  const sh2 = await allocateInvoiceNumber(sql, ORG, PB, 'house', YEAR);
  say2(sh1.invoiceNumber === 'SH-2026-001', `будинок А зі спільної серії, отримали ${sh1.invoiceNumber}`);
  say2(sh2.invoiceNumber === 'SH-2026-002',
    `будинок Б продовжує ТОЙ САМИЙ прогін спільної серії, отримали ${sh2.invoiceNumber}`);

  // ── Кожен будинок називає свою серію — і код у них ОДНАКОВИЙ ─────────────

  await sql.run(
    `INSERT INTO invoice_series (id, organization_id, property_id, code, channel, prefix, number_format, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)`,
    ['s_a', ORG, PA, 'FA', 'house', 'A-', '{prefix}{year}-{seq:3}'],
  );
  await sql.run(
    `INSERT INTO invoice_series (id, organization_id, property_id, code, channel, prefix, number_format, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)`,
    ['s_b', ORG, PB, 'FA', 'house', 'B-', '{prefix}{year}-{seq:3}'],
  );

  const a1 = await allocateInvoiceNumber(sql, ORG, PA, 'house', YEAR);
  say2(a1.series === 'FA' && a1.invoiceNumber === 'A-2026-001',
    `будинок А бере СВОЮ серію і починає свій прогін, отримали ${a1.invoiceNumber}`);

  const a2 = await allocateInvoiceNumber(sql, ORG, PA, 'house', YEAR);
  const a3 = await allocateInvoiceNumber(sql, ORG, PA, 'house', YEAR);
  say2(a3.invoiceNumber === 'A-2026-003', `третій номер А, отримали ${a3.invoiceNumber}`);

  // Ось вісь. Спільний лічильник по коду `FA` дав би тут 004.
  const b1 = await allocateInvoiceNumber(sql, ORG, PB, 'house', YEAR);
  say2(b1.invoiceNumber === 'B-2026-001',
    `будинок Б починає ВЛАСНИЙ прогін під тим самим кодом, отримали ${b1.invoiceNumber}`);

  const b2 = await allocateInvoiceNumber(sql, ORG, PB, 'house', YEAR);
  say2(b2.invoiceNumber === 'B-2026-002', `другий номер Б, отримали ${b2.invoiceNumber}`);

  // І назад: спільний лічильник дав би 006.
  const a4 = await allocateInvoiceNumber(sql, ORG, PA, 'house', YEAR);
  say2(a4.invoiceNumber === 'A-2026-004',
    `прогін А не зрушився від пʼяти документів Б, отримали ${a4.invoiceNumber}`);

  // ── Фоліо без будинку — спільна серія, як і було ─────────────────────────
  const none = await allocateInvoiceNumber(sql, ORG, null, 'house', YEAR);
  say2(none.invoiceNumber === 'SH-2026-003',
    `документ без обʼєкта йде спільною серією, отримали ${none.invoiceNumber}`);
  say2(none.seriesPropertyId === null, 'і його прогін — спільний, не будинковий');
  say2(a4.seriesPropertyId === PA, 'а прогін А названо будинком А');

  // ── Замок місяця теж належить рядкові серії ──────────────────────────────
  //
  // Без осі закриття місяця в будинку А заморозило б документи Б: код серії в
  // них один.
  await insertInvoice('inv_a', PA, 'FA', a1.invoiceNumber, 'reservation');
  await insertInvoice('inv_b', PB, 'FA', b1.invoiceNumber, 'folio');

  await lockPeriod(sql, ORG, PA, 'FA', '2026-01');
  say2(await isPeriodLocked(sql, ORG, PA, 'FA', '2026-01') === true, 'місяць А закрито');
  say2(await isPeriodLocked(sql, ORG, PB, 'FA', '2026-01') === false,
    'замок А НЕ закрив той самий місяць у Б');
  say2(await isInvoiceLocked(sql, ORG, 'inv_a') === true, 'фактура А заморожена');
  say2(await isInvoiceLocked(sql, ORG, 'inv_b') === false,
    'фактура Б не заморожена чужим замком');
}

// ─── SQLite ─────────────────────────────────────────────────────────────────
{
  const db = new Database(':memory:');
  const sql = sqliteSql(db);
  await sql.exec(`
    CREATE TABLE invoice_series (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, property_id TEXT, code TEXT NOT NULL,
      channel TEXT, prefix TEXT NOT NULL DEFAULT '',
      number_format TEXT NOT NULL DEFAULT '{prefix}{year}-{seq:3}',
      reset_yearly BOOLEAN NOT NULL DEFAULT TRUE, is_default BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX idx_invoice_series_row
      ON invoice_series(organization_id, (COALESCE(property_id, '')), code);
    CREATE TABLE invoice_counters (
      organization_id TEXT NOT NULL, property_id TEXT, series TEXT NOT NULL, year INTEGER NOT NULL,
      last_no INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX idx_invoice_counters_row
      ON invoice_counters(organization_id, (COALESCE(property_id, '')), series, year);
    CREATE TABLE invoice_periods (
      organization_id TEXT NOT NULL, property_id TEXT, series TEXT NOT NULL, month TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', locked_at TEXT
    );
    CREATE UNIQUE INDEX idx_invoice_periods_row
      ON invoice_periods(organization_id, (COALESCE(property_id, '')), series, month);
    CREATE TABLE reservations (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, property_id TEXT);
    CREATE TABLE fin_folios (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, property_id TEXT);
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
      reservation_id TEXT, folio_id TEXT, invoice_number TEXT NOT NULL,
      series TEXT, period TEXT, issued_at TEXT, locked INTEGER NOT NULL DEFAULT 0,
      UNIQUE (organization_id, invoice_number)
    );
  `);
  await claims(sql, 'sqlite', insertVia(sql));
}

/**
 * Той самий документ, підвішений на бронь або на фоліо — двома шляхами, якими
 * будинок і виводиться в базі.
 */
function insertVia(sql: Sql): InsertInvoice {
  return async (id, property, series, no, via) => {
    const anchor = `${id}_${via}`;
    if (via === 'reservation') {
      await sql.run('INSERT INTO reservations (id, organization_id, property_id) VALUES (?, ?, ?)', [anchor, ORG, property]);
    } else {
      await sql.run('INSERT INTO fin_folios (id, organization_id, property_id) VALUES (?, ?, ?)', [anchor, ORG, property]);
    }
    await sql.run(
      `INSERT INTO invoices (id, organization_id, reservation_id, folio_id, invoice_number, series, period)
       VALUES (?, ?, ?, ?, ?, ?, '2026-01')`,
      [id, ORG, via === 'reservation' ? anchor : null, via === 'folio' ? anchor : null, no, series]);
  };
}

// ─── Postgres ───────────────────────────────────────────────────────────────
// Типи — ті, що оголошує `db/postgres/schema.sql`: `period` TEXT, `issued_at`
// TIMESTAMPTZ. Оголосити тут обидва TEXT означало б файл, який проходить і не
// доводить нічого — так уже було з цим самим модулем.
{
  const pg = new PGlite();
  const conn: PgConnection = {
    query: async (text, params) => {
      const r = await pg.query(text, params as unknown[]);
      return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length };
    },
    exec: (text) => pg.exec(text),
    release: () => { /* одне зʼєднання */ },
  };
  const sql = postgresSql({ ...conn, connect: async () => conn });

  await sql.exec(`
    CREATE TABLE invoice_series (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, property_id TEXT, code TEXT NOT NULL,
      channel TEXT, prefix TEXT NOT NULL DEFAULT '',
      number_format TEXT NOT NULL DEFAULT '{prefix}{year}-{seq:3}',
      reset_yearly BOOLEAN NOT NULL DEFAULT TRUE, is_default BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order BIGINT NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX idx_invoice_series_row
      ON invoice_series(organization_id, (COALESCE(property_id, '')), code);
    CREATE TABLE invoice_counters (
      organization_id TEXT NOT NULL, property_id TEXT, series TEXT NOT NULL, year BIGINT NOT NULL,
      last_no BIGINT NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX idx_invoice_counters_row
      ON invoice_counters(organization_id, (COALESCE(property_id, '')), series, year);
    CREATE TABLE invoice_periods (
      organization_id TEXT NOT NULL, property_id TEXT, series TEXT NOT NULL, month TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', locked_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX idx_invoice_periods_row
      ON invoice_periods(organization_id, (COALESCE(property_id, '')), series, month);
    CREATE TABLE reservations (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, property_id TEXT);
    CREATE TABLE fin_folios (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, property_id TEXT);
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
      reservation_id TEXT, folio_id TEXT, invoice_number TEXT NOT NULL,
      series TEXT, period TEXT, issued_at TIMESTAMPTZ DEFAULT now(),
      locked BOOLEAN NOT NULL DEFAULT false,
      UNIQUE (organization_id, invoice_number)
    );
  `);
  await claims(sql, 'postgres', insertVia(sql));
  await pg.close();
}

if (fails.length) {
  console.log(`\ninvoice-numbering.property-axis: ${fails.length} червоних`);
  process.exit(1);
}
console.log('invoice-numbering.property-axis: два будинки під одним кодом — два прогони і два замки, на обох рушіях');
assert.ok(true);
