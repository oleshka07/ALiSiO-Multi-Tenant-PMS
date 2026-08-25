/**
 * Turning a stay into the charges a bill is made of.
 *
 * This is the step reception does by hand today for every channel booking:
 * Booking.com sent 91,05 €, breakfast was included for one person for one
 * night, so 12,00 of that was food at the reduced rate, 3,00 was drinks at the
 * standard rate, and the remaining 76,05 was the room. Three lines, two rates,
 * from one number, once per booking, every morning.
 *
 * It happens HERE rather than in each channel importer for two reasons. There
 * are the importers — iCal, Booking.com, the widget
 * and the operator's own screen — and six copies of this would be six
 * different bills. And a booking changes after it arrives: dates move, guests
 * are added, the amount is corrected. Charges posted at import time would be
 * the old booking's; posted when the folio is made, they are the stay that
 * actually happened.
 *
 * Nothing is invented. A day with no VAT rate configured, or an amount smaller
 * than the breakfast it supposedly includes, stops the posting and says why.
 */
import { getSql } from '@core/db/async';
import { money } from '@core/money';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { pickRate, type TaxRate } from '../domain/invoice-vat';
import { splitOtaAmount, linesGross, type ChargeLine } from '../domain/ota-split';
import { ruleFor, type ChannelRateRule } from '../domain/channel-rate-rule';
import { chargeName, localeForLanguage } from '../domain/invoice-document';
import { documentLanguage } from '@core/i18n/resolve';
import { addCharges, type NewCharge } from './folio.repo';

export interface PostResult {
  posted: number;
  gross: number;
  lines: ChargeLine[];
}

/** Why nothing was posted. Each of these is a sentence an operator can act on. */
export type PostRefusal =
  | { reason: 'no_reservation' }
  | { reason: 'already_posted' }
  | { reason: 'no_amount' }
  | { reason: 'breakfast_exceeds_total'; total: number }
  | { reason: 'no_tax_rate'; code: string; date: string }
  /** A service has no `vat_code`. Named with the service, because the fix is
   *  one field on one row in Settings → Guest services. */
  | { reason: 'service_without_tax_code'; services: string[] };

/**
 * Post the stay's charges onto a folio.
 *
 * Returns the refusal instead of throwing, because every one of them is
 * something the hotel can fix on a settings screen, and an exception here
 * would reach reception as "500".
 */
export async function postStayCharges(input: {
  folioId: string;
  reservationId: string;
}): Promise<PostResult | PostRefusal> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  const res = await sql.row<any>(
    `SELECT r.id, r.check_in, r.check_out, r.adults, r.children, r.total_price, r.source,
            r.property_id, r.lodging_discount_percent, r.lodging_discount_reason,
            r.breakfast_included,
            u.code AS unit_code, u.name AS unit_name,
            ut.breakfast_included AS type_breakfast_included,
            g.first_name, g.last_name
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN unit_types ut ON ut.id = u.unit_type_id
       LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.id = ? AND r.organization_id = ?`,
    [input.reservationId, organizationId],
  );
  if (!res) return { reason: 'no_reservation' };

  // Posting twice would double the bill. The test is on the folio rather than
  // on the reservation: a stay may be split across two folios (the company
  // pays the room, the guest pays the bar) and each is posted once.
  const already = await sql.row<any>(
    `SELECT 1 FROM fin_folio_items
      WHERE organization_id = ? AND folio_id = ? AND reservation_id = ? AND source = 'ota_split'`,
    [organizationId, input.folioId, input.reservationId],
  );
  if (already) return { reason: 'already_posted' };

  const total = Number(res.total_price) || 0;
  if (total <= 0) return { reason: 'no_amount' };

  const checkIn = day(res.check_in);
  const checkOut = day(res.check_out);
  const nights = Math.max(1, Math.round(
    (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000));
  const persons = Math.max(1, (Number(res.adults) || 0) + (Number(res.children) || 0));

  const rules = await sql.rows<any>(
    `SELECT channel, includes_breakfast, breakfast_food_price, breakfast_drinks_price,
            lodging_tax_code, food_tax_code, drinks_tax_code, markup_percent
       FROM channel_rate_rules WHERE organization_id = ?`,
    [organizationId],
  );
  const rule = ruleFor(rules.map(toRule), res.source);

  const rates = await sql.rows<TaxRate>(
    'SELECT code, rate, valid_from, valid_to FROM fin_tax_rates WHERE organization_id = ?',
    [organizationId],
  );

  // The rate is chosen by the date of SERVICE, and the first night is when the
  // room is supplied. A stay that crosses a rate change is a real case and is
  // handled by the rate table's dates, not by a rule here.
  const rateFor = (code: string) => pickRate(rates, code as TaxRate['code'], checkIn);

  const lodgingCode = rule?.lodging_tax_code ?? 'reduced';
  const lodgingRate = rateFor(lodgingCode);
  if (!lodgingRate) return { reason: 'no_tax_rate', code: lodgingCode, date: checkIn };

  // Whether to carve breakfast out of the total — three voices, most specific
  // first, first non-NULL wins:
  //
  //   the booking      what was actually sold to this guest;
  //   the unit type    what this room's price list means. The Appartements are
  //                    why this level exists: their prices are «zzgl. FRST
  //                    15,00 € / Person» while every hotel-room tariff includes
  //                    breakfast — one property, two truths, and the channel
  //                    rule below can only hold one;
  //   the channel rule the property-wide guess keyed on the booking's source,
  //                    exactly as before these columns existed.
  //
  // Carving 15 € out of a 45 € night that contains none drops the lodging
  // line to 30 € and moves 3 € from 7 % into 19 % VAT — a wrong tax return,
  // not a rounding slip. That is what the two upper voices prevent.
  //
  // Read as `!= null` + truthiness, not `=== true`: SQLite hands the flag
  // back as 0/1 and Postgres as 1/0 through the seam's bool shape, and NULL
  // is the only value that means "this level didn't say".
  const asStated = (v: unknown) => (v == null ? null : Boolean(Number(v)));
  const bookingSaysBreakfast = asStated(res.breakfast_included)
    ?? asStated(res.type_breakfast_included);

  let breakfast = null;
  // `&& rule`: the booking can say breakfast is inside the price, but only
  // the rule knows what the split costs (12 + 3 for the pilot). A booking
  // that says "included" in a hotel with no rule cannot be split honestly —
  // it posts as one lodging line, exactly what happened before this flag.
  if ((bookingSaysBreakfast ?? rule?.includes_breakfast) && rule) {
    const foodRate = rateFor(rule.food_tax_code);
    if (!foodRate) return { reason: 'no_tax_rate', code: rule.food_tax_code, date: checkIn };
    const drinksRate = rateFor(rule.drinks_tax_code);
    if (!drinksRate) return { reason: 'no_tax_rate', code: rule.drinks_tax_code, date: checkIn };
    breakfast = {
      foodPrice: rule.breakfast_food_price,
      drinksPrice: rule.breakfast_drinks_price,
      foodVatRate: foodRate.rate,
      drinksVatRate: drinksRate.rate,
    };
  }

  const lines = splitOtaAmount({
    totalGross: total, persons, nights,
    lodgingVatRate: lodgingRate.rate,
    breakfast,
    // Granted by a person, on this stay, on the accommodation only. The split
    // applies it after the breakfast is separated — see ota-split.ts.
    lodgingDiscountPercent: Number(res.lodging_discount_percent) || 0,
  });
  // The breakfast costs more than the whole booking. That is a wrong setting or
  // a wrong booking, and a negative room line on a guest's invoice is not the
  // way to find out which.
  if (lines == null) return { reason: 'breakfast_exceeds_total', total };

  const guestName = [res.first_name, res.last_name].filter(Boolean).join(' ') || null;
  const unitCode = res.unit_code || res.unit_name || null;

  // The words on the bill, in the language the DOCUMENT is issued in — the
  // jurisdiction's, never the operator's. Resolved here and stored, rather than
  // translated when shown: an invoice is a copy, and a line that changes its
  // wording because someone switched their interface is not a copy of anything.
  const locale = localeForLanguage(await documentLanguage(res.property_id));

  const charges: NewCharge[] = lines.map((l) => ({
    folioId: input.folioId,
    reservationId: input.reservationId,
    serviceDate: checkIn,
    kind: l.kind === 'lodging' ? 'lodging' : 'service',
    // The reduction is named on the line itself. An invoice that shows a
    // smaller number than the price list, with nothing saying why, is the one
    // a tax audit asks about — and the one reception cannot explain a year
    // later. The percent and the amount it came off are both on the line.
    description: l.discount
      ? `${chargeName(l.kind, locale)} (−${l.discount.percent} %)`
      : chargeName(l.kind, locale),
    guestName,
    unitCode,
    quantity: l.quantity,
    unitPriceGross: l.unitPriceGross,
    totalGross: l.totalGross,
    vatRate: l.vatRate,
    source: 'ota_split',
  }));

  await addCharges(charges);
  return { posted: charges.length, gross: linesGross(lines), lines };
}

/**
 * Post the services the guest actually ordered.
 *
 * Separate from the room, and posted independently of it, because the two
 * arrive at different times: the room is known when the booking lands, the
 * sauna is ordered on the second evening. Reception presses the same button
 * again and gets the new lines — not a refusal because the room is already
 * there.
 *
 * Only orders that are neither cancelled nor failed, and only those not yet on
 * this folio. The second test is by `service_order_id`, so pressing twice adds
 * nothing and pressing after a new order adds exactly that order.
 */
export async function postServiceCharges(input: {
  folioId: string;
  reservationId: string;
}): Promise<PostResult | PostRefusal> {
  const organizationId = await requireOrganizationId();
  const sql = getSql();

  const res = await sql.row<any>(
    `SELECT r.id, r.property_id, u.code AS unit_code, u.name AS unit_name,
            g.first_name, g.last_name
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.id = ? AND r.organization_id = ?`,
    [input.reservationId, organizationId],
  );
  if (!res) return { reason: 'no_reservation' };

  const orders = await sql.rows<any>(
    `SELECT o.id, o.quantity, o.unit_price, o.total_price, o.service_date,
            s.name AS service_name, s.name_de, s.vat_code
       FROM booking_service_orders o
       JOIN additional_services s ON s.id = o.service_id
      WHERE o.reservation_id = ?
        AND o.status <> 'cancelled'
        AND (o.payment_status IS NULL OR o.payment_status NOT IN ('failed', 'refunded'))
        AND NOT EXISTS (
          SELECT 1 FROM fin_folio_items i
           WHERE i.organization_id = ? AND i.folio_id = ? AND i.service_order_id = o.id
        )
      ORDER BY o.service_date, o.created_at`,
    [input.reservationId, organizationId, input.folioId],
  );
  if (orders.length === 0) return { posted: 0, gross: 0, lines: [] };

  // A service with no tax code stops the whole posting, not just its own line.
  // Posting the rest would hand reception a bill that looks complete and is
  // short one item — worse than a refusal that names what to fix.
  const untaxed = orders.filter((o) => !o.vat_code).map((o) => String(o.service_name));
  if (untaxed.length > 0) return { reason: 'service_without_tax_code', services: [...new Set(untaxed)] };

  const rates = await sql.rows<TaxRate>(
    'SELECT code, rate, valid_from, valid_to FROM fin_tax_rates WHERE organization_id = ?',
    [organizationId],
  );

  const guestName = [res.first_name, res.last_name].filter(Boolean).join(' ') || null;
  const unitCode = res.unit_code || res.unit_name || null;
  const locale = localeForLanguage(await documentLanguage(res.property_id));

  const charges: NewCharge[] = [];
  for (const o of orders) {
    const serviceDate = day(o.service_date) || day(new Date());
    const rate = pickRate(rates, o.vat_code as TaxRate['code'], serviceDate);
    if (!rate) return { reason: 'no_tax_rate', code: String(o.vat_code), date: serviceDate };

    charges.push({
      folioId: input.folioId,
      reservationId: input.reservationId,
      serviceOrderId: o.id,
      serviceDate,
      kind: 'service',
      // The hotel's own name for the service, in the document language where
      // it has one. Not chargeName(): these are the hotel's words, not ours.
      description: (locale === 'de-DE' && o.name_de) ? o.name_de : String(o.service_name),
      guestName,
      unitCode,
      quantity: Number(o.quantity) || 1,
      unitPriceGross: Number(o.unit_price) || 0,
      totalGross: Number(o.total_price) || 0,
      vatRate: rate.rate,
      source: 'service',
    });
  }

  await addCharges(charges);
  return {
    posted: charges.length,
    gross: money(charges.reduce((sum, c) => sum + c.totalGross, 0)),
    lines: [],
  };
}

function toRule(r: any): ChannelRateRule {
  return {
    channel: r.channel ?? null,
    // SQLite stores a flag as 0/1 and Postgres as a boolean; both arrive here.
    includes_breakfast: r.includes_breakfast === true || Number(r.includes_breakfast) === 1,
    breakfast_food_price: Number(r.breakfast_food_price) || 0,
    breakfast_drinks_price: Number(r.breakfast_drinks_price) || 0,
    lodging_tax_code: r.lodging_tax_code || 'reduced',
    food_tax_code: r.food_tax_code || 'reduced',
    drinks_tax_code: r.drinks_tax_code || 'standard',
    markup_percent: Number(r.markup_percent) || 0,
  };
}

function day(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v ?? '').slice(0, 10);
}
