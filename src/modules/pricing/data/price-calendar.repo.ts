/* eslint-disable @typescript-eslint/no-explicit-any */
import { noteRatesChanged, type RateField } from '@channels/outbox';
import { dayRowPrice, type PriceColumn } from '../domain/day-price';
import crypto from 'crypto';
import { getSql, type Sql } from '@core/db/async';
import { currentOrganizationId } from '@core/auth/tenant-context';
import type { DayPrice, PriceUpsertInput, PriceSource, RateAdjustment } from '../domain/types';
import { derivedPrice } from '../domain/derived-price';

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

/**
 * Мінімум ночей — ціле від одиниці. Той самий клас, що нуль у ціні:
 * очищене поле форми дає `Number('') === 0`, і нуль поїхав би в канал
 * як `min_stay_arrival: 0` — число, якого готель не називав (рецензія
 * 07.09 раунд 3, правка 1.1). `null` сюди не потрапляє: для пари це «як у
 * типу», і його пропускає перевірка на `undefined`/`null` вище за текстом.
 * «Не продавати» — це «Закрито», а не нуль ночей.
 */
function assertMinStay(value: unknown): void {
  if (value === undefined || value === null) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) throw new Error('min_stay_invalid');
}

export interface PriceCalendarOptions {
  /** Ціна ТАРИФУ на дату (П2): рядок з `rate_plan_id`, не базовий. */
  ratePlanId?: string;
  /**
   * Не чіпати дат, де рядок тарифу — перевизначення (`manual` з ціною):
   * так рендерить похідний тариф (Ц28) — правило не затирає того, що
   * оператор поставив на дату рукою. Лише з `ratePlanId`.
   */
  keepManual?: boolean;
  /**
   * Куди лягають ОБМЕЖЕННЯ, коли названо тариф (Ц32 переглянуто 07.09):
   * `pair` (дефолт) — у рядок цієї пари, координата лише на неї; `type` —
   * у базовий рядок типу («на всі тарифи типу»), координата на всі пари,
   * власні значення інших пар не затираються. Без тарифу — завжди тип.
   */
  restrictionsScope?: 'pair' | 'type';
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

  // Сітка ТАРИФУ: ЦІНА з власного рядка тарифу поверх базового. Де власної
  // немає — показуємо базову і кажемо, що вона успадкована: інакше оператор
  // бачить число і не знає, чиє воно. ОБМЕЖЕННЯ — ЕФЕКТИВНІ пари (Ц32
  // переглянуто 07.09): власне значення пари, де є (`restrictionsOwn`), інакше
  // базового рядка типу — саме так їх читають батчер і котирування.
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
    const baseRow = priceMap.get(dateStr);
    const ownRow = own.get(dateStr);
    // Власна ціна тарифу — рядок тарифу З ціною; порожній рядок тарифу
    // (лишився від старого писача або від «прибрати ціну вихідних») ціни не
    // має і не заступає базову.
    const ownPriced = ownRow && ownRow.base_price != null;
    const priceRow = ownPriced ? ownRow : baseRow;
    const existing = priceRow ?? baseRow;

    if (existing) {
      // Рядок без ціни (лише обмеження) — `effective_price` NULL: екран
      // показує «—», не 0, і редактор дня відкриває порожнє поле.
      const basePrice = priceRow?.base_price == null ? null : Number(priceRow.base_price);
      const weekendPrice = priceRow?.weekend_price == null ? null : Number(priceRow.weekend_price);
      const r = effectiveRestrictions(ratePlanId ? shapeOf(ownRow) : null, shapeOf(baseRow));
      // Ціна дня — ОДНІЄЮ функцією з `@pricing/domain/day-price`, тією самою,
      // якою її рахує `priceNights` для гостя. Доти тут стояла своя копія
      // правила вихідних, і вона вже розходилась: варти на нуль і відʼємне не
      // було, тож `weekend_price = 0` показувався б суботі як ціна (Блок 6).
      const effective = dayRowPrice(priceRow, dateStr);
      days.push({
        date: dateStr, day: d, dayOfWeek, isWeekend,
        base_price: basePrice,
        weekend_price: weekendPrice,
        effective_price: effective.price,
        // Колонка, з якої взяте число: екран показує її підписом, а не
        // виводить із `isWeekend` заново.
        price_column: effective.column,
        min_stay: r.min_stay,
        max_stay: r.max_stay,
        closed: r.closed ? 1 : 0,
        cta: r.cta ? 1 : 0,
        ctd: r.ctd ? 1 : 0,
        hasData: true,
        source: ((priceRow ?? existing).source ?? 'manual') as PriceSource,
        ...(ratePlanId ? { inherited: !ownPriced, restrictionsOwn: hasOwnRestrictions(ownRow) } : {}),
      });
    } else {
      days.push({ date: dateStr, day: d, dayOfWeek, isWeekend, base_price: null, weekend_price: null, effective_price: null, price_column: 'base', min_stay: 1, max_stay: null, closed: 0, cta: 0, ctd: 0, hasData: false });
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

/**
 * Рядок календаря так, як його порівнює маска: ціни й пʼять обмежень.
 * Обмеження nullable (0072, Ц32 переглянуто): на рядку ПАРИ NULL — «як у
 * типу»; на базовому рядку NULL не мало би бути, читається як дефолт.
 */
interface CalendarRowShape {
  base_price: number | null;
  weekend_price: number | null;
  min_stay: number | null;
  max_stay: number | null;
  closed: boolean | null;
  cta: boolean | null;
  ctd: boolean | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const flagOrNull = (v: unknown): boolean | null => (v == null ? null : Boolean(Number(v)));

/** Рядок (або його відсутність) у формі для порівняння. */
function shapeOf(row: any | undefined): CalendarRowShape | null {
  if (!row) return null;
  return {
    base_price: num(row.base_price), weekend_price: num(row.weekend_price),
    min_stay: num(row.min_stay), max_stay: num(row.max_stay),
    closed: flagOrNull(row.closed), cta: flagOrNull(row.cta), ctd: flagOrNull(row.ctd),
  };
}

/** Ціна пари: `base_price` і `weekend_price` разом. */
type PriceShape = Pick<CalendarRowShape, 'base_price' | 'weekend_price'>;
/** ЕФЕКТИВНЕ обмеження: мінімум, максимум, «закрито», заборона заїзду й виїзду — без NULL. */
interface RestrictionShape { min_stay: number; max_stay: number | null; closed: boolean; cta: boolean; ctd: boolean }

/**
 * Ефективне обмеження пари (Ц32 переглянуто 07.09): власне значення пари, де
 * задане, інакше базовий рядок типу, інакше дефолт. «Закрито» — тип АБО пара:
 * тип закритий → усі його пари закриті (И14, липкість), пара закрита при
 * відкритому типі — лише вона. Без пари (`pair = null`) — обмеження типу.
 */
function effectiveRestrictions(pair: CalendarRowShape | null, base: CalendarRowShape | null): RestrictionShape {
  return {
    min_stay: Math.max(1, Number(pair?.min_stay ?? base?.min_stay ?? 1) || 1),
    max_stay: pair?.max_stay ?? base?.max_stay ?? null,
    closed: (base?.closed ?? false) || (pair?.closed ?? false),
    cta: pair?.cta ?? base?.cta ?? false,
    ctd: pair?.ctd ?? base?.ctd ?? false,
  };
}

/** Чи має рядок пари хоч одне ВЛАСНЕ обмеження. */
function hasOwnRestrictions(row: any | undefined): boolean {
  return Boolean(row) && RESTRICTION_COLS.some((c) => row[c] != null);
}

/**
 * Які поля ЦІНИ змінились — маска координати ПАРИ (Блок 0.5).
 *
 * Порівнюється ефективна ціна пари: власний рядок тарифу, а де його немає
 * — успадкований базовий (так само її читає котирування). Екран редактора
 * дня шле всю форму щоразу, тож склад запиту про зміну не каже нічого;
 * каже різниця з тим, що лежало. «Здобула джерело» (NULL → число) додає
 * `closed` — липкий прапорець вендора знімається лише явно (И14, Ц34 (б));
 * «втратила» (число → NULL) — теж, хоч батчер закрив би й сам: маска має
 * казати правду. Порожня маска — нічого не змінилось, координата не кладеться.
 */
function changedPriceFields(before: PriceShape | null, after: PriceShape): RateField[] {
  const out = new Set<RateField>();
  const priceBefore = before ? [before.base_price, before.weekend_price] : [null, null];
  if (priceBefore[0] !== after.base_price || priceBefore[1] !== after.weekend_price) out.add('prices');
  const hadPrice = priceBefore[0] != null;
  const hasPrice = after.base_price != null;
  if (hadPrice !== hasPrice) out.add('closed');
  return [...out];
}

/**
 * Які ОБМЕЖЕННЯ змінились — маска координати.
 *
 * Порівнюються ЕФЕКТИВНІ обмеження до і після: для запису в рядок пари — цієї
 * пари (координата лише на неї), для запису в базовий рядок типу — типу
 * (координата на кожну його пару; пара зі своїм значенням тримає його, і її
 * ефективне не міняється — це видно батчеру при читанні, не в масці).
 */
function changedRestrictionFields(before: RestrictionShape | null, after: RestrictionShape): RateField[] {
  const out = new Set<RateField>();
  if ((before?.closed ?? false) !== after.closed) out.add('closed');
  if ((before?.min_stay ?? 1) !== after.min_stay) out.add('minStay');
  if ((before?.max_stay ?? null) !== after.max_stay) out.add('maxStay');
  if ((before?.cta ?? false) !== after.cta) out.add('noArrival');
  if ((before?.ctd ?? false) !== after.ctd) out.add('noDeparture');
  return [...out];
}

/**
 * Ефективна ціна пари: власний рядок ЦІЛКОМ, якщо він має ціну, інакше
 * базовий рядок типу цілком — так само її читає `dayPrice` у котируванні
 * (рецензія 07.09 п.1). По полю не можна: власний рядок бази 120 без ціни
 * вихідних продає пʼятницю за 120, а не за вихідну типу.
 */
function effectivePrice(own: PriceShape | null, inherited: PriceShape | null): PriceShape | null {
  if (own && own.base_price != null) return own;
  return inherited;
}
const effectivePriceBefore = effectivePrice;

/**
 * Двері каналів для обох писачів календаря — В ТІЙ САМІЙ транзакції, одним
 * діапазоном від першої до останньої дати (незмінені дні між ними коштують
 * лише повторного читання того самого числа, Ц13). Дві координати різного
 * охоплення, і це не деталь:
 *
 *   ціна        → пара вибраного тарифу (Ц10); без тарифу — базова ціна
 *                 типу, її успадковує кожен тариф, тож усі пари типу;
 *   обмеження   → пара, коли записані в рядок ПАРИ (Ц32 переглянуто 07.09);
 *                 усі пари типу, коли записані в базовий рядок («на всі
 *                 тарифи типу») — батчер читає ефективне обмеження кожної
 *                 пари, тож пара зі своїм значенням отримає його ж.
 *
 * Координата — лише коли щось справді змінилось, і лише з тим, що
 * змінилось: зайва координата коштує виклик із ліміту, зайве поле —
 * сертифікацію (лист Channex 05.09, Б1).
 */
async function noteCalendarChanged(
  t: Sql,
  span: { propertyId: string; unitTypeId: string; ratePlanId: string | null; from: string; to: string },
  priceFields: Set<RateField>,
  restrictionFields: Set<RateField>,
  restrictionsOnPair = false,
): Promise<void> {
  const { propertyId, unitTypeId, from, to } = span;
  if (priceFields.size) {
    await noteRatesChanged(t, { propertyId, unitTypeId, ratePlanId: span.ratePlanId ?? undefined, from, to, fields: [...priceFields] });
  }
  if (restrictionFields.size) {
    await noteRatesChanged(t, { propertyId, unitTypeId, ratePlanId: restrictionsOnPair ? (span.ratePlanId ?? undefined) : undefined, from, to, fields: [...restrictionFields] });
  }
}

/** Обмеження базового рядка типу як ефективні (без пари). */
const restrictionsOf = (row: CalendarRowShape | null): RestrictionShape | null => row && effectiveRestrictions(null, row);

/** Поля обмежень, які запит НАЗВАВ (включно з явним `null`). */
const restrictionFieldsPresent = (input: object): boolean =>
  RESTRICTION_COLS.some((c) => (input as Record<string, unknown>)[c] !== undefined);

/** Рядок пари ПІСЛЯ запису обмежень: поля немає — як лежало; `null` — успадкувати від типу; значення — воно. */
function pairAfter(own: CalendarRowShape | null, p: PriceUpsertInput): CalendarRowShape {
  const pick = <T>(input: T | null | undefined, existing: T | null | undefined): T | null => (input === undefined ? (existing ?? null) : (input ?? null));
  return {
    base_price: own?.base_price ?? null, weekend_price: own?.weekend_price ?? null,
    min_stay: pick(p.min_stay, own?.min_stay), max_stay: pick(p.max_stay, own?.max_stay),
    closed: pick(p.closed, own?.closed), cta: pick(p.cta, own?.cta), ctd: pick(p.ctd, own?.ctd),
  };
}

/**
 * Рядок ПАРИ: ціна тарифу і — з 07.09 (Ц32 переглянуто) — власні обмеження
 * пари, кожне nullable: NULL — «як у типу». Пишеться лише коли є що нести:
 * назвали ціну чи обмеження, або рядок уже є (тоді «прибрати ціну вихідних»
 * теж має куди лягти). Порожній рядок тарифу — це сітка, яка каже «власна
 * ціна», показуючи успадковану.
 *
 * Одна семантика на кожне поле (Блок 0.6 B4): поля немає в запиті — не
 * чіпати; явний `null` — прибрати (для обмеження пари — успадкувати від
 * типу); значення — записати. Через COALESCE цього не сказати (null і «немає
 * поля» там однакові), тому вибір робиться тут, а не в SQL — `keepOrSet`. До
 * 05.09.2026 у `base_price` стояв COALESCE, і явний `null` ціну не прибирав,
 * хоч маска координати вже казала «ціна зникла»; у `weekend_price` без умови
 * стояло `excluded.weekend_price`, і збереження обмеження без поля ціни
 * затирало ціну вихідних NULL: з пʼятниці по неділю продавалась буденна.
 */
async function writeRatePlanRow(
  t: Sql, unitTypeId: string, ratePlanId: string, date: string,
  input: { base_price?: number | null; weekend_price?: number | null; source?: PriceSource; min_stay?: number | null; max_stay?: number | null; closed?: boolean | null; cta?: boolean | null; ctd?: boolean | null },
  rowExists: boolean,
): Promise<void> {
  const namesRestriction = restrictionFieldsPresent(input);
  if (!rowExists && input.base_price == null && input.weekend_price == null && !namesRestriction) return;
  // Джерело (Ц27) міняється лише разом із ціною.
  const pricedNow = input.base_price !== undefined || input.weekend_price !== undefined;
  const bit = (v: boolean | null | undefined): number | null => (v == null ? null : (v ? 1 : 0));
  await t.run(`
    INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price, weekend_price, min_stay, max_stay, closed, cta, ctd, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ${ON_CONFLICT_ROW} DO UPDATE SET
      ${keepOrSet(input, ['base_price', 'weekend_price', ...RESTRICTION_COLS])},
      source = ${pricedNow ? 'excluded.source' : 'price_calendar.source'},
      updated_at = CURRENT_TIMESTAMP
  `, [newId(), unitTypeId, ratePlanId, date, input.base_price ?? null, input.weekend_price ?? null,
    input.min_stay ?? null, input.max_stay ?? null, bit(input.closed), bit(input.cta), bit(input.ctd), input.source ?? 'manual']);
}

/**
 * `SET` для upsert-у, поле за полем: поля немає в запиті — лишити те, що в
 * рядку; є (включно з `null`) — записати з `excluded`. Значення для INSERT
 * при цьому — вже злиті (`resolveField`), тож новий рядок теж отримує їх.
 */
function keepOrSet(input: object, cols: readonly string[]): string {
  const has = (c: string) => (input as Record<string, unknown>)[c] !== undefined;
  return cols.map((c) => `${c} = ${has(c) ? `excluded.${c}` : `price_calendar.${c}`}`).join(',\n      ');
}

/** Значення поля після запису: немає — те, що лежало (або дефолт); `null` — дефолт; інакше — воно. */
function resolveField<T>(input: T | null | undefined, existing: T | null | undefined, fallback: T): T {
  if (input === undefined) return existing ?? fallback;
  return input ?? fallback;
}

/** Обмеження після запису — злиті з базовим рядком за правилом `resolveField`. */
function resolveRestrictions(p: PriceUpsertInput, base: CalendarRowShape | null): RestrictionShape {
  return {
    min_stay: Number(resolveField(p.min_stay, base?.min_stay, 1)) || 1,
    max_stay: resolveField(p.max_stay, base?.max_stay, null),
    closed: Boolean(resolveField(p.closed, base?.closed, false)),
    cta: Boolean(resolveField(p.cta, base?.cta, false)),
    ctd: Boolean(resolveField(p.ctd, base?.ctd, false)),
  };
}

/**
 * Обмеження — у БАЗОВИЙ рядок типу («на всі тарифи типу»), ціни його не
 * чіпаючи: на день без базового рядка заводиться рядок без ціни (NULL, ніч у
 * `missing`, обмеження діє — 0062). Пара зі своїм значенням його тримає.
 */
/** `present` — обʼєкт, чиї визначені поля пишуться; злиті значення (`r`) — для нового рядка. */
async function writeBaseRestrictions(t: Sql, unitTypeId: string, date: string, r: RestrictionShape, present: object): Promise<void> {
  await t.run(`
    INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price, weekend_price, min_stay, max_stay, closed, cta, ctd)
    VALUES (?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?)
    ${ON_CONFLICT_ROW} DO UPDATE SET
      ${keepOrSet(present, RESTRICTION_COLS)},
      updated_at = CURRENT_TIMESTAMP
  `, [newId(), unitTypeId, date, r.min_stay, r.max_stay, r.closed ? 1 : 0, r.cta ? 1 : 0, r.ctd ? 1 : 0]);
}

const RESTRICTION_COLS = ['min_stay', 'max_stay', 'closed', 'cta', 'ctd'] as const;

export async function upsertPrices(unitTypeId: string, prices: PriceUpsertInput[], options: PriceCalendarOptions = {}): Promise<number> {
  const sql = getSql();
  const ratePlanId = options.ratePlanId ?? null;
  await sql.tx(async (t) => {
    // Канали дізнаються В ТІЙ САМІЙ транзакції: черга, що поповнюється
    // окремим кроком, розходиться зі станом при першому ж падінні між ними.
    // Охоплення координат — у `noteCalendarChanged`.
    const owner = ratePlanId
      ? { property_id: (await ownedRatePlanFor(t, unitTypeId, ratePlanId)).propertyId }
      : await t.row<any>('SELECT property_id FROM unit_types WHERE id = ?', [unitTypeId]);
    const dates = prices.map((p) => p.date).sort();
    // Відмова ДО дверей і до першого рядка: нуль не має ні записатись, ні
    // покласти координату в чергу.
    for (const p of prices) { assertPositivePrice(p.base_price); assertPositivePrice(p.weekend_price); assertMinStay(p.min_stay); }

    // Що лежало ДО запису — для масок (Блок 0.5): базові рядки завжди (там
    // обмеження, і для тарифу — успадкована ціна) і, для тарифу, його власні.
    const holes = dates.map(() => '?').join(', ');
    const baseRows = dates.length ? await t.rows<any>(
      `SELECT * FROM price_calendar WHERE unit_type_id = ? AND rate_plan_id IS NULL AND date IN (${holes})`,
      [unitTypeId, ...dates],
    ) : [];
    const planRows = ratePlanId && dates.length ? await t.rows<any>(
      `SELECT * FROM price_calendar WHERE unit_type_id = ? AND rate_plan_id = ? AND date IN (${holes})`,
      [unitTypeId, ratePlanId, ...dates],
    ) : [];
    const baseBy = new Map(baseRows.map((r) => [String(r.date).slice(0, 10), r]));
    const planBy = new Map(planRows.map((r) => [String(r.date).slice(0, 10), r]));
    // Перевизначення дати рендер правила обходить (Ц27/Ц28): рядок тарифу з
    // ціною, поставленою рукою, лишається; рядок без ціни — не перевизначення.
    const writes = options.keepManual && ratePlanId
      ? prices.filter((p) => { const own = planBy.get(p.date); return !(own && (own.source ?? 'manual') === 'manual' && own.base_price != null); })
      : prices;
    const wdates = writes.map((p) => p.date).sort();
    const priceChanged = new Set<RateField>();
    const restrictionChanged = new Set<RateField>();
    // Обмеження з названим тарифом — у рядок пари (Ц32 переглянуто), якщо
    // екран не сказав «на всі тарифи типу».
    const restrictionsOnPair = Boolean(ratePlanId) && options.restrictionsScope !== 'type';

    for (const p of writes) {
      const base = shapeOf(baseBy.get(p.date));
      const own = ratePlanId ? shapeOf(planBy.get(p.date)) : base;
      // Ціна: яку пара матиме після запису — власний рядок цілком, коли має
      // ціну (названу або ту, що лежала), інакше успадкований базовий цілком.
      const inherited = ratePlanId ? base : null;
      const ownAfter: PriceShape = {
        base_price: resolveField(p.base_price, own?.base_price, null),
        weekend_price: resolveField(p.weekend_price, own?.weekend_price, null),
      };
      const after: PriceShape = effectivePrice(ownAfter, inherited) ?? { base_price: null, weekend_price: null };
      for (const f of changedPriceFields(effectivePriceBefore(own, inherited), after)) priceChanged.add(f);
      // Обмеження: ефективне до і після — пари, коли пишемо в пару; типу, коли
      // в базовий рядок. Поля, яких у запиті немає, лишаються як були (B4).
      if (restrictionsOnPair) {
        const pairBefore = shapeOf(planBy.get(p.date));
        for (const f of changedRestrictionFields(effectiveRestrictions(pairBefore, base), effectiveRestrictions(pairAfter(pairBefore, p), base))) restrictionChanged.add(f);
      } else {
        for (const f of changedRestrictionFields(restrictionsOf(base), resolveRestrictions(p, base))) restrictionChanged.add(f);
      }
    }
    if (owner && wdates.length) {
      await noteCalendarChanged(t, {
        propertyId: String(owner.property_id), unitTypeId, ratePlanId, from: wdates[0], to: wdates[wdates.length - 1],
      }, priceChanged, restrictionChanged, restrictionsOnPair);
    }

    for (const p of writes) {
      const base = shapeOf(baseBy.get(p.date));
      const r = resolveRestrictions(p, base);
      // Джерело (Ц27) міняється лише разом із ціною: збереження обмеження на
      // рядку сезону не робить його перевизначенням.
      const pricedNow = p.base_price !== undefined || p.weekend_price !== undefined;
      if (ratePlanId) {
        if (restrictionsOnPair) {
          // Ціна й власні обмеження пари — в її рядок.
          await writeRatePlanRow(t, unitTypeId, ratePlanId, p.date, p, planBy.has(p.date));
          continue;
        }
        // «На всі тарифи типу»: ціна — в рядок пари, обмеження — в базовий рядок
        // типу, і лише коли їх назвали: запис самої ціни тарифу (рендер
        // похідного) не має заводити рядків обмежень на 500 ночей уперед.
        const priceOnly = { base_price: p.base_price, weekend_price: p.weekend_price, source: p.source };
        await writeRatePlanRow(t, unitTypeId, ratePlanId, p.date, priceOnly, planBy.has(p.date));
        if (restrictionFieldsPresent(p)) {
          await writeBaseRestrictions(t, unitTypeId, p.date, r, p);
        }
        continue;
      }
      // Базовий рядок типу: ціна й обмеження разом, одна семантика на кожне
      // поле (`keepOrSet`, B4): поля немає — не чіпати (збереження обмеження
      // на день із ціною лишає її, на день без ціни — лишає порожньою; тут
      // стояло `?? 0`, і рядок обмеження ставав ціною нуль), `null` — прибрати.
      await t.run(`
      INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price, weekend_price, min_stay, max_stay, closed, cta, ctd, source)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${ON_CONFLICT_ROW} DO UPDATE SET
        ${keepOrSet(p, ['base_price', 'weekend_price', ...RESTRICTION_COLS])},
        source = ${pricedNow ? 'excluded.source' : 'price_calendar.source'},
        updated_at = CURRENT_TIMESTAMP
      `, [newId(), unitTypeId, p.date, p.base_price ?? null, p.weekend_price ?? null, r.min_stay, r.max_stay, r.closed ? 1 : 0, r.cta ? 1 : 0, r.ctd ? 1 : 0, p.source ?? 'manual']);
    }
  });

  // Похідні тарифи, що спираються на змінену ціну, — перерендер тими самими
  // датами (Ц28). Рядки самого похідного залежних не мають — далі не йде.
  if (prices.some((p) => p.source !== 'derived')) {
    await rerenderDependents(unitTypeId, ratePlanId, prices.map((p) => p.date));
  }
  return prices.length;
}

/**
 * Ціни діапазону для шахматки. `effective_price` рахує КОД, не запит.
 *
 * Тут стояв власний `CASE WHEN dayOfWeek IN (0,5,6) AND weekend_price IS NOT
 * NULL` — четверта копія правила вихідних, і в ній не було варти на нуль та
 * відʼємне, яку `nightly-price` має з 0062. Тобто `weekend_price = 0`
 * показувався б суботі як ціна саме тим шляхом, який 0062 закрила для
 * буднів. Блок 6 оголосив копії прибраними і цю не побачив: гейт шукав
 * ТЕРНАРНИК у JS, а SQL-гілка на цей візерунок не схожа (рецензія раунду 9,
 * Р9.3).
 *
 * Правило одне — `dayRowPrice()` з `@pricing/domain/day-price`, — і воно не
 * буває в SQL: запит віддає колонки, рішення ухвалює домен.
 */
export async function getBulkPrices(organizationId: string, startDate: string, endDate: string) {
  const sql = getSql();
  const rows = await sql.rows<any>(`
    SELECT pc.unit_type_id, pc.date, pc.base_price, pc.weekend_price
    FROM price_calendar pc
    JOIN unit_types ut ON pc.unit_type_id = ut.id
    JOIN properties p ON ut.property_id = p.id
    WHERE p.organization_id = ? AND pc.date >= ? AND pc.date <= ?
    ORDER BY pc.unit_type_id, pc.date
  `, [organizationId, startDate, endDate]);
  return rows.map((r) => ({ ...r, effective_price: dayRowPrice(r, r.date).price }));
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
  /** Джерело ціни (Ц27), коли в запиті є ціна. Дефолт — `manual`; рендер сезону передає `season`. */
  source?: PriceSource;
  /**
   * Не чіпати днів із ціною `manual` — точкових перевизначень. Так рендерить
   * сезон: його клітинка не затирає числа, яке оператор поставив на дату
   * рукою (їхній `overridden_from`). «Прибрати перевизначення» — той самий
   * виклик без цього прапорця.
   */
  keepManual?: boolean;
  /** Куди лягають обмеження з названим тарифом — див. `PriceCalendarOptions.restrictionsScope`. */
  restrictionsScope?: 'pair' | 'type';
}

export async function bulkUpdatePrices(input: BulkUpdateInput): Promise<number> {
  const sql = getSql();
  const { unitTypeId, dateFrom, dateTo, applyTo = 'all' } = input;
  const ratePlanId = input.ratePlanId ?? null;

  let count = 0;
  const written: string[] = [];
  const start = new Date(dateFrom);
  const end = new Date(dateTo);

  assertPositivePrice(input.base_price);
  assertPositivePrice(input.weekend_price);
  assertMinStay(input.min_stay);

  await sql.tx(async (t) => {
    // Канали — в тій самій транзакції, одним діапазоном (див. upsertPrices);
    // маска — з різниці по всіх днях діапазону, тому координата кладеться
    // ПІСЛЯ циклу, коли відомо, що змінилось.
    const owner = ratePlanId
      ? { property_id: (await ownedRatePlanFor(t, unitTypeId, ratePlanId)).propertyId }
      : await t.row<any>('SELECT property_id FROM unit_types WHERE id = ?', [unitTypeId]);
    const priceChanged = new Set<RateField>();
    const restrictionChanged = new Set<RateField>();
    const restrictionsOnPair = Boolean(ratePlanId) && input.restrictionsScope !== 'type';
    const restrictionInput = { min_stay: input.min_stay, max_stay: input.max_stay, closed: input.closed, cta: input.cta, ctd: input.ctd };

    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const dayOfWeek = current.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;

      if (applyTo === 'weekdays' && isWeekend) { current.setDate(current.getDate() + 1); continue; }
      if (applyTo === 'weekends' && !isWeekend) { current.setDate(current.getDate() + 1); continue; }

      // `rate_plan_id IS NULL` — базовий рядок типу: обмеження завжди його
      // (П7, Ц32), і ціна теж, коли тариф не вибрано. Без цієї умови на день
      // відповів би рядок тарифу, і «ціну не міняти» перенесло б число тарифу
      // в базову ціну. Рядок ТАРИФУ читається лише для його ціни.
      const base = await t.row<any>('SELECT * FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id IS NULL', [unitTypeId, dateStr]);
      const plan = ratePlanId
        ? await t.row<any>('SELECT * FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id = ?', [unitTypeId, dateStr, ratePlanId])
        : null;
      const priceRow = ratePlanId ? plan : base;

      // Перевизначення дати (Ц27): рядок із ціною, поставленою рукою, рендер
      // сезону обходить. Рядок без ціни (лише обмеження) — не перевизначення.
      if (input.keepManual && priceRow && (priceRow.source ?? 'manual') === 'manual' && priceRow.base_price != null) {
        current.setDate(current.getDate() + 1);
        continue;
      }

      // A day the hotel has never priced stays unpriced. The form's price field
      // says «Не змінювати» when left empty, so `base_price` is undefined
      // whenever the operator bulk-edits only min stay or the open/closed flag —
      // and `?? 0` once turned that into a real row worth zero: the quote
      // answered `missingDays: 0, total: 0`, and a confirmed booking was taken
      // for nothing. AGENTS.md §3 invariant 17: a night no source can price is
      // missing, not free. Since 0062 the row is written with `base_price`
      // NULL — the restriction is kept, the night stays unsellable.
      const basePrice = input.base_price ?? priceRow?.base_price ?? null;
      const weekendPrice = input.weekend_price !== undefined ? input.weekend_price : (priceRow?.weekend_price ?? null);
      const minStay = input.min_stay ?? base?.min_stay ?? 1;
      const maxStay = input.max_stay !== undefined ? input.max_stay : (base?.max_stay ?? null);
      const closed = input.closed !== undefined ? (input.closed ? 1 : 0) : (base?.closed ?? 0);
      const cta = input.cta !== undefined ? (input.cta ? 1 : 0) : (base?.cta ?? 0);
      const ctd = input.ctd !== undefined ? (input.ctd ? 1 : 0) : (base?.ctd ?? 0);
      // Джерело міняється лише разом із ціною (Ц27) — і належить рядку ЦІНИ.
      const pricedNow = input.base_price !== undefined || input.weekend_price !== undefined;
      const source: PriceSource = pricedNow ? (input.source ?? 'manual') : ((priceRow?.source as PriceSource | undefined) ?? 'manual');

      // Маски (Блок 0.5 / 0.6 A1): ціна — різниця ефективної ціни ПАРИ (власний
      // рядок цілком, коли має ціну, інакше базовий цілком — рецензія 07.09 п.1);
      // обмеження — різниця ефективного обмеження пари або типу (Ц32 переглянуто).
      const inherited = ratePlanId ? shapeOf(base) : null;
      const ownAfter: PriceShape = { base_price: num(basePrice), weekend_price: num(weekendPrice) };
      const afterPrice: PriceShape = effectivePrice(ownAfter, inherited) ?? { base_price: null, weekend_price: null };
      for (const f of changedPriceFields(effectivePriceBefore(shapeOf(priceRow), inherited), afterPrice)) priceChanged.add(f);
      const restrictions: RestrictionShape = {
        min_stay: Number(minStay) || 1, max_stay: num(maxStay), closed: Boolean(closed), cta: Boolean(cta), ctd: Boolean(ctd),
      };
      if (restrictionsOnPair) {
        const pairBefore = shapeOf(plan);
        const baseShape = shapeOf(base);
        for (const f of changedRestrictionFields(effectiveRestrictions(pairBefore, baseShape), effectiveRestrictions(pairAfter(pairBefore, restrictionInput as PriceUpsertInput), baseShape))) restrictionChanged.add(f);
      } else {
        for (const f of changedRestrictionFields(restrictionsOf(shapeOf(base)), restrictions)) restrictionChanged.add(f);
      }

      if (ratePlanId) {
        if (restrictionsOnPair) {
          // Ціна й власні обмеження пари — в її рядок; поля «не змінювати» не чіпаються.
          await writeRatePlanRow(t, unitTypeId, ratePlanId, dateStr, { base_price: num(basePrice), weekend_price: num(weekendPrice), source, ...restrictionInput }, Boolean(plan));
        } else {
          await writeRatePlanRow(t, unitTypeId, ratePlanId, dateStr, { base_price: num(basePrice), weekend_price: num(weekendPrice), source }, Boolean(plan));
          // «На всі тарифи типу»: базовий рядок — лише коли названо хоч одне
          // обмеження (рецензія 07.09 п.3: рендер сезону/похідного на 500 ночей
          // не має заводити 500 порожніх базових рядків із дефолтами).
          if (restrictionFieldsPresent(restrictionInput)) {
            await writeBaseRestrictions(t, unitTypeId, dateStr, restrictions, restrictions);
          }
        }
      } else {
        await t.run(`
        INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price, weekend_price, min_stay, max_stay, closed, cta, ctd, source)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ${ON_CONFLICT_ROW} DO UPDATE SET
          base_price = excluded.base_price,
          weekend_price = excluded.weekend_price,
          min_stay = excluded.min_stay,
          max_stay = excluded.max_stay,
          closed = excluded.closed,
          cta = excluded.cta,
          ctd = excluded.ctd,
          source = excluded.source,
          updated_at = CURRENT_TIMESTAMP
        `, [newId(), unitTypeId, dateStr, basePrice, weekendPrice, minStay, maxStay, closed, cta, ctd, source]);
      }
      count++;
      written.push(dateStr);
      current.setDate(current.getDate() + 1);
    }

    if (owner) {
      await noteCalendarChanged(t, {
        propertyId: String(owner.property_id), unitTypeId, ratePlanId, from: dateFrom, to: dateTo,
      }, priceChanged, restrictionChanged, restrictionsOnPair);
    }
  });

  if (input.source !== 'derived') await rerenderDependents(unitTypeId, ratePlanId, written);
  return count;
}

// ── Похідні тарифи (Блок 2 крок 2, Ц28) ─────────────────────────────────
//
// Похідний тариф не має власних цін: його рядок на дату = ціна БАЗОВОГО
// тарифу на цю дату (власний рядок бази, а без нього — базовий рядок типу,
// по полю: буденна й вихідних окремо) ± коригування — і рендериться тут же,
// через `upsertPrices` з `source: 'derived'` і `keepManual`: перевизначення
// дати на похідному живе, а канал отримує число тим самим шляхом, що й для
// будь-якого тарифу (Ц7: `derived_option` вендора не використовуємо).
// Зміна ціни бази — власного рядка чи рядка типу — перерендерює залежних
// тими самими датами; похідний від похідного писач не приймає, тож
// ланцюжок закінчується на одному кроці.

interface DerivedRule { id: string; basedOn: string; adjustment: RateAdjustment }

/** = `OUTBOX_HORIZON_DAYS` каналу: далі ночі не існує ні для кого. */
export const DERIVED_RENDER_DAYS = 500;

function toRule(row: any): DerivedRule {
  return {
    id: String(row.id), basedOn: String(row.based_on_rate_plan_id),
    adjustment: { kind: row.adjustment_kind, value: Number(row.adjustment_value), direction: row.adjustment_direction },
  };
}

/**
 * АКТИВНІ похідні тарифи обʼєкта цього типу, що спираються на `basePlanId`
 * (або на будь-яку базу, коли змінився рядок ТИПУ). Знятий з продажу не
 * перерендерюється (рецензія 07.09 п.2): кожна координата на його пару
 * везла б у канал «закрито» ще раз; повернення в продаж рендерить його само.
 */
async function derivedPlansOf(sql: Sql, unitTypeId: string, basePlanId: string | null): Promise<DerivedRule[]> {
  const select = `SELECT rp.id, rp.based_on_rate_plan_id, rp.adjustment_kind, rp.adjustment_value, rp.adjustment_direction
       FROM rate_plans rp JOIN unit_types ut ON ut.property_id = rp.property_id
      WHERE ut.id = ? AND rp.pricing_type = 'derived' AND rp.based_on_rate_plan_id IS NOT NULL AND rp.is_active = TRUE`;
  const rows = basePlanId
    ? await sql.rows<any>(`${select} AND rp.based_on_rate_plan_id = ?`, [unitTypeId, basePlanId])
    : await sql.rows<any>(select, [unitTypeId]);
  return rows.map(toRule);
}

/** Ефективна ціна базового тарифу на дати: власний рядок, а де в ньому порожньо — базовий рядок типу. */
async function basePricesFor(sql: Sql, unitTypeId: string, basePlanId: string, dates: string[]): Promise<Map<string, PriceShape>> {
  const out = new Map<string, PriceShape>();
  if (!dates.length) return out;
  const holes = dates.map(() => '?').join(', ');
  const rows = await sql.rows<any>(
    `SELECT date, rate_plan_id, base_price, weekend_price FROM price_calendar
      WHERE unit_type_id = ? AND (rate_plan_id IS NULL OR rate_plan_id = ?) AND date IN (${holes})`,
    [unitTypeId, basePlanId, ...dates],
  );
  const own = new Map<string, any>();
  const type = new Map<string, any>();
  for (const r of rows) (r.rate_plan_id == null ? type : own).set(String(r.date).slice(0, 10), r);
  for (const date of dates) {
    const o = own.get(date);
    const t = type.get(date);
    if (!o && !t) continue;
    // Рядок ЦІЛКОМ — власний, коли має ціну, інакше типу (рецензія 07.09 п.1):
    // так само читає `dayPrice`; по полю ціна вихідних типу просочилась би в
    // базу без вихідних, і похідний рендерив пʼятницю від числа, за яке база
    // її не продає.
    const shape = effectivePrice(shapeOf(o), shapeOf(t));
    if (shape) out.set(date, { base_price: shape.base_price, weekend_price: shape.weekend_price });
  }
  return out;
}

async function renderDerivedRows(unitTypeId: string, rule: DerivedRule, dates: string[]): Promise<void> {
  const base = await basePricesFor(getSql(), unitTypeId, rule.basedOn, dates);
  const inputs: PriceUpsertInput[] = dates.map((date) => {
    const b = base.get(date);
    return {
      date,
      base_price: derivedPrice(b?.base_price ?? null, rule.adjustment),
      weekend_price: derivedPrice(b?.weekend_price ?? null, rule.adjustment),
      source: 'derived',
    };
  });
  await upsertPrices(unitTypeId, inputs, { ratePlanId: rule.id, keepManual: true });
}

async function rerenderDependents(unitTypeId: string, basePlanId: string | null, dates: string[]): Promise<void> {
  const unique = [...new Set(dates)];
  if (!unique.length) return;
  for (const rule of await derivedPlansOf(getSql(), unitTypeId, basePlanId)) await renderDerivedRows(unitTypeId, rule, unique);
}

/**
 * Повний рендер похідного тарифу — від сьогодні до горизонту, на кожен тип
 * обʼєкта. Кличе писач тарифів після створення чи зміни правила. Тариф не
 * похідний або чужий — нічого не робить і каже нуль.
 */
export async function renderDerivedPlan(planId: string, today: string = new Date().toISOString().slice(0, 10)): Promise<number> {
  const sql = getSql();
  const organizationId = currentOrganizationId();
  if (!organizationId) throw new Error('price calendar: render without a tenant');
  const plan = await sql.row<any>(
    `SELECT rp.id, rp.property_id, rp.based_on_rate_plan_id, rp.adjustment_kind, rp.adjustment_value, rp.adjustment_direction
       FROM rate_plans rp JOIN properties p ON p.id = rp.property_id
      WHERE rp.id = ? AND p.organization_id = ? AND rp.pricing_type = 'derived'`,
    [planId, organizationId],
  );
  if (!plan || !plan.based_on_rate_plan_id) return 0;
  const rule = toRule(plan);
  const unitTypes = await sql.rows<any>('SELECT id FROM unit_types WHERE property_id = ?', [plan.property_id]);
  const dates: string[] = [];
  const [y, m, d] = today.split('-').map(Number);
  for (let i = 0; i < DERIVED_RENDER_DAYS; i++) dates.push(new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
  for (const ut of unitTypes) await renderDerivedRows(String(ut.id), rule, dates);
  return unitTypes.length;
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
/**
 * Обмеження дня для батчера каналів (Д1/Д2) — ЕФЕКТИВНІ (Ц32 переглянуто
 * 07.09): ключ `тип|дата` — обмеження типу; ключ `тип|тариф|дата` — обмеження
 * пари (власне, де є, інакше типу). Пара без свого рядка ключа не має:
 * читач бере ключ типу. Ключ пари є лише там, де рядок пари несе хоч одне
 * власне значення — інакше він казав би те саме, що тип.
 */
export async function dayRestrictions(unitTypeIds: string[], from: string, to: string): Promise<Map<string, DayRestrictions>> {
  const out = new Map<string, DayRestrictions>();
  if (unitTypeIds.length === 0) return out;
  const rows = await getSql().rows<any>(
    `SELECT unit_type_id, rate_plan_id, date, min_stay, max_stay, closed, cta, ctd
       FROM price_calendar
      WHERE unit_type_id IN (${unitTypeIds.map(() => '?').join(', ')}) AND date >= ? AND date <= ?`,
    [...unitTypeIds, from, to],
  );
  const toDay = (r: RestrictionShape): DayRestrictions => ({
    minStay: r.min_stay, maxStay: r.max_stay, noArrival: r.cta, noDeparture: r.ctd, closed: r.closed,
  });
  const baseBy = new Map<string, any>();
  for (const r of rows) if (r.rate_plan_id == null) baseBy.set(`${r.unit_type_id}|${String(r.date).slice(0, 10)}`, r);
  for (const [key, r] of baseBy) out.set(key, toDay(effectiveRestrictions(null, shapeOf(r))));
  for (const r of rows) {
    if (r.rate_plan_id == null || !hasOwnRestrictions(r)) continue;
    const date = String(r.date).slice(0, 10);
    out.set(`${r.unit_type_id}|${r.rate_plan_id}|${date}`, toDay(effectiveRestrictions(shapeOf(r), shapeOf(baseBy.get(`${r.unit_type_id}|${date}`)))));
  }
  return out;
}

/** Обмеження ПАРИ на день з мапи `dayRestrictions`: власний ключ пари, інакше типу. */
export function pairRestrictionsAt(map: Map<string, DayRestrictions>, unitTypeId: string, date: string, ratePlanId?: string | null): DayRestrictions | null {
  return (ratePlanId ? map.get(`${unitTypeId}|${ratePlanId}|${date}`) : undefined) ?? map.get(`${unitTypeId}|${date}`) ?? null;
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
