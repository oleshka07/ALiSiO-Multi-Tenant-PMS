/**
 * Which rule applies to a booking that came from a channel.
 *
 * A hotel writes one row and it covers everything; a hotel whose arrangement
 * with Booking.com differs from its arrangement with Airbnb writes a row for
 * each. The rule with this channel's name wins over the one without, and
 * without either there is no rule at all — which means the amount is posted as
 * a single lodging line and nobody has guessed anything.
 *
 * Separate from ota-split.ts on purpose: that file does the arithmetic and
 * knows nothing about tables or channels; this one decides which numbers to
 * hand it.
 */
// Відносний шлях із розширенням: цей файл читає гейт, який запускають голим
// node, а `@core/…` знає лише бандлер.
import { money } from '../../../core/money.ts';

export interface ChannelRateRule {
  channel: string | null;
  includes_breakfast: boolean;
  breakfast_food_price: number;
  breakfast_drinks_price: number;
  lodging_tax_code: string;
  food_tax_code: string;
  drinks_tax_code: string;
  markup_percent: number;
}

/**
 * The rule for this channel, or null.
 *
 * Matching is case-insensitive because a channel arrives spelled by whoever
 * sent it — 'Booking.com', 'booking', 'BOOKING' are one channel to a hotel,
 * and a rule that missed because of a capital letter would silently drop the
 * breakfast split from an invoice.
 */
export function ruleFor(
  rules: readonly ChannelRateRule[],
  channel: string | null | undefined,
): ChannelRateRule | null {
  const wanted = normalize(channel);
  if (wanted) {
    const exact = rules.find((r) => normalize(r.channel) === wanted);
    if (exact) return exact;
  }
  return rules.find((r) => !r.channel) ?? null;
}

/**
 * What to charge this channel, given the rate card price.
 *
 * A hotel that sells at 119 direct and wants 130 on Booking.com writes 9.24 %
 * — or, far more often, says "plus 10 %" and reads the result off the screen.
 * The markup is applied to the gross and rounded to the cent, because that is
 * what will be pushed to the channel and later invoiced.
 */
export function withMarkup(priceGross: number, rule: ChannelRateRule | null): number {
  const percent = rule?.markup_percent ?? 0;
  if (!percent) return round(priceGross);
  return round(priceGross * (1 + percent / 100));
}

function normalize(v: string | null | undefined): string {
  return String(v ?? '').trim().toLowerCase();
}

function round(n: number): number {
  // money(), а не трюк із EPSILON: епсилон зсуває лише додатну похибку
  // і мовчки псує відʼємну. Один хелпер на весь продукт.
  return money(n);
}
