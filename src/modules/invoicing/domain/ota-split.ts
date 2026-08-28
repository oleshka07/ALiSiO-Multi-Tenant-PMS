/**
 * One amount from a channel, split into the lines an invoice needs.
 *
 * Booking.com and its kin send a single figure: "91,05 € for this stay". A
 * German invoice cannot print that. It has to say how much was accommodation
 * (reduced rate), how much was breakfast food (reduced since 2026-01-01) and
 * how much was breakfast drinks (standard rate) — three lines, two rates, from
 * one number.
 *
 * Reception at the pilot does this by hand for every channel booking. It is
 * the single most repeated piece of arithmetic in their day and the one most
 * likely to be wrong, because the split depends on how many people slept there.
 *
 * Everything that varies is a parameter: what breakfast costs, how that price
 * divides between food and drink, and which rate each part carries. Those come
 * from the organization's settings. Nothing here knows a price or a percentage.
 *
 * The remainder rule: accommodation is the TOTAL MINUS the breakfast parts,
 * never computed independently. Whatever rounding does to the breakfast lines,
 * the three lines still add up to exactly what the channel sent — and a guest
 * who compares the invoice with the booking confirmation sees the same number.
 */
import { money } from '../../../core/money.ts';

export interface BreakfastSplit {
  /** Per person per night, gross. The food half. */
  foodPrice: number;
  /** Per person per night, gross. The drinks half. */
  drinksPrice: number;
  /** Percent carried by the food line. */
  foodVatRate: number;
  /** Percent carried by the drinks line. */
  drinksVatRate: number;
}

export interface SplitInput {
  /** What the channel sent, gross, for the whole stay. */
  totalGross: number;
  /** How many people the breakfast is charged for. */
  persons: number;
  /** How many nights the breakfast is charged for. */
  nights: number;
  /** Percent carried by the accommodation line. */
  lodgingVatRate: number;
  /** Absent when the rate does not include breakfast — then there is one line. */
  breakfast?: BreakfastSplit | null;
  /**
   * A discount granted by hand, in percent, on the ACCOMMODATION only.
   *
   * The pilot's owner asked for it in one sentence: «Es muss bitte möglich
   * sein, eine 10- bzw. 20%-Rabattierung auf den ÜN-Preis manuell eingeben zu
   * können» — for regulars, and for guests who book through a company that has
   * an entitlement but is not the company on the invoice.
   *
   * On the ÜN-Preis, and on nothing else. Breakfast is bought at its price
   * whoever the guest is; discounting it too would quietly move money between
   * two VAT rates, which on a German invoice is a different kind of mistake
   * than being generous.
   *
   * Applied after the breakfast is separated, so the remainder rule still
   * holds for the part that is not discounted.
   */
  lodgingDiscountPercent?: number | null;
}

export interface ChargeLine {
  kind: 'lodging' | 'breakfast_food' | 'breakfast_drinks';
  quantity: number;
  unitPriceGross: number;
  totalGross: number;
  vatRate: number;
  /**
   * What the accommodation cost before the discount, and by how much.
   *
   * Carried rather than recomputed: an invoice has to be able to say what was
   * reduced and from what. Absent when nothing was discounted, so a line that
   * says nothing about a discount is a line that had none.
   */
  discount?: { percent: number; grossBefore: number };
}

/**
 * Split, or explain why not.
 *
 * Returns null when the breakfast would cost more than the whole booking. That
 * is not a rounding problem, it is a wrong setting or a wrong booking, and
 * inventing a negative accommodation line to make the arithmetic close would
 * put a negative number on a guest's invoice. The caller posts the amount as a
 * single lodging line and leaves it for a human.
 */
/**
 * The accommodation after a manual reduction, and what it was before.
 *
 * Clamped to 0…100 rather than trusted. A negative percent is not a discount
 * but a surcharge, and a surcharge entered in a discount box is a typo that
 * would raise a guest's bill; above 100 the hotel would owe the guest money
 * for staying. Both are refused by clamping, not by throwing — the booking
 * still has to produce a bill.
 */
function discounted(lodging: number, percent: number | null | undefined) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  if (p === 0) return { gross: lodging, discount: undefined };
  const gross = money(lodging * (1 - p / 100));
  return { gross, discount: { percent: p, grossBefore: lodging } };
}

export function splitOtaAmount(input: SplitInput): ChargeLine[] | null {
  const total = money(input.totalGross);
  const { breakfast } = input;

  if (!breakfast || input.persons <= 0 || input.nights <= 0) {
    const one = discounted(total, input.lodgingDiscountPercent);
    return [{
      kind: 'lodging',
      quantity: 1,
      unitPriceGross: one.gross,
      totalGross: one.gross,
      vatRate: input.lodgingVatRate,
      ...(one.discount ? { discount: one.discount } : {}),
    }];
  }

  const units = input.persons * input.nights;
  const food = money(breakfast.foodPrice * units);
  const drinks = money(breakfast.drinksPrice * units);
  const lodging = money(total - food - drinks);

  // A booking whose breakfast eats the whole amount is a configuration
  // problem, not something to round away.
  if (lodging < 0) return null;

  // The discount lands on the remainder, after the breakfast is out. The
  // breakfast lines are untouched, which is the whole point of doing it here
  // and not on the total.
  const room = discounted(lodging, input.lodgingDiscountPercent);

  const lines: ChargeLine[] = [{
    kind: 'lodging',
    quantity: 1,
    unitPriceGross: room.gross,
    totalGross: room.gross,
    vatRate: input.lodgingVatRate,
    ...(room.discount ? { discount: room.discount } : {}),
  }];

  if (food > 0) {
    lines.push({
      kind: 'breakfast_food',
      quantity: units,
      unitPriceGross: money(breakfast.foodPrice),
      totalGross: food,
      vatRate: breakfast.foodVatRate,
    });
  }
  if (drinks > 0) {
    lines.push({
      kind: 'breakfast_drinks',
      quantity: units,
      unitPriceGross: money(breakfast.drinksPrice),
      totalGross: drinks,
      vatRate: breakfast.drinksVatRate,
    });
  }

  return lines;
}

/** What the split adds up to — must equal what the channel sent. */
export function linesGross(lines: readonly ChargeLine[]): number {
  return money(lines.reduce((sum, l) => sum + l.totalGross, 0));
}
