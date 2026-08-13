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
}

export interface ChargeLine {
  kind: 'lodging' | 'breakfast_food' | 'breakfast_drinks';
  quantity: number;
  unitPriceGross: number;
  totalGross: number;
  vatRate: number;
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
export function splitOtaAmount(input: SplitInput): ChargeLine[] | null {
  const total = money(input.totalGross);
  const { breakfast } = input;

  if (!breakfast || input.persons <= 0 || input.nights <= 0) {
    return [{
      kind: 'lodging',
      quantity: 1,
      unitPriceGross: total,
      totalGross: total,
      vatRate: input.lodgingVatRate,
    }];
  }

  const units = input.persons * input.nights;
  const food = money(breakfast.foodPrice * units);
  const drinks = money(breakfast.drinksPrice * units);
  const lodging = money(total - food - drinks);

  // A booking whose breakfast eats the whole amount is a configuration
  // problem, not something to round away.
  if (lodging < 0) return null;

  const lines: ChargeLine[] = [{
    kind: 'lodging',
    quantity: 1,
    unitPriceGross: lodging,
    totalGross: lodging,
    vatRate: input.lodgingVatRate,
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
