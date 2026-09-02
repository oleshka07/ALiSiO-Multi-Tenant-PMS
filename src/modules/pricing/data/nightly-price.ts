/**
 * What each night of a stay costs — one answer, for every caller.
 *
 * There were three price loops: the operator's quote, the widget's reservation,
 * and the widget's calendar. Each read `price_calendar` and did its own
 * weekend/weekday arithmetic, and they had already drifted: the widget charged
 * a flat 2500 for a night with no price, which is one customer's currency and
 * one customer's number, silently billed to whoever books next.
 *
 * THREE SOURCES, AND THE ORDER THEY ANSWER IN
 *
 * `price_occupancy` is the rate card the owner types: category × occupancy ×
 * season. `price_calendar` is one row per day — what a channel manager or
 * a channel writes, and what the day-by-day screen edits. Since rate plans
 * reached the calendar it holds two kinds of row: `rate_plan_id IS NULL` is
 * the unit type's own price, and a row naming a rate plan is that plan's
 * price for that day.
 *
 * Asked for a rate plan, that plan's row for the day answers first, with the
 * occupancy surcharge from the rate card added on top. Otherwise a night is
 * priced from the matrix when the matrix has a row for that unit type AND that
 * number of guests. Otherwise the base day row is used. Otherwise the night is
 * REPORTED as missing.
 *
 * Asked WITHOUT a rate plan — which is every caller written before this — the
 * first step cannot fire and the other three behave exactly as they did.
 *
 * The matrix wins because it is the only source that knows how many people are
 * in the room, and a hotel that sells a double to one person for 89 and to two
 * for 119 would otherwise be billing both at whatever single number the day row
 * holds. A hotel that has never opened the matrix screen has no rows at all, so
 * nothing changes for it — that is what makes this safe to land while a
 * customer is taking bookings through it.
 *
 * Every night says which source it came from, so "why is this night 129" has an
 * answer that does not require reading this file.
 */
import { getSql } from '@core/db/async';
import { quoteStay, matrixPriceFor, type PriceRow, type LosTier } from '../domain/occupancy-price';
import { OPEN_STAY, type StayRestrictions } from '../domain/restrictions';
import { money } from '@core/money';

export interface NightlyPrice {
  date: string;
  price: number;
  /**
   * Where the number came from: the rate plan's own day row, the owner's rate
   * card, or the day calendar's base row.
   */
  source: 'rate_plan' | 'matrix' | 'calendar';
  /**
   * What was added to or taken off the base number: the LOS tier when the
   * matrix priced this night, the occupancy surcharge when a rate plan did.
   */
  adjustment?: number;
}

export interface NightlyPrices {
  nights: NightlyPrice[];
  /** Dates no source could price. A stay with any of these is not sellable. */
  missing: string[];
  total: number;
  /**
   * True when at least one night came from the matrix.
   *
   * The caller must then NOT add `extra_person_charge` on top: the matrix
   * already prices by how many people are in the room, and adding the old
   * per-extra-guest surcharge would charge for the same guest twice.
   */
  occupancyPriced: boolean;
  /**
   * Партія не вміщається в тип номера — і тоді всі ночі в `missing`.
   *
   * До Ц12 це ловилося ВИПАДКОВО: `persons` складав дорослих із дітьми, тож
   * сімʼя на сім осіб просто не знаходила рядка матриці. Після розділу осі
   * дорослих двоє, рядок на двох є, і питати «а куди подіти пʼятьох дітей»
   * стало нікому. Прапорець окремий від `missing`, бо причина інша: ціни не
   * бракує, бракує ліжок, і повідомлення гостю має бути іншим.
   */
  overCapacity?: boolean;
  /**
   * Ночі, які готель ЗАКРИВ у календарі (Д2, INC-012). Кожна з них є і в
   * `missing`: закрита ніч не продається так само, як неоцінена (інваріант
   * 17), — але гість має почути «закрито», а не «немає ціни».
   */
  closed: string[];
  /**
   * Обмеження перебування з БАЗОВОГО рядка типу (Д1, INC-012): мінімум і
   * максимум ночей та заборона заїзду — з ночі заїзду, заборона виїзду — з
   * дати виїзду. Читає `stayRefusal()`; на тариф не дивимось (П7).
   */
  restrictions: StayRestrictions;
}

/**
 * Price the nights of a stay.
 *
 * `adults` addresses the price matrix; children are priced separately by the
 * rate plan's own surcharge (decision Ц12, 01.09.2026). Before that the two
 * were added together, so a child cost exactly what an adult cost and a family
 * of 2+2 paid for four adults — while `unit_types` and `reservations` had told
 * adults from children all along.
 */
export async function priceNights(input: {
  unitTypeId: string;
  /** First night, YYYY-MM-DD. */
  checkIn: string;
  nights: number;
  /** ДОРОСЛІ — саме вони адресують матрицю (Ц12). */
  adults: number;
  /**
   * Діти. Їх ціна — надбавка тарифу, і без тарифу її нема звідки взяти:
   * котирування з дітьми, але без `ratePlanId`, поверне ночі як `missing`.
   * Це інваріант 17, а не недогляд — «безкоштовно» теж треба назвати.
   */
  children?: number;
  /**
   * Price this rate plan rather than the unit type's own price.
   *
   * Left out — as every caller written before rate plans reached the calendar
   * leaves it out — nothing changes: the matrix answers, then the base day
   * row, then the night is missing. A rate plan only ever adds a way to
   * answer; it never takes one away.
   */
  ratePlanId?: string | null;
}): Promise<NightlyPrices> {
  const sql = getSql();
  const { unitTypeId, checkIn, nights, adults, children = 0, ratePlanId = null } = input;
  // Без `adults` матрицю нема чим адресувати — і це відмова з назвою, не тихе
  // «неоцінені ночі». Викликач на JavaScript (скрипт заведення готелю) після
  // перейменування `persons` → `adults` (Ц12) три тижні передавав старий ключ,
  // і котирування мовчки віддавало кожну ніч як `missing` (02.09.2026).
  if (typeof adults !== 'number' || Number.isNaN(adults)) {
    throw new Error('priceNights: adults is required — the matrix is addressed by adults (Ц12)');
  }
  if (nights <= 0) return { nights: [], missing: [], total: 0, occupancyPriced: false, closed: [], restrictions: OPEN_STAY };

  const checkOut = addDays(checkIn, nights);

  // The property comes from the unit type rather than from the session: this
  // runs on the public widget path too, where there is no operator and the
  // organization is established from the unit being booked.
  //
  // `base_occupancy` comes along because it is the occupancy a rate plan's
  // price is quoted at — the same baseline `extra_person_charge` counts extra
  // guests from, and the same one Channex calls the primary occupancy option.
  const owner = await sql.row<any>(
    `SELECT p.id AS property_id, p.organization_id, ut.base_occupancy,
            ut.max_adults, ut.max_children, ut.max_occupancy
       FROM unit_types ut JOIN properties p ON p.id = ut.property_id WHERE ut.id = ?`,
    [unitTypeId],
  );

  // ── Місткість: три межі, і жодна з них не випадкова ────────────────────
  //
  // Дорослі впираються в `max_adults` — це та сама межа, якою шов обрізає
  // заселеності для каналу. Діти — в `max_children`. Разом — у
  // `max_occupancy`, бо номер 2+2 не вміщає чотирьох дорослих і двох дітей
  // навіть тоді, коли кожна межа окремо дотримана.
  //
  // Порожній тип (`owner` немає) сюди не потрапляє: нижче він і так дає
  // порожнє котирування.
  if (owner) {
    const maxAdults = Math.max(1, Number(owner.max_adults) || 1);
    const maxChildren = Math.max(0, Number(owner.max_children) || 0);
    const maxOccupancy = Math.max(maxAdults, Number(owner.max_occupancy) || maxAdults);
    if (adults > maxAdults || children > maxChildren || adults + children > maxOccupancy) {
      const all: string[] = [];
      for (let i = 0; i < nights; i++) all.push(addDays(checkIn, i));
      return { nights: [], missing: all, total: 0, occupancyPriced: false, overCapacity: true, closed: [], restrictions: OPEN_STAY };
    }
  }

  const matrix = owner ? await loadMatrixRows(owner.organization_id, owner.property_id) : [];

  // Надбавка за дитину живе на ТАРИФІ (Ц12) — так само, як `children_fee` у
  // менеджера каналів. Без тарифу її не існує, і тоді ніч із дітьми не
  // продається: назвати нуль від імені готелю ми не можемо.
  const childExtraGross = ratePlanId
    ? (await sql.row<any>(
        'SELECT child_extra_gross FROM rate_plans WHERE id = ? AND property_id = ?',
        [ratePlanId, owner?.property_id ?? ''],
      ))?.child_extra_gross ?? null
    : null;

  const quote = owner
    ? quoteStay({
      checkIn, nights, adults, children, childExtraGross, unitTypeId,
      matrix,
      losTiers: await loadTierRows(owner.organization_id, owner.property_id),
    })
    : { nights: [], total: 0, missing: [] as string[] };

  const fromMatrix = new Map(quote.nights.map((n) => [n.date, n]));

  // Both kinds of row in one query: the base rows (`rate_plan_id IS NULL`) and,
  // when a rate plan was asked for, that plan's own. Two queries would be two
  // round trips for one answer.
  // Дата виїзду теж читається (`<=`): на ній живе заборона виїзду (CTD).
  // Ціни вона не має — цикл по ночах до неї не доходить.
  const days = await sql.rows<any>(
    `SELECT date, rate_plan_id, base_price, weekend_price, min_stay, max_stay, closed, cta, ctd FROM price_calendar
      WHERE unit_type_id = ? AND date >= ? AND date <= ?
        AND (rate_plan_id IS NULL${ratePlanId ? ' OR rate_plan_id = ?' : ''})
      ORDER BY date`,
    ratePlanId ? [unitTypeId, checkIn, checkOut, ratePlanId] : [unitTypeId, checkIn, checkOut],
  );
  const fromCalendar = new Map(days.filter((d) => d.rate_plan_id == null && String(day(d.date)) < checkOut).map((d) => [day(d.date), d]));
  const fromRatePlan = new Map(days.filter((d) => d.rate_plan_id != null && String(day(d.date)) < checkOut).map((d) => [day(d.date), d]));
  const baseRow = (date: string) => days.find((d) => d.rate_plan_id == null && day(d.date) === date);

  // Обмеження — лише з базового рядка типу (Д1; П7): рядок тарифу їх не має.
  const arrival = baseRow(checkIn);
  const departure = baseRow(checkOut);
  const closedNights: string[] = [];
  for (let i = 0; i < nights; i++) {
    const date = addDays(checkIn, i);
    if (Number(baseRow(date)?.closed ?? 0) === 1) closedNights.push(date);
  }
  const maxStayRaw = arrival?.max_stay;
  const restrictions: StayRestrictions = {
    minStay: Math.max(1, Number(arrival?.min_stay ?? 1) || 1),
    maxStay: maxStayRaw == null ? null : Number(maxStayRaw),
    noArrival: Number(arrival?.cta ?? 0) === 1,
    noDeparture: Number(departure?.ctd ?? 0) === 1,
    closedNights,
  };

  const baseOccupancy = Number(owner?.base_occupancy) || 2;

  /**
   * What the extra guests cost on top of a rate plan's price, per the rate card.
   *
   * The rate plan says what the room costs at `base_occupancy`; the matrix says
   * what occupancy is worth. Their difference is the surcharge, and because it
   * comes from the matrix it is THE SAME for every rate plan of this unit type
   * — the limitation the owner accepted knowingly (§10.11 of
   * docs/CHANNEX-INTEGRATION.md): "+400 for the second guest" applies to the
   * flexible rate and the non-refundable one alike.
   *
   * `null` means the rate card cannot say — it has no row for this occupancy,
   * or none for the baseline. Then the rate plan's own price stands alone and
   * `occupancyPriced` stays false, so the caller falls back to
   * `extra_person_charge` exactly as it does for a plain calendar night. That
   * is not an invented number: the hotel did set this rate plan's price for
   * this day, and only the uplift is unknown.
   */
  const surcharge = (date: string): number | null => {
    if (adults === baseOccupancy) return 0;
    const at = matrixPriceFor(matrix, unitTypeId, adults, date);
    const atBase = matrixPriceFor(matrix, unitTypeId, baseOccupancy, date);
    if (at == null || atBase == null) return null;
    return money(at - atBase);
  };

  const out: NightlyPrice[] = [];
  const missing: string[] = [];
  let occupancyPriced = false;

  for (let i = 0; i < nights; i++) {
    const date = addDays(checkIn, i);

    // Закрита ніч не продається жодним джерелом (Д2): ані тарифом, ані
    // матрицею, ані базою. Вона в `missing` — і названа в `closed`.
    if (closedNights.includes(date)) {
      missing.push(date);
      continue;
    }

    // The rate plan's price for this day beats the unit type's, which is the
    // whole point of putting it in the calendar: two rate plans of one room
    // type carry independent prices for the same date.
    const rp = fromRatePlan.get(date);
    if (rp) {
      const extra = surcharge(date);
      const price = money(Math.max(0, Number(dayPrice(rp, date)) + (extra ?? 0)));
      out.push({ date, price, source: 'rate_plan', adjustment: extra ?? undefined });
      if (extra != null) occupancyPriced = true;
      continue;
    }

    // No price for this rate plan on this day — fall through to the unit
    // type's. A rate plan priced for part of a stay is normal, not an error:
    // the certification tests set one for 10–16 November and nothing around it.
    const m = fromMatrix.get(date);
    if (m) {
      out.push({ date, price: m.price, source: 'matrix', adjustment: m.adjustment });
      occupancyPriced = true;
      continue;
    }

    const c = fromCalendar.get(date);
    if (c) {
      out.push({ date, price: money(Number(dayPrice(c, date))), source: 'calendar' });
      continue;
    }

    // No source knows. Named, not guessed — an invented price is a
    // booking taken at a number the hotel never agreed to.
    missing.push(date);
  }

  return { nights: out, missing, total: money(out.reduce((s, n) => s + n.price, 0)), occupancyPriced, closed: closedNights, restrictions };
}

/**
 * The cheapest price per day across several categories — the "from" figure the
 * public month calendar shows.
 *
 * Priced at each category's base occupancy, because nobody has said how many
 * guests yet, and a month calendar that answered "from 89" for a double sold
 * to two at 119 would be advertising a price the guest cannot get.
 *
 * Length-of-stay tiers are deliberately not applied: a single day is not a
 * stay, and showing the seven-night price on every square would be a number
 * nobody can book.
 */
export async function cheapestByDay(input: {
  unitTypes: { id: string; persons: number }[];
  /** Inclusive. */
  from: string;
  to: string;
}): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (input.unitTypes.length === 0) return out;

  const sql = getSql();
  const owner = await sql.row<any>(
    'SELECT p.id AS property_id, p.organization_id FROM unit_types ut JOIN properties p ON p.id = ut.property_id WHERE ut.id = ?',
    [input.unitTypes[0].id],
  );
  if (!owner) return out;

  // Loaded once for the whole month rather than per category per day.
  const matrix = await loadMatrixRows(owner.organization_id, owner.property_id);
  if (matrix.length === 0) return out;

  const nights = Math.round(
    (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  if (nights <= 0) return out;

  for (const ut of input.unitTypes) {
    const quote = quoteStay({
      checkIn: input.from, nights, adults: ut.persons, unitTypeId: ut.id, matrix,
    });
    for (const n of quote.nights) {
      const best = out.get(n.date);
      if (best == null || n.price < best) out.set(n.date, n.price);
    }
  }
  return out;
}

/**
 * The day row's price for this date.
 *
 * Friday, Saturday and Sunday take `weekend_price` where one is set. That rule
 * was written three times, identically, in three files; it lives here now.
 */
function dayPrice(row: any, date: string): number {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const isWeekend = dow === 0 || dow === 5 || dow === 6;
  return isWeekend && row.weekend_price != null ? row.weekend_price : row.base_price;
}

async function loadMatrixRows(organizationId: string, propertyId: string): Promise<PriceRow[]> {
  const rows = await getSql().rows<any>(
    `SELECT unit_type_id, persons, price_gross, valid_from, valid_to
       FROM price_occupancy WHERE organization_id = ? AND property_id = ?`,
    [organizationId, propertyId],
  );
  return rows.map((r) => ({
    unit_type_id: r.unit_type_id ?? null,
    persons: Number(r.persons),
    price_gross: Number(r.price_gross),
    valid_from: day(r.valid_from),
    valid_to: day(r.valid_to),
  }));
}

async function loadTierRows(organizationId: string, propertyId: string): Promise<LosTier[]> {
  const rows = await getSql().rows<any>(
    `SELECT unit_type_id, min_nights, adjustment_gross, persons
       FROM price_los_tiers WHERE organization_id = ? AND property_id = ?`,
    [organizationId, propertyId],
  );
  return rows.map((r) => ({
    unit_type_id: r.unit_type_id ?? null,
    min_nights: Number(r.min_nights),
    adjustment_gross: Number(r.adjustment_gross),
    persons: r.persons == null ? null : Number(r.persons),
  }));
}

/**
 * A calendar day as everything here compares it.
 *
 * SQLite returns the stored string; the Postgres driver returns a Date built in
 * the server's zone, and `new Date('2026-07-01').toISOString()` west of UTC is
 * 2026-06-30 — a season that starts a day early on one driver and not the other.
 */
function day(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
