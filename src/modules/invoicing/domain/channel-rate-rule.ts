/**
 * Which rule applies to a booking that came from a channel.
 *
 * A hotel writes one row and it covers everything; a hotel whose arrangement
 * with Booking.com differs from its arrangement with Airbnb writes a row for
 * each. The rule with this channel's name wins over the one without, and
 * without either there is no rule at all — which means the amount is posted as
 * a single lodging line and nobody has guessed anything.
 *
 * ── І друга вісь: БУДИНОК (INC-029, 09.09.2026) ─────────────────────────
 *
 * `channel_rate_rules.property_id` нульовий, а UNIQUE на «рахунок × канал»
 * немає: два будинки одного готелю можуть мати кожен своє правило для
 * `booking.com`. Доти вибір робив `rules.find()`, тобто ПОРЯДОК РЯДКІВ —
 * рівно та вада, що INC-027, і в найдорожчому місці: правило вирішує ціну
 * сніданку і ПОДАТКОВІ КОДИ трьох рядків рахунку.
 *
 * Тому старшинство назване двома щаблями, конкретніше першим:
 *
 *   1. правило ЦЬОГО будинку з іменем цього каналу;
 *   2. правило рахунку (`property_id IS NULL`) з іменем цього каналу;
 *   3. правило ЦЬОГО будинку без каналу — загальне для будинку;
 *   4. правило рахунку без каналу.
 *
 * Це той самий порядок, яким цей модуль уже читає сніданок («three voices,
 * most specific first»), тож нового рішення тут немає — є те саме, застосоване
 * до осі, якої раніше не бачили.
 *
 * Separate from ota-split.ts on purpose: that file does the arithmetic and
 * knows nothing about tables or channels; this one decides which numbers to
 * hand it.
 */
// Відносний шлях із розширенням: цей файл читає гейт, який запускають голим
// node, а `@core/…` знає лише бандлер.
import { money } from '../../../core/money.ts';

export interface ChannelRateRule {
  /**
   * Будинок, якому належить правило, або `null` — «на весь рахунок».
   *
   * `channel_rate_rules.property_id` НУЛЬОВИЙ, і обидва стани законні: готель
   * з одним будинком пише одне правило й не думає про обʼєкти, готель із
   * двома може мати різні домовленості з тим самим каналом — різні ціни
   * сніданку і, що дорожче, різні ПОДАТКОВІ КОДИ.
   */
  property_id: string | null;
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
  // Чотири щаблі, конкретніше першим. `find` усередині кожного щабля лишається,
  // але тепер він обирає СЕРЕД РІВНИХ: два правила того самого будинку для того
  // самого каналу — це вже помилка налаштування, а не наша двозначність.
  const steps: ((r: ChannelRateRule) => boolean)[] = [];
  if (wanted) {
    steps.push((r) => !!r.property_id && normalize(r.channel) === wanted);
    steps.push((r) => !r.property_id && normalize(r.channel) === wanted);
  }
  steps.push((r) => !!r.property_id && !r.channel);
  steps.push((r) => !r.property_id && !r.channel);

  for (const step of steps) {
    const hit = rules.find(step);
    if (hit) return hit;
  }
  return null;
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
