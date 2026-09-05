/* eslint-disable @typescript-eslint/no-explicit-any */
import { noteRatesChanged, type RateField } from '@channels/outbox';
import crypto from 'crypto';
import { getSql, type Sql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import type { DayPrice, PriceUpsertInput } from '../domain/types';

// The id used to be defaulted by a SQLite-only blob function inside the
// INSERT. Same 32 lowercase hex chars, generated where both engines can.
const newId = () => crypto.randomBytes(16).toString('hex');

/**
 * Тариф, який справді належить обʼєкту цього типу — і цьому орендарю.
 *
 * `rate_plan_id` приходить з екрана; без цієї звірки ціну можна було б
 * записати під тариф іншого готелю (INC-010 — клас «id з URL без орендаря»).
 */
async function ownedRatePlanFor(t: Sql, unitTypeId: string, ratePlanId: string): Promise<{ propertyId: string }> {
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('price calendar: write without a tenant');
  const row = await t.row<any>(
    `SELECT rp.property_id
       FROM rate_plans rp
       JOIN unit_types ut ON ut.property_id = rp.property_id
       JOIN properties p ON p.id = rp.property_id
      WHERE rp.id = ? AND ut.id = ? AND p.organization_id = ?`,
    [ratePlanId, unitTypeId, organizationId],
  );
  if (!row) throw new Error('price calendar: rate plan not found');
  return { propertyId: String(row.property_id) };
}

/**
 * Ціна, яку хтось назвав, — додатне число. Нуль і відʼємне — відмова з
 * назвою: нуль тут уже був «ціною» і поїхав у канал (05.09.2026, бета —
 * оператор поставив мін. 2 ночі на день без ціни, редактор записав 0, канал
 * прийняв, звірка сказала «збігається»). Відсутність ціни — NULL у рядку,
 * ніч у `missing`; «не продавати» — це «Закрито», а не нуль.
 */
function assertPositivePrice(value: unknown): void {
  if (value === undefined || value === null) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('price_not_positive');
}

export interface PriceCalendarOptions {
  /** Ціна ТАРИФУ на дату (П2): рядок з `rate_plan_id`, не базовий. */
  ratePlanId?: string;
}

export async function getPriceMonth(unitTypeId: string, month: number, year: number, ratePlanId?: string): Promise<{ unitTypeId: string; ratePlanId: string | null; month: number; year: number; days: DayPrice[] }> {
  const sql = getSql();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Base rows only: this is the month grid the operator edits, and it shows
  // one price per day. A rate plan's row for the same day would overwrite the
  // base one in the map below, and the screen would display — and then save
  // back — a number belonging to a rate plan it never mentions.
  const rows = await sql.rows<any>(`
    SELECT * FROM price_calendar
    WHERE unit_type_id = ? AND date >= ? AND date <= ? AND rate_plan_id IS NULL
    ORDER BY date ASC
  `, [unitTypeId, startDate, endDate]);

  const priceMap = new Map<string, any>();
  for (const row of rows as any[]) priceMap.set(row.date, row);

  // Сітка ТАРИФУ: власний рядок тарифу поверх базового. Де власного немає —
  // показуємо базу і кажемо, що вона успадкована: інакше оператор бачить
  // число і не знає, чиє воно.
  const own = new Map<string, any>();
  if (ratePlanId) {
    const planRows = await sql.rows<any>(`
      SELECT * FROM price_calendar
      WHERE unit_type_id = ? AND date >= ? AND date <= ? AND rate_plan_id = ?
      ORDER BY date ASC
    `, [unitTypeId, startDate, endDate, ratePlanId]);
    for (const row of planRows as any[]) own.set(row.date, row);
  }

  const days: DayPrice[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(year, month - 1, d).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
    const ownRow = own.get(dateStr);
    const existing = ownRow ?? priceMap.get(dateStr);

    if (existing) {
      // Рядок без ціни (лише обмеження) — `effective_price` NULL: екран
      // показує «—», не 0, і редактор дня відкриває порожнє поле.
      const basePrice = existing.base_price == null ? null : Number(existing.base_price);
      const weekendPrice = existing.weekend_price == null ? null : Number(existing.weekend_price);
      days.push({
        date: dateStr, day: d, dayOfWeek, isWeekend,
        base_price: basePrice,
        weekend_price: weekendPrice,
        effective_price: isWeekend && weekendPrice != null ? weekendPrice : basePrice,
        min_stay: existing.min_stay,
        max_stay: existing.max_stay,
        closed: existing.closed,
        cta: existing.cta,
        ctd: existing.ctd,
        hasData: true,
        ...(ratePlanId ? { inherited: !ownRow } : {}),
      });
    } else {
      days.push({ date: dateStr, day: d, dayOfWeek, isWeekend, base_price: null, weekend_price: null, effective_price: null, min_stay: 1, max_stay: null, closed: 0, cta: 0, ctd: 0, hasData: false });
    }
  }

  return { unitTypeId, ratePlanId: ratePlanId ?? null, month, year, days };
}

/**
 * The conflict target, spelled the same way in both upserts below.
 *
 * It has to name the expression the unique index is built on, not the plain
 * columns: `UNIQUE(unit_type_id, date)` was dropped when the calendar gained
 * `rate_plan_id` (a nullable column UNIQUE would not have constrained), and
 * `ON CONFLICT` matches an index, not a wish. Left as `(unit_type_id, date)`
 * this raises "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE
 * constraint" on the first price anybody saves — on both engines.
 *
 * These two screens write base prices, so `rate_plan_id` stays out of the
 * column list and the row lands as NULL: the base price of the unit type,
 * which is what they have always written.
 */
const ON_CONFLICT_ROW = `ON CONFLICT(unit_type_id, (COALESCE(rate_plan_id, '')), date)`;

/** Рядок календаря так, як його порівнює маска: ціни й пʼять обмежень. */
interface CalendarRowShape {
  base_price: number | null;
  weekend_price: number | null;
  min_stay: number;
  max_stay: number | null;
  closed: boolean;
  cta: boolean;
  ctd: boolean;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const flag = (v: unknown): boolean => Boolean(Number(v ?? 0));

/** Рядок бази (або його відсутність) у формі для порівняння. */
function shapeOf(row: any | undefined): CalendarRowShape | null {
  if (!row) return null;
  return {
    base_price: num(row.base_price), weekend_price: num(row.weekend_price),
    min_stay: Number(row.min_stay ?? 1) || 1, max_stay: num(row.max_stay),
    closed: flag(row.closed), cta: flag(row.cta), ctd: flag(row.ctd),
  };
}

/**
 * Які поля ціни ЗМІНИЛИСЬ — маска координати для каналу (Блок 0.5).
 *
 * Порівнюється ефективний стан пари: власний рядок тарифу, а де його немає
 * — успадкований базовий (так само її читає котирування). Екран редактора
 * дня шле всю форму щоразу, тож склад запиту про зміну не каже нічого;
 * каже різниця з тим, що лежало. Ціна — це `base_price` і `weekend_price`
 * разом; «здобула джерело» (NULL → число) додає `closed` — липкий
 * прапорець вендора знімається лише явно (И14, Ц34 (б)); «втратила»
 * (число → NULL) — теж, хоч батчер закрив би й сам: маска має казати правду.
 * Порожня маска — нічого не змінилось, координата не кладеться.
 */
function changedFields(before: CalendarRowShape | null, after: CalendarRowShape): RateField[] {
  const out = new Set<RateField>();
  const priceBefore = before ? [before.base_price, before.weekend_price] : [null, null];
  if (priceBefore[0] !== after.base_price || priceBefore[1] !== after.weekend_price) out.add('prices');
  const hadPrice = priceBefore[0] != null;
  const hasPrice = after.base_price != null;
  if (hadPrice !== hasPrice) out.add('closed');
  if ((before?.closed ?? false) !== after.closed) out.add('closed');
  if ((before?.min_stay ?? 1) !== after.min_stay) out.add('minStay');
  if ((before?.max_stay ?? null) !== after.max_stay) out.add('maxStay');
  if ((before?.cta ?? false) !== after.cta) out.add('noArrival');
  if ((before?.ctd ?? false) !== after.ctd) out.add('noDeparture');
  return [...out];
}

/** Ефективний стан пари ДО запису: власний рядок, інакше успадкований базовий. */
function effectiveBefore(own: CalendarRowShape | null, inherited: CalendarRowShape | null): CalendarRowShape | null {
  if (!own) return inherited;
  if (!inherited) return own;
  return {
    ...own,
    base_price: own.base_price ?? inherited.base_price,
    weekend_price: own.weekend_price ?? inherited.weekend_price,
  };
}

export async function upsertPrices(unitTypeId: string, prices: PriceUpsertInput[], options: PriceCalendarOptions = {}): Promise<number> {
  const sql = getSql();
  const ratePlanId = options.ratePlanId ?? null;
  await sql.tx(async (t) => {
    // Канали дізнаються В ТІЙ САМІЙ транзакції: черга, що поповнюється
    // окремим кроком, розходиться зі станом при першому ж падінні між ними.
    // Одним діапазоном від першої до останньої дати: базова ціна типу
    // міняє КОЖЕН тариф на ньому, і незмінені дні між ними коштують лише
    // повторного читання того самого числа (Ц13). Ціна ТАРИФУ міняє лише
    // його пару — двері фільтрують за `ratePlanId` (Ц10).
    const owner = ratePlanId
      ? { property_id: (await ownedRatePlanFor(t, unitTypeId, ratePlanId)).propertyId }
      : await t.row<any>('SELECT property_id FROM unit_types WHERE id = ?', [unitTypeId]);
    const dates = prices.map((p) => p.date).sort();
    // Відмова ДО дверей і до першого рядка: нуль не має ні записатись, ні
    // покласти координату в чергу.
    for (const p of prices) { assertPositivePrice(p.base_price); assertPositivePrice(p.weekend_price); }

    // Що лежало ДО запису — для маски координати (Блок 0.5): власні рядки й,
    // для тарифу, успадковані базові тих самих дат.
    const holes = dates.map(() => '?').join(', ');
    const ownRows = dates.length ? await t.rows<any>(
      `SELECT * FROM price_calendar WHERE unit_type_id = ? AND ${ratePlanId ? 'rate_plan_id = ?' : 'rate_plan_id IS NULL'} AND date IN (${holes})`,
      ratePlanId ? [unitTypeId, ratePlanId, ...dates] : [unitTypeId, ...dates],
    ) : [];
    const baseRows = ratePlanId && dates.length ? await t.rows<any>(
      `SELECT * FROM price_calendar WHERE unit_type_id = ? AND rate_plan_id IS NULL AND date IN (${holes})`,
      [unitTypeId, ...dates],
    ) : [];
    const ownBy = new Map(ownRows.map((r) => [String(r.date).slice(0, 10), r]));
    const baseBy = new Map(baseRows.map((r) => [String(r.date).slice(0, 10), r]));
    const changed = new Set<RateField>();
    for (const p of prices) {
      const own = shapeOf(ownBy.get(p.date));
      const before = effectiveBefore(own, shapeOf(baseBy.get(p.date)));
      const after: CalendarRowShape = {
        base_price: (p.base_price === undefined ? own?.base_price ?? null : p.base_price) ?? (ratePlanId ? shapeOf(baseBy.get(p.date))?.base_price ?? null : null),
        weekend_price: (p.weekend_price === undefined ? own?.weekend_price ?? null : p.weekend_price) ?? (ratePlanId ? shapeOf(baseBy.get(p.date))?.weekend_price ?? null : null),
        min_stay: p.min_stay ?? 1, max_stay: p.max_stay ?? null,
        closed: Boolean(p.closed), cta: Boolean(p.cta), ctd: Boolean(p.ctd),
      };
      for (const f of changedFields(before, after)) changed.add(f);
    }
    // Координата — лише коли щось справді змінилось, і лише з тим, що
    // змінилось: зайва координата коштує виклик із ліміту, зайве поле —
    // сертифікацію (лист Channex 05.09, Б1).
    if (owner && dates.length && changed.size) {
      await noteRatesChanged(t, {
        propertyId: String(owner.property_id), unitTypeId, ratePlanId: ratePlanId ?? undefined,
        from: dates[0], to: dates[dates.length - 1], fields: [...changed],
      });
    }
    for (const p of prices) {
      // `base_price` без значення — ціну НЕ чіпати: збереження обмеження на
      // день із ціною лишає її, на день без ціни — лишає порожньою (NULL).
      // Тут стояло `?? 0`, і рядок обмеження ставав ціною нуль.
      //
      // Ціна вихідних — теж ціна, і з тим самим правилом: поля немає — не
      // чіпати; явний `null` — прибрати. Через COALESCE це не сказати (null
      // і «немає поля» там однакові), тому вибір робиться тут, а не в SQL.
      // До 05.09.2026 стояло `excluded.weekend_price` без умови, і
      // збереження обмеження без поля ціни затирало ціну вихідних NULL:
      // з пʼятниці по неділю продавалась буденна — без жодної помилки.
      const weekendSet = p.weekend_price === undefined ? 'price_calendar.weekend_price' : 'excluded.weekend_price';
      await t.run(`
      INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price, weekend_price, min_stay, max_stay, closed, cta, ctd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${ON_CONFLICT_ROW} DO UPDATE SET
        base_price = COALESCE(excluded.base_price, price_calendar.base_price),
        weekend_price = ${weekendSet},
        min_stay = excluded.min_stay,
        max_stay = excluded.max_stay,
        closed = excluded.closed,
        cta = excluded.cta,
        ctd = excluded.ctd,
        updated_at = CURRENT_TIMESTAMP
      `, [newId(), unitTypeId, ratePlanId, p.date, p.base_price ?? null, p.weekend_price ?? null, p.min_stay ?? 1, p.max_stay ?? null, p.closed ? 1 : 0, p.cta ? 1 : 0, p.ctd ? 1 : 0]);
    }
  });

  return prices.length;
}

export async function getBulkPrices(organizationId: string, startDate: string, endDate: string) {
  const sql = getSql();
  return await sql.rows<any>(`
    SELECT pc.unit_type_id, pc.date, pc.base_price, pc.weekend_price,
      CASE
        WHEN (${sql.dialect.dayOfWeek('pc.date')} IN (0, 5, 6)) AND pc.weekend_price IS NOT NULL
        THEN pc.weekend_price
        ELSE pc.base_price
      END as effective_price
    FROM price_calendar pc
    JOIN unit_types ut ON pc.unit_type_id = ut.id
    JOIN properties p ON ut.property_id = p.id
    WHERE p.organization_id = ? AND pc.date >= ? AND pc.date <= ?
    ORDER BY pc.unit_type_id, pc.date
  `, [organizationId, startDate, endDate]);
}

export interface BulkUpdateInput {
  unitTypeId: string;
  dateFrom: string;
  dateTo: string;
  applyTo?: 'all' | 'weekdays' | 'weekends';
  base_price?: number;
  weekend_price?: number | null;
  min_stay?: number;
  max_stay?: number | null;
  closed?: boolean;
  cta?: boolean;
  ctd?: boolean;
  /** Ціна ТАРИФУ на діапазон (П2); без нього — базова ціна типу. */
  ratePlanId?: string;
}

export async function bulkUpdatePrices(input: BulkUpdateInput): Promise<number> {
  const sql = getSql();
  const { unitTypeId, dateFrom, dateTo, applyTo = 'all' } = input;
  const ratePlanId = input.ratePlanId ?? null;

  let count = 0;
  const start = new Date(dateFrom);
  const end = new Date(dateTo);

  assertPositivePrice(input.base_price);
  assertPositivePrice(input.weekend_price);

  await sql.tx(async (t) => {
    // Канали — в тій самій транзакції, одним діапазоном (див. upsertPrices);
    // маска — з різниці по всіх днях діапазону, тому координата кладеться
    // ПІСЛЯ циклу, коли відомо, що змінилось.
    const owner = ratePlanId
      ? { property_id: (await ownedRatePlanFor(t, unitTypeId, ratePlanId)).propertyId }
      : await t.row<any>('SELECT property_id FROM unit_types WHERE id = ?', [unitTypeId]);
    const changed = new Set<RateField>();

    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const dayOfWeek = current.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

      if (applyTo === 'weekdays' && isWeekend) { current.setDate(current.getDate() + 1); continue; }
      if (applyTo === 'weekends' && !isWeekend) { current.setDate(current.getDate() + 1); continue; }

      // `rate_plan_id IS NULL` — the base row, which is the one this screen
      // edits. Without it the day's rate-plan row could answer instead, and
      // "keep the current price" would carry a rate plan's number into the
      // base price.
      const existing = ratePlanId
        ? await t.row<any>('SELECT * FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id = ?', [unitTypeId, dateStr, ratePlanId])
        : await t.row<any>('SELECT * FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id IS NULL', [unitTypeId, dateStr]);

      // A day the hotel has never priced stays unpriced. The form's price field
      // says «Не змінювати» when left empty, so `base_price` is undefined
      // whenever the operator bulk-edits only min stay or the open/closed flag —
      // and `?? 0` once turned that into a real row worth zero: the quote
      // answered `missingDays: 0, total: 0`, and a confirmed booking was taken
      // for nothing. AGENTS.md §3 invariant 17: a night no source can price is
      // missing, not free. Since 0062 the row is written with `base_price`
      // NULL — the restriction is kept, the night stays unsellable.
      const basePrice = input.base_price ?? existing?.base_price ?? null;
      const weekendPrice = input.weekend_price !== undefined ? input.weekend_price : (existing?.weekend_price ?? null);
      const minStay = input.min_stay ?? existing?.min_stay ?? 1;
      const maxStay = input.max_stay !== undefined ? input.max_stay : (existing?.max_stay ?? null);
      const closed = input.closed !== undefined ? (input.closed ? 1 : 0) : (existing?.closed ?? 0);
      const cta = input.cta !== undefined ? (input.cta ? 1 : 0) : (existing?.cta ?? 0);
      const ctd = input.ctd !== undefined ? (input.ctd ? 1 : 0) : (existing?.ctd ?? 0);

      // Маска координати (Блок 0.5): різниця ефективного стану пари до і після.
      const inherited = ratePlanId
        ? shapeOf(await t.row<any>('SELECT * FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id IS NULL', [unitTypeId, dateStr]))
        : null;
      const after: CalendarRowShape = {
        base_price: num(basePrice) ?? inherited?.base_price ?? null,
        weekend_price: num(weekendPrice) ?? inherited?.weekend_price ?? null,
        min_stay: Number(minStay) || 1, max_stay: num(maxStay), closed: Boolean(closed), cta: Boolean(cta), ctd: Boolean(ctd),
      };
      for (const f of changedFields(effectiveBefore(shapeOf(existing), inherited), after)) changed.add(f);

      await t.run(`
      INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price, weekend_price, min_stay, max_stay, closed, cta, ctd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${ON_CONFLICT_ROW} DO UPDATE SET
        base_price = excluded.base_price,
        weekend_price = excluded.weekend_price,
        min_stay = excluded.min_stay,
        max_stay = excluded.max_stay,
        closed = excluded.closed,
        cta = excluded.cta,
        ctd = excluded.ctd,
        updated_at = CURRENT_TIMESTAMP
      `, [newId(), unitTypeId, ratePlanId, dateStr, basePrice, weekendPrice, minStay, maxStay, closed, cta, ctd]);
      count++;
      current.setDate(current.getDate() + 1);
    }

    if (owner && changed.size) {
      await noteRatesChanged(t, {
        propertyId: String(owner.property_id), unitTypeId, ratePlanId: ratePlanId ?? undefined,
        from: dateFrom, to: dateTo, fields: [...changed],
      });
    }
  });

  return count;
}

/** Обмеження одного дня з базового рядка типу — для батчера каналів (Д1/Д2). */
export interface DayRestrictions {
  minStay: number;
  maxStay: number | null;
  noArrival: boolean;
  noDeparture: boolean;
  closed: boolean;
}

/**
 * Обмеження по днях для кількох типів — базові рядки, ключ `unitTypeId|date`.
 *
 * День без рядка не повертається: батчер читає його як «без обмежень», і це
 * правильно — обмеження, якого готель не називав, не існує. Ціна при цьому
 * читається окремо, котируванням (інваріант 16).
 */
export async function dayRestrictions(unitTypeIds: string[], from: string, to: string): Promise<Map<string, DayRestrictions>> {
  const out = new Map<string, DayRestrictions>();
  if (unitTypeIds.length === 0) return out;
  const rows = await getSql().rows<any>(
    `SELECT unit_type_id, date, min_stay, max_stay, closed, cta, ctd
       FROM price_calendar
      WHERE unit_type_id IN (${unitTypeIds.map(() => '?').join(', ')}) AND rate_plan_id IS NULL AND date >= ? AND date <= ?`,
    [...unitTypeIds, from, to],
  );
  for (const r of rows) {
    out.set(`${r.unit_type_id}|${String(r.date).slice(0, 10)}`, {
      minStay: Math.max(1, Number(r.min_stay ?? 1) || 1),
      maxStay: r.max_stay == null ? null : Number(r.max_stay),
      noArrival: Number(r.cta ?? 0) === 1,
      noDeparture: Number(r.ctd ?? 0) === 1,
      closed: Number(r.closed ?? 0) === 1,
    });
  }
  return out;
}

/**
 * Скільки днів із названою ціною має найкраще покритий тип у вікні
 * [`from`, `from` + `days`) — для Setup progress (MASTER-PLAN §1.4): тимчасове
 * правило «365 днів без дір» замість сезонів, доки сезонів немає (Блок 2).
 *
 * Рахується тут, а не в модулі обʼєктів, бо `price_calendar` читає лише
 * `modules/pricing` (інваріант 16, `check-price-source`): це не ціна, це
 * покриття — але таблиця та сама, і друге місце читання її не заводиться.
 * Рядок без ціни (лише обмеження, 0062) покриттям не є.
 */
export async function pricedDaysAhead(unitTypeIds: string[], from: string, days: number): Promise<number> {
  if (unitTypeIds.length === 0 || days <= 0) return 0;
  const to = new Date(`${from}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + days - 1);
  const toIso = to.toISOString().slice(0, 10);
  const rows = await getSql().rows<any>(
    `SELECT unit_type_id, COUNT(DISTINCT date) AS n
       FROM price_calendar
      WHERE unit_type_id IN (${unitTypeIds.map(() => '?').join(', ')})
        AND base_price IS NOT NULL AND base_price > 0
        AND date >= ? AND date <= ?
      GROUP BY unit_type_id`,
    [...unitTypeIds, from, toIso],
  );
  return rows.reduce((best, r) => Math.max(best, Number(r.n) || 0), 0);
}
