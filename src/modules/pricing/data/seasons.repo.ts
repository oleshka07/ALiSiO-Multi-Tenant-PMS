/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import { getSql, type Sql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import { bulkUpdatePrices } from './price-calendar.repo';

/**
 * Сезони (Блок 2 крок 1, Ц27): правило, яке РЕНДЕРИТЬСЯ в календар.
 *
 *   node src/modules/pricing/data/seasons.repo.check.ts
 *
 * ── Сезон не є джерелом ціни ────────────────────────────────────────────
 *
 * Клітинка `season_prices` (сезон × тип × тариф) не читається котируванням.
 * Її запис розгортає ночі сезону в `price_calendar` ТИМ САМИМ писачем, що
 * масовий редактор (`bulkUpdatePrices`): через двері `@channels/outbox` у
 * тій самій транзакції (Ц16), одним діапазоном на пару на весь сезон (Ц15),
 * з маскою полів із різниці (Ц34). Канал і віджет читають календар, як і
 * досі — інваріант 16 цілий, другого джерела ціни немає. Тому тут немає
 * жодного SQL до `price_calendar`: усе, що торкається ціни ночі, іде через
 * `price-calendar.repo.ts`.
 *
 * ── Перевизначення дати живе ────────────────────────────────────────────
 *
 * Рядок календаря з `source = 'manual'` і ціною — точкове перевизначення
 * (редактор дня, масовий). Перерендер сезону його обходить (`keepManual`);
 * «прибрати перевизначення» — той самий рендер без прапорця, і лише він.
 * Усі рядки, набрані до появи сезонів, — `manual` (0068): сезон поверх них
 * застосується там, де ціни не було, або після «прибрати перевизначення».
 *
 * ── Без перетинів ───────────────────────────────────────────────────────
 *
 * Два сезони обʼєкта на одну ніч — дві ціни на одну ніч. Тримає писач:
 * інтервальне обмеження одне на два двигуни в схемі не сказати. Поділ
 * (`splitSeason`) — єдиний спосіб змінити межу всередині: ліва частина до
 * дня перед датою, права — від дати, клітинки копіюються.
 *
 * ── Орендар ─────────────────────────────────────────────────────────────
 *
 * Обʼєкт і сезон доводяться своїми через `properties.organization_id`
 * (чуже — `property_not_found` / `season_not_found`, інваріант 5); запис
 * називає `organization_id` явно (інваріант 12).
 */

export interface Season {
  id: string;
  propertyId: string;
  name: string;
  /** Перша ніч сезону. */
  dateFrom: string;
  /** Остання ніч сезону, включно (NAMING §2). */
  dateTo: string;
  sortOrder: number;
  /** Скільки клітинок ціни заведено. */
  cells: number;
  /**
   * Скільки ночей сезону (на типах обʼєкта, у будь-якому рядку — типу чи
   * тарифу) мають ручне перевизначення ціни (`source = 'manual'` з ціною):
   * їх перерендер сезону не чіпає, і оператор має це бачити (рецензія 07.09
   * п.5) — інакше новий сезон у готелі з набраним календарем «нічого не міняє».
   */
  manualOverrides: number;
}

export interface SeasonPriceCell {
  id: string;
  seasonId: string;
  unitTypeId: string;
  /** NULL — базова ціна типу в сезоні. */
  ratePlanId: string | null;
  price: number;
  weekendPrice: number | null;
}

export interface SeasonInput {
  propertyId: string;
  name: string;
  dateFrom: string;
  dateTo: string;
}

export interface SeasonPriceInput {
  unitTypeId: string;
  ratePlanId: string | null;
  price: number;
  weekendPrice: number | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function requireOrganizationId(): string {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('seasons: without a tenant');
  return organizationId;
}

function assertDates(dateFrom: string, dateTo: string): void {
  if (!ISO_DATE.test(dateFrom) || !ISO_DATE.test(dateTo) || dateTo < dateFrom) throw new Error('season_dates_invalid');
}

function assertPositive(value: unknown, allowNull = false): void {
  if (allowNull && value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('price_not_positive');
}

async function ownedProperty(t: Sql, propertyId: string): Promise<{ id: string }> {
  const row = await t.row<any>('SELECT id FROM properties WHERE id = ? AND organization_id = ?', [propertyId, requireOrganizationId()]);
  if (!row) throw new Error('property_not_found');
  return { id: String(row.id) };
}

async function ownedSeasonRow(t: Sql, id: string): Promise<any> {
  const row = await t.row<any>(
    `SELECT s.* FROM seasons s JOIN properties p ON p.id = s.property_id
      WHERE s.id = ? AND s.organization_id = ? AND p.organization_id = ?`,
    [id, requireOrganizationId(), requireOrganizationId()],
  );
  if (!row) throw new Error('season_not_found');
  return row;
}

/** Перетин з іншим сезоном обʼєкта — відмова. Межі включно з обох боків. */
async function assertNoOverlap(t: Sql, propertyId: string, dateFrom: string, dateTo: string, exceptId: string | null): Promise<void> {
  const clash = await t.row<any>(
    `SELECT id FROM seasons WHERE property_id = ? AND organization_id = ? AND id <> ? AND date_from <= ? AND date_to >= ? LIMIT 1`,
    [propertyId, requireOrganizationId(), exceptId ?? '', dateTo, dateFrom],
  );
  if (clash) throw new Error('season_overlap');
}

const day = (v: unknown) => String(v).slice(0, 10);

function toSeason(row: any, cells: number, manualOverrides = 0): Season {
  return {
    id: String(row.id), propertyId: String(row.property_id), name: String(row.name),
    dateFrom: day(row.date_from), dateTo: day(row.date_to), sortOrder: Number(row.sort_order) || 0, cells, manualOverrides,
  };
}

/**
 * Ручні перевизначення ціни в межах сезонів — по сезону.
 * `price_calendar.date` на Postgres — DATE, межі сезону — TEXT (pg-schema типізує
 * лише `^date$`/`_date$`); порівняння без приведення там падає оператором
 * (INC-011, SQLite цього не бачить). Дата текстом `YYYY-MM-DD` порівнюється лексично правильно.
 */
async function manualOverrideCounts(sql: Sql, seasonIds: string[]): Promise<Map<string, number>> {
  if (seasonIds.length === 0) return new Map();
  const rows = await sql.rows<any>(
    `SELECT s.id AS season_id, COUNT(*) AS n
       FROM seasons s
       JOIN unit_types ut ON ut.property_id = s.property_id
       JOIN price_calendar pc ON pc.unit_type_id = ut.id
        AND CAST(pc.date AS TEXT) >= s.date_from AND CAST(pc.date AS TEXT) <= s.date_to
      WHERE s.id IN (${seasonIds.map(() => '?').join(', ')}) AND s.organization_id = ?
        AND pc.source = 'manual' AND pc.base_price IS NOT NULL
      GROUP BY s.id`,
    [...seasonIds, requireOrganizationId()],
  );
  return new Map(rows.map((r) => [String(r.season_id), Number(r.n)]));
}

function toCell(row: any): SeasonPriceCell {
  return {
    id: String(row.id), seasonId: String(row.season_id), unitTypeId: String(row.unit_type_id),
    ratePlanId: row.rate_plan_id == null ? null : String(row.rate_plan_id),
    price: Number(row.price), weekendPrice: row.weekend_price == null ? null : Number(row.weekend_price),
  };
}

async function cellCounts(t: Sql, seasonIds: string[]): Promise<Map<string, number>> {
  if (!seasonIds.length) return new Map();
  const rows = await t.rows<any>(
    `SELECT season_id, COUNT(*) AS n FROM season_prices WHERE season_id IN (${seasonIds.map(() => '?').join(', ')}) AND organization_id = ? GROUP BY season_id`,
    [...seasonIds, requireOrganizationId()],
  );
  return new Map(rows.map((r) => [String(r.season_id), Number(r.n)]));
}

/** Сезони обʼєкта за початком; минулі (кінець до сьогодні) — лише на запит. */
export async function listSeasons(propertyId: string, options: { includePast?: boolean; today?: string } = {}): Promise<Season[]> {
  const sql = getSql();
  const organizationId = requireOrganizationId();
  const rows = await sql.rows<any>(
    `SELECT s.* FROM seasons s JOIN properties p ON p.id = s.property_id
      WHERE s.property_id = ? AND s.organization_id = ? AND p.organization_id = ?
        ${options.includePast ? '' : 'AND s.date_to >= ?'}
      ORDER BY s.date_from, s.id`,
    options.includePast ? [propertyId, organizationId, organizationId] : [propertyId, organizationId, organizationId, options.today ?? todayIso()],
  );
  const ids = rows.map((r) => String(r.id));
  const counts = await cellCounts(sql, ids);
  const overrides = await manualOverrideCounts(sql, ids);
  return rows.map((r) => toSeason(r, counts.get(String(r.id)) ?? 0, overrides.get(String(r.id)) ?? 0));
}

export async function getSeason(id: string): Promise<Season> {
  const sql = getSql();
  const row = await ownedSeasonRow(sql, id);
  return toSeason(row, (await cellCounts(sql, [id])).get(id) ?? 0, (await manualOverrideCounts(sql, [id])).get(id) ?? 0);
}

export async function createSeason(input: SeasonInput): Promise<Season> {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('season_name_required');
  assertDates(input.dateFrom, input.dateTo);
  return getSql().tx(async (t) => {
    const property = await ownedProperty(t, input.propertyId);
    await assertNoOverlap(t, property.id, input.dateFrom, input.dateTo, null);
    const next = await t.row<any>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM seasons WHERE property_id = ?', [property.id]);
    const id = `season_${crypto.randomBytes(8).toString('hex')}`;
    await t.run(
      `INSERT INTO seasons (id, organization_id, property_id, name, date_from, date_to, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, requireOrganizationId(), property.id, name, input.dateFrom, input.dateTo, Number(next?.n ?? 1)],
    );
    return toSeason(await t.row<any>('SELECT * FROM seasons WHERE id = ?', [id]), 0);
  });
}

/**
 * Змінити назву або межі. Нові межі — без перетину з іншими сезонами. Ночі,
 * які вийшли з сезону при звуженні, лишаються з ціною в календарі: сезон —
 * конфігурація, а не джерело, і забрати ціну з дати означало б закрити її в
 * каналі мовчки. Ночі, які ввійшли при розширенні, дістають ціну рендером.
 */
export async function updateSeason(id: string, patch: Partial<Pick<SeasonInput, 'name' | 'dateFrom' | 'dateTo'>>): Promise<Season> {
  const sql = getSql();
  const before = await ownedSeasonRow(sql, id);
  const name = patch.name === undefined ? String(before.name) : String(patch.name).trim();
  if (!name) throw new Error('season_name_required');
  const dateFrom = patch.dateFrom ?? day(before.date_from);
  const dateTo = patch.dateTo ?? day(before.date_to);
  assertDates(dateFrom, dateTo);
  await sql.tx(async (t) => {
    await assertNoOverlap(t, String(before.property_id), dateFrom, dateTo, id);
    await t.run('UPDATE seasons SET name = ?, date_from = ?, date_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?',
      [name, dateFrom, dateTo, id, requireOrganizationId()]);
  });
  if (dateFrom !== day(before.date_from) || dateTo !== day(before.date_to)) {
    for (const cell of await seasonPrices(id)) await renderCell({ dateFrom, dateTo }, cell, true);
  }
  return getSeason(id);
}

/** Видалити сезон і його клітинки. Ціни в календарі лишаються — див. `updateSeason`. */
export async function deleteSeason(id: string): Promise<void> {
  const sql = getSql();
  await ownedSeasonRow(sql, id);
  await sql.tx(async (t) => {
    await t.run('DELETE FROM season_prices WHERE season_id = ? AND organization_id = ?', [id, requireOrganizationId()]);
    await t.run('DELETE FROM seasons WHERE id = ? AND organization_id = ?', [id, requireOrganizationId()]);
  });
}

export async function seasonPrices(seasonId: string): Promise<SeasonPriceCell[]> {
  const sql = getSql();
  await ownedSeasonRow(sql, seasonId);
  const rows = await sql.rows<any>(
    'SELECT * FROM season_prices WHERE season_id = ? AND organization_id = ? ORDER BY unit_type_id, rate_plan_id',
    [seasonId, requireOrganizationId()],
  );
  return rows.map(toCell);
}

/**
 * Рендер однієї клітинки в календар — писачем масового редактора.
 *
 * `keepManual` — обходити перевизначення дат (звичайний рендер); без нього
 * — «прибрати перевизначення». Обмеження дня писач не чіпає: у запиті лише
 * поля ціни. Координата в черзі — одна на пару на весь сезон (Ц15).
 */
async function renderCell(season: { dateFrom: string; dateTo: string }, cell: SeasonPriceCell, keepManual: boolean): Promise<void> {
  await bulkUpdatePrices({
    unitTypeId: cell.unitTypeId,
    dateFrom: season.dateFrom,
    dateTo: season.dateTo,
    applyTo: 'all',
    base_price: cell.price,
    weekend_price: cell.weekendPrice,
    ratePlanId: cell.ratePlanId ?? undefined,
    source: 'season',
    keepManual,
  });
}

/**
 * Записати клітинку сезон × тип × тариф і розгорнути її в календар.
 *
 * Тип — обʼєкта сезону; тариф — того ж обʼєкта, або NULL (базова ціна типу).
 * Нуль і відʼємне — не ціна (Ц24). Наявна клітинка перезаписується: одна
 * клітинка на трійку тримає індекс, не порядок викликів.
 */
export async function setSeasonPrice(seasonId: string, input: SeasonPriceInput): Promise<SeasonPriceCell> {
  const sql = getSql();
  const season = await ownedSeasonRow(sql, seasonId);
  assertPositive(input.price);
  assertPositive(input.weekendPrice, true);
  const organizationId = requireOrganizationId();
  const unitType = await sql.row<any>('SELECT id FROM unit_types WHERE id = ? AND property_id = ?', [input.unitTypeId, season.property_id]);
  if (!unitType) throw new Error('unit_type_not_found');
  if (input.ratePlanId) {
    const plan = await sql.row<any>('SELECT id, pricing_type FROM rate_plans WHERE id = ? AND property_id = ?', [input.ratePlanId, season.property_id]);
    if (!plan) throw new Error('rate_plan_not_found');
    // Похідний тариф (Ц28) не має власних цін — його рядки рахує перерендер
    // бази, і клітинка сезону їх переписала б (рецензія 07.09 п.4).
    if (String(plan.pricing_type ?? 'manual') === 'derived') throw new Error('rate_plan_derived');
  }
  await sql.run(
    `INSERT INTO season_prices (id, organization_id, season_id, unit_type_id, rate_plan_id, price, weekend_price)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (season_id, unit_type_id, (COALESCE(rate_plan_id, ''))) DO UPDATE SET
       price = excluded.price, weekend_price = excluded.weekend_price, updated_at = CURRENT_TIMESTAMP`,
    [`sp_${crypto.randomBytes(8).toString('hex')}`, organizationId, seasonId, input.unitTypeId, input.ratePlanId ?? null, input.price, input.weekendPrice ?? null],
  );
  const cell = toCell(await sql.row<any>(
    'SELECT * FROM season_prices WHERE season_id = ? AND unit_type_id = ? AND COALESCE(rate_plan_id, \'\') = ? AND organization_id = ?',
    [seasonId, input.unitTypeId, input.ratePlanId ?? '', organizationId],
  ));
  await renderCell({ dateFrom: day(season.date_from), dateTo: day(season.date_to) }, cell, true);
  return cell;
}

export async function deleteSeasonPrice(seasonId: string, unitTypeId: string, ratePlanId: string | null): Promise<void> {
  const sql = getSql();
  await ownedSeasonRow(sql, seasonId);
  await sql.run(
    'DELETE FROM season_prices WHERE season_id = ? AND unit_type_id = ? AND COALESCE(rate_plan_id, \'\') = ? AND organization_id = ?',
    [seasonId, unitTypeId, ratePlanId ?? '', requireOrganizationId()],
  );
}

/** Прибрати всі перевизначення дат у сезоні: перерендер кожної клітинки поверх `manual`. */
export async function clearSeasonOverrides(seasonId: string): Promise<number> {
  const sql = getSql();
  const season = await ownedSeasonRow(sql, seasonId);
  const cells = await seasonPrices(seasonId);
  for (const cell of cells) await renderCell({ dateFrom: day(season.date_from), dateTo: day(season.date_to) }, cell, false);
  return cells.length;
}

/**
 * Поділити сезон на дату: ліва частина — до дня перед `date`, права — від
 * `date` до старого кінця, клітинки скопійовано в праву. Календар не
 * чіпається — обидві частини кажуть те саме, що казав цілий.
 */
export async function splitSeason(id: string, date: string): Promise<{ left: Season; right: Season }> {
  const sql = getSql();
  const before = await ownedSeasonRow(sql, id);
  const from = day(before.date_from);
  const to = day(before.date_to);
  if (!ISO_DATE.test(date) || date <= from || date > to) throw new Error('season_split_invalid');
  const rightId = `season_${crypto.randomBytes(8).toString('hex')}`;
  const organizationId = requireOrganizationId();
  await sql.tx(async (t) => {
    await t.run('UPDATE seasons SET date_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?', [addDays(date, -1), id, organizationId]);
    await t.run(
      `INSERT INTO seasons (id, organization_id, property_id, name, date_from, date_to, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [rightId, organizationId, String(before.property_id), String(before.name), date, to, Number(before.sort_order) || 0],
    );
    const cells = await t.rows<any>('SELECT * FROM season_prices WHERE season_id = ? AND organization_id = ?', [id, organizationId]);
    for (const c of cells) {
      await t.run(
        `INSERT INTO season_prices (id, organization_id, season_id, unit_type_id, rate_plan_id, price, weekend_price) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [`sp_${crypto.randomBytes(8).toString('hex')}`, organizationId, rightId, c.unit_type_id, c.rate_plan_id ?? null, c.price, c.weekend_price ?? null],
      );
    }
  });
  return { left: await getSeason(id), right: await getSeason(rightId) };
}
