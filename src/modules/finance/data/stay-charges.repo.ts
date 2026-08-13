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
 * are six importers — iCal, Hostex, Booking.com, the Excel import, the widget
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
  | { reason: 'no_tax_rate'; code: string; date: string };

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
            r.property_id,
            u.code AS unit_code, u.name AS unit_name,
            g.first_name, g.last_name
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
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

  let breakfast = null;
  if (rule?.includes_breakfast) {
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
    description: chargeName(l.kind, locale),
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
