/**
 * What each night of a stay costs — one answer, for every caller.
 *
 * There were three price loops: the operator's quote, the widget's reservation,
 * and the widget's calendar. Each read `price_calendar` and did its own
 * weekend/weekday arithmetic, and they had already drifted: the widget charged
 * a flat 2500 for a night with no price, which is one customer's currency and
 * one customer's number, silently billed to whoever books next.
 *
 * TWO SOURCES, AND WHY THE MATRIX WINS
 *
 * `price_occupancy` is the rate card the owner types: category × occupancy ×
 * season. `price_calendar` is one row per day — what a channel manager or
 * PriceLabs writes, and what the day-by-day screen edits.
 *
 * A night is priced from the matrix when the matrix has a row for that unit
 * type AND that number of guests. Otherwise the day row is used. Otherwise the
 * night is REPORTED as missing.
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
import { quoteStay, type PriceRow, type LosTier } from '../domain/occupancy-price';
import { money } from '@core/money';

export interface NightlyPrice {
  date: string;
  price: number;
  /** Where the number came from: the owner's rate card, or the day calendar. */
  source: 'matrix' | 'calendar';
  /** What the LOS tier took off, when the matrix priced this night. */
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
}

/**
 * Price the nights of a stay.
 *
 * `persons` is how many people sleep in the room — adults and children
 * together, because occupancy is about beds. A hotel that wants children priced
 * differently needs a rule of its own, and inventing one here would apply it to
 * every hotel without being asked.
 */
export async function priceNights(input: {
  unitTypeId: string;
  /** First night, YYYY-MM-DD. */
  checkIn: string;
  nights: number;
  persons: number;
}): Promise<NightlyPrices> {
  const sql = getSql();
  const { unitTypeId, checkIn, nights, persons } = input;
  if (nights <= 0) return { nights: [], missing: [], total: 0, occupancyPriced: false };

  const checkOut = addDays(checkIn, nights);

  // The property comes from the unit type rather than from the session: this
  // runs on the public widget path too, where there is no operator and the
  // organization is established from the unit being booked.
  const owner = await sql.row<any>(
    'SELECT p.id AS property_id, p.organization_id FROM unit_types ut JOIN properties p ON p.id = ut.property_id WHERE ut.id = ?',
    [unitTypeId],
  );

  const quote = owner
    ? quoteStay({
      checkIn, nights, persons, unitTypeId,
      matrix: await loadMatrixRows(owner.organization_id, owner.property_id),
      losTiers: await loadTierRows(owner.organization_id, owner.property_id),
    })
    : { nights: [], total: 0, missing: [] as string[] };

  const fromMatrix = new Map(quote.nights.map((n) => [n.date, n]));

  const days = await sql.rows<any>(
    `SELECT date, base_price, weekend_price FROM price_calendar
      WHERE unit_type_id = ? AND date >= ? AND date < ? ORDER BY date`,
    [unitTypeId, checkIn, checkOut],
  );
  const fromCalendar = new Map(days.map((d) => [day(d.date), d]));

  const out: NightlyPrice[] = [];
  const missing: string[] = [];
  let occupancyPriced = false;

  for (let i = 0; i < nights; i++) {
    const date = addDays(checkIn, i);

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

    // Neither source knows. Named, not guessed — an invented price is a
    // booking taken at a number the hotel never agreed to.
    missing.push(date);
  }

  return { nights: out, missing, total: money(out.reduce((s, n) => s + n.price, 0)), occupancyPriced };
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
      checkIn: input.from, nights, persons: ut.persons, unitTypeId: ut.id, matrix,
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
