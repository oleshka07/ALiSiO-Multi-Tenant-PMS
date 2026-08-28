/**
 * Halls, their add-ons, and the bookings that occupy them.
 *
 * Two decisions live here and nowhere else. A booking is REFUSED when its
 * hours collide with another non-cancelled booking of the same hall on the
 * same day — refused, not warned, because two confirmed events in one Saal is
 * a Saturday reception discovers at 14:00 with chairs already set. And the
 * money leaves through the same door as a stay's: `openFolio` creates a
 * fin_folio carrying the property (jurisdiction for the §14 document) and the
 * charges land as fin_folio_items with their VAT read from fin_tax_rates by
 * ROLE at the event's date — never a number typed here.
 */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { pickRate, type TaxRate } from '@invoicing/kernel';
import { timesOverlap, minutesBetween, suggestedBlockPrice, type BlockPrices } from '../domain/event-pricing';
import { openFolio as createFolio, addCharges } from '@invoicing/kernel';
import { money } from '@core/money';

export interface EventSpace {
  id: string;
  property_id: string;
  name: string;
  code: string;
  capacity_note: string | null;
  block_prices: string | null;
  sort_order: number;
  is_active: unknown;
}

export interface EventBooking {
  id: string;
  property_id: string;
  space_id: string;
  event_date: string;
  time_from: string;
  time_to: string;
  persons: number;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  company: string | null;
  status: 'draft' | 'confirmed' | 'cancelled';
  notes: string | null;
  folio_id: string | null;
}

/** block_prices column → BlockPrices; broken JSON reads as "no suggestions". */
export function parseBlockPrices(raw: string | null | undefined): BlockPrices {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export async function listSpaces(opts?: { all?: boolean }): Promise<EventSpace[]> {
  const organizationId = await requireOrganizationId();
  // `all` is the settings screen editing retired halls; everyone else sees
  // only what can still be sold.
  const active = opts?.all ? '' : 'AND is_active = TRUE';
  return await getSql().rows<EventSpace>(
    `SELECT * FROM event_spaces WHERE organization_id = ? ${active} ORDER BY sort_order, name`,
    [organizationId]);
}

export async function saveSpace(input: {
  id?: string | null;
  propertyId: string;
  name: string;
  code: string;
  capacityNote?: string | null;
  blockPrices?: BlockPrices | null;
  /** VAT role this hall's rent carries; absent keeps whatever it carries now. */
  vatCode?: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<string> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  // The property must be ours: an id from another tenant would otherwise ride
  // in through the API and hang this hall on somebody else's hotel.
  const prop = await sql.row<any>(
    'SELECT id FROM properties WHERE id = ? AND organization_id = ?',
    [input.propertyId, organizationId]);
  if (!prop) throw new Error('Property not found');

  const prices = input.blockPrices == null ? null : JSON.stringify(input.blockPrices);
  const active = (input.isActive ?? true) ? 'TRUE' : 'FALSE';
  if (input.id) {
    const found = await sql.run(
      `UPDATE event_spaces SET name = ?, code = ?, capacity_note = ?, block_prices = ?,
              vat_code = COALESCE(?, vat_code),
              sort_order = ?, is_active = ${active}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`,
      [input.name, input.code, input.capacityNote ?? null, prices,
       input.vatCode ?? null, input.sortOrder ?? 0, input.id, organizationId]);
    if (!found.changes) throw new Error('Space not found');
    return input.id;
  }
  const id = crypto.randomUUID();
  await sql.run(
    `INSERT INTO event_spaces
       (id, organization_id, property_id, name, code, capacity_note, block_prices,
        vat_code, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${active})`,
    [id, organizationId, input.propertyId, input.name, input.code,
     input.capacityNote ?? null, prices, input.vatCode ?? 'standard', input.sortOrder ?? 0]);
  return id;
}

export async function listAddons(opts?: { all?: boolean }) {
  const organizationId = await requireOrganizationId();
  const active = opts?.all ? '' : 'AND is_active = TRUE';
  return await getSql().rows<any>(
    `SELECT * FROM event_addons WHERE organization_id = ? ${active} ORDER BY sort_order, name`,
    [organizationId]);
}

export async function saveAddon(input: {
  id?: string | null;
  propertyId: string;
  name: string;
  kind: 'per_person' | 'flat' | 'per_hour' | 'per_piece';
  priceGross: number;
  vatCode?: string;
  note?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<string> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const prop = await sql.row<any>(
    'SELECT id FROM properties WHERE id = ? AND organization_id = ?',
    [input.propertyId, organizationId]);
  if (!prop) throw new Error('Property not found');

  const active = (input.isActive ?? true) ? 'TRUE' : 'FALSE';
  if (input.id) {
    const found = await sql.run(
      `UPDATE event_addons SET name = ?, kind = ?, price_gross = ?, vat_code = ?, note = ?,
              sort_order = ?, is_active = ${active}
        WHERE id = ? AND organization_id = ?`,
      [input.name, input.kind, input.priceGross, input.vatCode ?? 'standard',
       input.note ?? null, input.sortOrder ?? 0, input.id, organizationId]);
    if (!found.changes) throw new Error('Addon not found');
    return input.id;
  }
  const id = crypto.randomUUID();
  await sql.run(
    `INSERT INTO event_addons
       (id, organization_id, property_id, name, kind, price_gross, vat_code, note, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${active})`,
    [id, organizationId, input.propertyId, input.name, input.kind, input.priceGross,
     input.vatCode ?? 'standard', input.note ?? null, input.sortOrder ?? 0]);
  return id;
}

export async function listBookings(filter?: {
  from?: string; to?: string; spaceId?: string;
}): Promise<EventBooking[]> {
  const organizationId = await requireOrganizationId();
  const where = ['b.organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (filter?.from) { where.push('b.event_date >= ?'); params.push(filter.from); }
  if (filter?.to) { where.push('b.event_date <= ?'); params.push(filter.to); }
  if (filter?.spaceId) { where.push('b.space_id = ?'); params.push(filter.spaceId); }
  return await getSql().rows<EventBooking>(
    `SELECT b.*, s.name AS space_name, s.code AS space_code
       FROM event_bookings b JOIN event_spaces s ON s.id = b.space_id
      WHERE ${where.join(' AND ')}
      ORDER BY b.event_date, b.time_from`,
    params);
}

const TIME = /^\d{2}:\d{2}$/;

/**
 * Book a hall — or refuse, in a sentence reception can read aloud.
 *
 * The overlap answer comes from the rows, not from an index: SQLite and
 * Postgres would need different range machinery for [from, to) exclusion, and
 * a day of one hall's bookings is a handful of rows. Cancelled bookings do
 * not block — a cancelled wedding must free its Saturday.
 */
export async function createBooking(input: {
  spaceId: string;
  eventDate: string;
  timeFrom: string;
  timeTo: string;
  persons?: number;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  company?: string | null;
  status?: 'draft' | 'confirmed';
  notes?: string | null;
}): Promise<{ id: string; suggestedPrice: number | null }> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) throw new Error('event_date must be YYYY-MM-DD');
  if (!TIME.test(input.timeFrom) || !TIME.test(input.timeTo)) throw new Error('time must be HH:MM');
  if (!(input.timeFrom < input.timeTo)) throw new Error('time_from must be before time_to');

  const space = await sql.row<EventSpace>(
    'SELECT * FROM event_spaces WHERE id = ? AND organization_id = ?',
    [input.spaceId, organizationId]);
  if (!space) throw new Error('Space not found');

  const sameDay = await sql.rows<EventBooking>(
    `SELECT time_from, time_to FROM event_bookings
      WHERE organization_id = ? AND space_id = ? AND event_date = ? AND status != 'cancelled'`,
    [organizationId, input.spaceId, input.eventDate]);
  const clash = sameDay.find((b) => timesOverlap(input.timeFrom, input.timeTo, b.time_from, b.time_to));
  if (clash) throw new Error(`Space is occupied ${clash.time_from}–${clash.time_to} that day`);

  const id = crypto.randomUUID();
  await sql.run(
    `INSERT INTO event_bookings
       (id, organization_id, property_id, space_id, event_date, time_from, time_to,
        persons, customer_name, customer_email, customer_phone, company, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizationId, space.property_id, input.spaceId, input.eventDate,
     input.timeFrom, input.timeTo, input.persons ?? 0, input.customerName,
     input.customerEmail ?? null, input.customerPhone ?? null, input.company ?? null,
     input.status ?? 'confirmed', input.notes ?? null]);

  // The price sheet's number for these hours — a STARTING point the operator
  // edits, per the owner's «Preise sind variabel … manuell einpflegbar».
  const suggestedPrice = suggestedBlockPrice(
    parseBlockPrices(space.block_prices),
    minutesBetween(input.timeFrom, input.timeTo));
  return { id, suggestedPrice };
}

export async function updateBooking(id: string, patch: {
  eventDate?: string;
  timeFrom?: string;
  timeTo?: string;
  persons?: number;
  customerName?: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  company?: string | null;
  status?: 'draft' | 'confirmed' | 'cancelled';
  notes?: string | null;
}): Promise<void> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const current = await sql.row<EventBooking>(
    'SELECT * FROM event_bookings WHERE id = ? AND organization_id = ?', [id, organizationId]);
  if (!current) throw new Error('Booking not found');

  const next = {
    event_date: patch.eventDate ?? current.event_date,
    time_from: patch.timeFrom ?? current.time_from,
    time_to: patch.timeTo ?? current.time_to,
    status: patch.status ?? current.status,
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(next.event_date).slice(0, 10))) throw new Error('event_date must be YYYY-MM-DD');
  if (!TIME.test(next.time_from) || !TIME.test(next.time_to)) throw new Error('time must be HH:MM');
  if (!(next.time_from < next.time_to)) throw new Error('time_from must be before time_to');

  // Moving an event re-runs the same collision question as creating it —
  // minus itself, or no event could ever change its own hours.
  if (next.status !== 'cancelled') {
    const sameDay = await sql.rows<EventBooking>(
      `SELECT id, time_from, time_to FROM event_bookings
        WHERE organization_id = ? AND space_id = ? AND event_date = ?
          AND status != 'cancelled' AND id != ?`,
      [organizationId, current.space_id, String(next.event_date).slice(0, 10), id]);
    const clash = sameDay.find((b) => timesOverlap(next.time_from, next.time_to, b.time_from, b.time_to));
    if (clash) throw new Error(`Space is occupied ${clash.time_from}–${clash.time_to} that day`);
  }

  await sql.run(
    `UPDATE event_bookings SET event_date = ?, time_from = ?, time_to = ?, persons = ?,
            customer_name = ?, customer_email = ?, customer_phone = ?, company = ?,
            status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`,
    [String(next.event_date).slice(0, 10), next.time_from, next.time_to,
     patch.persons ?? current.persons,
     patch.customerName ?? current.customer_name,
     patch.customerEmail === undefined ? current.customer_email : patch.customerEmail,
     patch.customerPhone === undefined ? current.customer_phone : patch.customerPhone,
     patch.company === undefined ? current.company : patch.company,
     next.status, patch.notes === undefined ? current.notes : patch.notes,
     id, organizationId]);
}

/**
 * The booking's bill. Created once, carrying the PROPERTY — that is what
 * lets an invoice with no reservation still know its jurisdiction
 * (invoice-document.repo reads COALESCE(reservation→property, folio.property_id)).
 */
export async function openFolio(bookingId: string): Promise<string> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const booking = await sql.row<EventBooking>(
    'SELECT * FROM event_bookings WHERE id = ? AND organization_id = ?',
    [bookingId, organizationId]);
  if (!booking) throw new Error('Booking not found');
  if (booking.folio_id) return booking.folio_id;

  const folioId = await createFolio({
    propertyId: booking.property_id,
    payerKind: booking.company ? 'company' : 'guest',
    payerName: booking.company || booking.customer_name,
    label: `Event ${booking.event_date}`,
  });
  await sql.run(
    'UPDATE event_bookings SET folio_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?',
    [folioId, bookingId, organizationId]);
  return folioId;
}

/**
 * Post the event's charges: the hall line (the operator's price, suggested or
 * edited) and the chosen add-ons. The hall's VAT ROLE comes from the hall
 * itself (`event_spaces.vat_code`) unless the request names one; the RATE for
 * that role comes from fin_tax_rates at the EVENT's date — a rate change between booking and event day picks the event
 * day's number, same rule as a stay. A missing rate refuses the whole
 * posting: a line with invented tax would reach a legal document.
 */
export async function postEventCharges(bookingId: string, input: {
  hallPriceGross: number;
  hallVatCode?: string;
  hallDescription?: string;
  addons?: Array<{ addonId: string; quantity?: number }>;
}): Promise<{ folioId: string; posted: number }> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();
  const booking = await sql.row<any>(
    `SELECT b.*, s.name AS space_name, s.vat_code AS space_vat_code FROM event_bookings b
       JOIN event_spaces s ON s.id = b.space_id
      WHERE b.id = ? AND b.organization_id = ?`,
    [bookingId, organizationId]);
  if (!booking) throw new Error('Booking not found');

  const rates = await sql.rows<TaxRate>(
    'SELECT code, rate, valid_from, valid_to FROM fin_tax_rates WHERE organization_id = ?',
    [organizationId]);
  const eventDate = String(booking.event_date).slice(0, 10);
  const rateFor = (code: string) => {
    const rate = pickRate(rates, code as TaxRate['code'], eventDate);
    if (!rate) throw new Error(`No tax rate '${code}' for ${eventDate}`);
    return rate.rate;
  };

  // ── Зала виставляється один раз ──────────────────────────────────────
  //
  // Кнопка «Рахунок» кладе позиції й одразу випускає рахунок. `openFolio`
  // ідемпотентний, `issueInvoice` відмовляється брати вже зафактуровану
  // позицію — а ця функція при кожному виклику ДОДАЄ рядки. Тож друге
  // натискання давало другий рахунок із тим самим заходом і новим номером у
  // книзі. У Німеччині номер видано; прибрати його можна лише сторно.
  //
  // Перевіряється живий РЯДОК, а не прапорець: сторнований рядок означає, що
  // залу треба виставити наново, і система мусить це дозволити.
  let hallAlreadyBilled = false;
  if (booking.hall_charge_item_id) {
    const line = await sql.row<any>(
      `SELECT id FROM fin_folio_items
        WHERE id = ? AND organization_id = ? AND voided_by_item_id IS NULL`,
      [booking.hall_charge_item_id, organizationId]);
    hallAlreadyBilled = !!line;
  }
  if (hallAlreadyBilled && input.hallPriceGross > 0) {
    throw new Error('The hall of this event is already on the folio — void that line before billing it again');
  }

  const charges = [];
  // Id відомий наперед, бо бронь мусить на нього послатись. Дізнатись його
  // постфактум ніяк: запит «останній ручний рядок цього фоліо» вгадує.
  const hallItemId = crypto.randomUUID();
  // Доповнення НЕ обмежуються: додаткова кава на тому ж заході — законна
  // операція, а не дублікат.
  if (input.hallPriceGross > 0) {
    charges.push({
      id: hallItemId,
      folioId: '',
      serviceDate: eventDate,
      kind: 'service' as const,
      description: input.hallDescription
        || `${booking.space_name} ${booking.time_from}–${booking.time_to}`,
      quantity: 1,
      unitPriceGross: input.hallPriceGross,
      totalGross: input.hallPriceGross,
      // The hall's own code, not a literal: room hire and accommodation are
      // taxed differently, the line between them is the hotel's Steuerberater's
      // call, and it is recorded on the hall. An explicit code in the request
      // still wins — one event can be billed differently, and that is the
      // operator's decision to make on the spot.
      vatRate: rateFor(input.hallVatCode ?? booking.space_vat_code ?? 'standard'),
      source: 'manual' as const,
    });
  }

  for (const pick of input.addons ?? []) {
    const addon = await sql.row<any>(
      'SELECT * FROM event_addons WHERE id = ? AND organization_id = ?',
      [pick.addonId, organizationId]);
    if (!addon) throw new Error('Addon not found');
    // per_person defaults to the booking's headcount; everything else to 1 —
    // Wasser is sold "×30 Personen", a Flipchart is a Flipchart.
    const quantity = Number(pick.quantity
      ?? (addon.kind === 'per_person' ? booking.persons || 1 : 1));
    if (!(quantity > 0)) continue;
    const price = Number(addon.price_gross);
    charges.push({
      folioId: '',
      serviceDate: eventDate,
      kind: 'service' as const,
      description: addon.name,
      quantity,
      unitPriceGross: price,
      // `money()`, а не `Math.round(x * 100) / 100`: друге йде через `* 100`,
      // де 1.005 стає 100.49999999999999 і округлюється ВНИЗ. Це рядок, який
      // потрапляє в рахунок.
      totalGross: money(price * quantity),
      vatRate: rateFor(addon.vat_code),
      source: 'service' as const,
    });
  }

  if (!charges.length) return { folioId: await openFolio(bookingId), posted: 0 };

  // The folio is opened only after every rate resolved: a refusal above must
  // leave nothing behind, not an empty bill.
  const folioId = await openFolio(bookingId);
  for (const c of charges) c.folioId = folioId;
  const posted = await addCharges(charges);
  // Запам'ятовуємо рядок зали, а не факт «виставлено»: сторнований рядок
  // означає, що залу можна виставити наново.
  if (input.hallPriceGross > 0) {
    await sql.run(
      'UPDATE event_bookings SET hall_charge_item_id = ? WHERE id = ? AND organization_id = ?',
      [hallItemId, bookingId, organizationId]);
  }
  return { folioId, posted };
}
