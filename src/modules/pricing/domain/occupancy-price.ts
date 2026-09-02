/**
 * What a stay costs: price by occupancy, and a discount for staying longer.
 *
 * The rule this is built around, stated by the customer and worth repeating
 * because everything follows from it:
 *
 *   OCCUPANCY CHANGES THE PRICE, NEVER THE CATEGORY.
 *
 * There is no single room in the pilot's hotel. Every double is sold to one
 * person at one price and to two at another, and both are the same category,
 * the same room, the same bed. A Vierbettzimmer for 1/2/3/4 people is one
 * category with four prices. So occupancy is a dimension of the PRICE, not of
 * the room inventory — a model where "EZ" is a category would need the hotel
 * to double its room list and would break availability on the first booking.
 *
 * `price_calendar` had `base_price` and `weekend_price` and nothing else. For
 * the German market that is not a gap, it is a blocker: EZ-versus-DZ occupancy
 * is the basic mode of selling, and DIRS21 sends those prices per occupancy.
 *
 * Two things vary and both are data:
 *
 *   the matrix     (unit type, date range, persons) → price for one night
 *   the LOS tiers  (unit type, from N nights) → what to add per night
 *
 * Nothing here knows a season name, a price or a discount. The pilot's
 * "−10 € per night from 3 nights on doubles, −5 € on singles" is two rows.
 *
 * ── Вісь — ДОРОСЛІ, дитина йде надбавкою (Ц12, 01.09.2026) ──────────────
 *
 * До цього рішення матриця адресувалася сумою «дорослі + діти», тобто дитина
 * коштувала як доросла, і сімʼя 2+2 платила за чотирьох. Розділ при цьому вже
 * існував усюди, крім ціни: `unit_types` знає `max_adults`/`max_children`,
 * `reservations` — `adults`/`children`/`infants`. Сплющувала його одна
 * колонка `price_occupancy.persons`.
 *
 * Два джерела, з яких цей проєкт бере форму, кажуть те саме: у Hoteliera
 * екран «Extra occupancy» розрізняє Adult і Child окремими родами гостя, а в
 * Channex опція заселеності за означенням про дорослих, діти — окремим
 * `children_fee` на тарифі. Тобто вісь дорослих — не запозичення в вендора,
 * а те, чим решта схеми вже була.
 */
import { money } from '../../../core/money.ts';

export interface PriceRow {
  /** Null means "any unit type" — a house-wide price. */
  unit_type_id?: string | null;
  /** Inclusive ISO dates. Null on either side means open-ended. */
  valid_from?: string | null;
  valid_to?: string | null;
  /** How many people this price is for. */
  persons: number;
  /** Gross, per night. */
  price_gross: number;
}

export interface LosTier {
  unit_type_id?: string | null;
  /** Applies from this many nights on. */
  min_nights: number;
  /** Added to the nightly price. Negative is a discount. */
  adjustment_gross: number;
  /** When set, the tier only applies at this occupancy. */
  persons?: number | null;
}

export interface NightPrice {
  date: string;
  base: number;
  adjustment: number;
  price: number;
}

export interface Quote {
  nights: NightPrice[];
  total: number;
  /** Nights the matrix had no row for. A quote with these is not sellable. */
  missing: string[];
}

/**
 * Price a stay, night by night.
 *
 * Night by night rather than "nights × price" because a stay crosses seasons:
 * two nights in low season and one in high is three different prices, and a
 * single multiplication silently charges the wrong one for two of them.
 *
 * A night with no matching row is REPORTED, not guessed. An invented price is
 * a booking taken at a number the hotel never agreed to.
 */
export function quoteStay(input: {
  checkIn: string;
  nights: number;
  /**
   * ДОРОСЛІ, і саме вони адресують цінову матрицю (рішення Ц12).
   *
   * Поле навмисно не називається `persons`, хоч так було до 01.09.2026:
   * перейменування — це те, що змушує кожного викликача перечитати, ЩО він
   * сюди клав. Тихе збереження старої назви лишило б три місця, які
   * продовжують передавати `adults + children`, і жоден компілятор про це
   * не сказав би.
   */
  adults: number;
  /** Скільки дітей. Вони не входять у `adults` і мають власну ціну. */
  children?: number;
  /**
   * Скільки коштує одна дитина за ніч. `null`/відсутнє — готель цього НЕ
   * називав.
   *
   * І тоді ніч із дітьми — `missing`, а не «діти безкоштовно». Це інваріант
   * 17 у чистому вигляді, і в цьому файлі вже є його ціна: `?? 0` у
   * `bulkUpdatePrices` колись перетворив «готель не назвав ціни» на «ніч
   * коштує нуль», і бронювання пройшло за нуль. Нуль тут — теж ціна, але
   * названа: `0` означає «діти безкоштовно», і це готель каже сам.
   */
  childExtraGross?: number | null;
  unitTypeId: string;
  matrix: readonly PriceRow[];
  losTiers?: readonly LosTier[];
}): Quote {
  // Без `adults` матрицю нема чим адресувати — відмова з назвою, не тихий
  // `missing` на кожну ніч: JS-викликачі (скрипти) після перейменування
  // `persons` → `adults` (Ц12) три тижні передавали старий ключ (02.09.2026).
  if (typeof input.adults !== 'number' || Number.isNaN(input.adults)) {
    throw new Error('quoteStay: adults is required — the matrix is addressed by adults (Ц12)');
  }
  const nights: NightPrice[] = [];
  const missing: string[] = [];
  const children = Math.max(0, Math.trunc(input.children ?? 0));

  // Знижка за тривалість дивиться на заселеність дорослими — на ту саму вісь,
  // якою адресована матриця. Інакше «−10 € на двомісному» переставало б діяти
  // від того, що з батьками поїхала дитина.
  const tier = pickTier(input.losTiers ?? [], input.unitTypeId, input.nights, input.adults);
  const adjustment = tier ? money(tier.adjustment_gross) : 0;

  // Ціна дитини — надбавка до ночі, а не окремий рядок матриці: у матриці
  // вісь одна, і другий рід гостя зробив би її двовимірною. Форма з Hoteliera
  // («Extra occupancy»: Adult і Child окремими родами) і з Channex
  // (`children_fee` на тарифі) — обидві кажуть надбавку.
  const childrenGross = children > 0 && input.childExtraGross != null
    ? money(children * input.childExtraGross)
    : 0;

  for (let i = 0; i < input.nights; i++) {
    const date = addDays(input.checkIn, i);
    const row = pickPrice(input.matrix, input.unitTypeId, input.adults, date);
    if (!row) {
      missing.push(date);
      continue;
    }
    // Діти є, а ціни на них готель не називав — ніч не продається. Мовчки
    // взяти нуль означало б поселити дитину безкоштовно від імені готелю.
    if (children > 0 && input.childExtraGross == null) {
      missing.push(date);
      continue;
    }
    const base = money(row.price_gross + childrenGross);
    // A discount may not turn a night into money owed to the guest.
    const price = money(Math.max(0, base + adjustment));
    nights.push({ date, base, adjustment: money(price - base), price });
  }

  return { nights, total: money(nights.reduce((s, n) => s + n.price, 0)), missing };
}

/**
 * What the rate card says one night costs at this occupancy — or null when it
 * says nothing.
 *
 * Exported because the occupancy surcharge on a rate plan's price is the
 * difference between two of these (`priceNights()`), and that difference has
 * to be taken with the same row-picking rules the quote uses. Computing it
 * from a second `quoteStay()` would fold in the length-of-stay adjustment,
 * which is per-occupancy and therefore does not cancel out.
 */
export function matrixPriceFor(
  matrix: readonly PriceRow[],
  unitTypeId: string,
  persons: number,
  date: string,
): number | null {
  const row = pickPrice(matrix, unitTypeId, persons, date);
  return row ? money(row.price_gross) : null;
}

/**
 * The price for this type, this occupancy, this day.
 *
 * A row for the exact unit type beats a house-wide one, and a narrower date
 * range beats a wider one: that is how a season is entered — as an exception
 * laid over the standing price, without editing it.
 */
function pickPrice(
  matrix: readonly PriceRow[],
  unitTypeId: string,
  persons: number,
  date: string,
): PriceRow | null {
  const candidates = matrix.filter((r) =>
    r.persons === persons
    && (r.unit_type_id == null || r.unit_type_id === unitTypeId)
    && (!r.valid_from || r.valid_from <= date)
    && (!r.valid_to || r.valid_to >= date));

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    // Specific type first.
    const byType = Number(b.unit_type_id != null) - Number(a.unit_type_id != null);
    if (byType) return byType;
    // Then the shorter window — an open-ended row is the fallback.
    return span(a) - span(b);
  })[0];
}

/**
 * How wide a row's window is, for "the narrower one wins".
 *
 * Three widths, not two. A row bounded on one side — "until the end of 2026",
 * "from March on" — is a season with an open end, not a standing price, and it
 * has to beat the row that carries no dates at all. Both used to answer
 * MAX_SAFE_INTEGER, the comparator returned 0, and which price applied came
 * down to the order the rows happened to arrive in from SQL: the same night
 * quoted 89 or 45 depending on it. Ordering is not a pricing rule.
 */
const OPEN_ENDED = Number.MAX_SAFE_INTEGER;
const HALF_BOUND = Number.MAX_SAFE_INTEGER - 1;

function span(r: PriceRow): number {
  if (!r.valid_from && !r.valid_to) return OPEN_ENDED;
  if (!r.valid_from || !r.valid_to) return HALF_BOUND;
  return Date.parse(r.valid_to) - Date.parse(r.valid_from);
}

/** The best tier the stay qualifies for: the highest threshold it reaches. */
function pickTier(
  tiers: readonly LosTier[],
  unitTypeId: string,
  nights: number,
  persons: number,
): LosTier | null {
  const eligible = tiers.filter((t) =>
    nights >= t.min_nights
    && (t.unit_type_id == null || t.unit_type_id === unitTypeId)
    && (t.persons == null || t.persons === persons));
  if (eligible.length === 0) return null;

  return eligible.sort((a, b) => {
    const byNights = b.min_nights - a.min_nights;
    if (byNights) return byNights;
    // A tier written for this type wins over a house-wide one at the same
    // threshold.
    return Number(b.unit_type_id != null) - Number(a.unit_type_id != null);
  })[0];
}

/** ISO date + n days, without a timezone anywhere near it. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + n);
  return new Date(t).toISOString().slice(0, 10);
}
