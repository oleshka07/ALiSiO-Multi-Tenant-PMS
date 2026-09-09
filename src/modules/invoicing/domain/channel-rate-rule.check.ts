/**
 * Picking the rule, and the markup.
 *
 *   node src/modules/invoicing/domain/channel-rate-rule.check.ts
 */
import assert from 'node:assert';
import { ruleFor, withMarkup, type ChannelRateRule } from './channel-rate-rule.ts';

const base = {
  property_id: null as string | null,
  includes_breakfast: true,
  breakfast_food_price: 12,
  breakfast_drinks_price: 3,
  lodging_tax_code: 'reduced',
  food_tax_code: 'reduced',
  drinks_tax_code: 'standard',
  markup_percent: 0,
};

const DEFAULT_RULE: ChannelRateRule = { ...base, channel: null };
const BOOKING: ChannelRateRule = { ...base, channel: 'booking', markup_percent: 15 };

// ─── The named channel beats the default ────────────────────────────────────
assert.strictEqual(ruleFor([DEFAULT_RULE, BOOKING], 'booking'), BOOKING, 'the exact channel wins');
assert.strictEqual(ruleFor([BOOKING, DEFAULT_RULE], 'booking'), BOOKING, 'and order does not decide it');
console.log('  ok  правило для каналу перекриває загальне, порядок рядків ні на що не впливає');

// ─── A channel with no rule of its own falls to the default ─────────────────
assert.strictEqual(ruleFor([DEFAULT_RULE, BOOKING], 'airbnb'), DEFAULT_RULE, 'the default covers the rest');
assert.strictEqual(ruleFor([DEFAULT_RULE], null), DEFAULT_RULE, 'and a booking with no channel at all');
console.log('  ok  канал без свого рядка потрапляє на загальний');

// ─── No rule is a real answer ───────────────────────────────────────────────
assert.strictEqual(ruleFor([BOOKING], 'airbnb'), null, 'no default, no rule');
assert.strictEqual(ruleFor([], 'booking'), null, 'no rules at all');
console.log('  ok  правила немає — це відповідь null, а не вигаданий рядок');

// ─── Spelling is not a business decision ────────────────────────────────────
for (const spelling of ['Booking', 'BOOKING', ' booking ']) {
  assert.strictEqual(ruleFor([DEFAULT_RULE, BOOKING], spelling), BOOKING, `"${spelling}" is the same channel`);
}
console.log('  ok  Booking / BOOKING / " booking " — один канал, а не три');

// ─── Вісь БУДИНКУ: конкретніше правило перекриває загальніше ───────────────
//
// `channel_rate_rules.property_id` нульовий, UNIQUE на «рахунок × канал» немає,
// тож два будинки одного готелю можуть мати кожен своє правило для
// `booking.com`. Доти вибір робив порядок рядків (INC-027), і вирішував він не
// список на екрані, а ціну сніданку і ПОДАТКОВІ КОДИ рядків рахунку.
//
// Осі тут дві й обидві мусять бути в фікстурі: канал (є/немає імені) і будинок
// (є/немає `property_id`). Тому чотири правила, а не два, і кожне зі СВОЇМ
// числом — інакше «взяв не те» не відрізнити від «взяв те».

const HOUSE = '__prop_a';
const HOUSE_BOOKING: ChannelRateRule = { ...base, property_id: HOUSE, channel: 'booking', markup_percent: 7 };
const HOUSE_ANY: ChannelRateRule = { ...base, property_id: HOUSE, channel: null, markup_percent: 3 };
const ORG_BOOKING: ChannelRateRule = { ...base, channel: 'booking', markup_percent: 21 };
const ORG_ANY: ChannelRateRule = { ...base, channel: null, markup_percent: 1 };

assert.strictEqual(new Set([7, 3, 21, 1]).size, 4,
  'чотири правила — чотири різні числа, інакше твердження нижче нічого не розрізняють');

// Порядок у списку навмисно ЗВОРОТНИЙ до старшинства: якби вибір робив `find`
// по порядку, кожне з чотирьох тверджень взяло б не те.
const ALL = [ORG_ANY, ORG_BOOKING, HOUSE_ANY, HOUSE_BOOKING];

assert.strictEqual(ruleFor(ALL, 'booking'), HOUSE_BOOKING,
  'правило БУДИНКУ для цього каналу — найконкретніше, воно й виграє');
assert.strictEqual(ruleFor([ORG_ANY, ORG_BOOKING, HOUSE_ANY], 'booking'), ORG_BOOKING,
  'немає правила будинку для каналу — виграє правило РАХУНКУ для того ж каналу');
assert.strictEqual(ruleFor([ORG_ANY, HOUSE_ANY], 'booking'), HOUSE_ANY,
  'немає нікого за каналом — виграє загальне правило БУДИНКУ, не рахунку');
assert.strictEqual(ruleFor([ORG_ANY], 'booking'), ORG_ANY,
  'лишилось тільки загальне правило рахунку — воно й відповідає');
console.log('  ok  старшинство: будинок×канал → рахунок×канал → будинок → рахунок');

// І зустрічна вісь: правило ЧУЖОГО будинку сюди не приходить взагалі — це
// робить запит (`propertyOrSharedFilter`), не ця функція. Твердження про це
// стоїть у `stay-charges`, а не тут: писати його на масиві означало б
// перевіряти власну фікстуру.

// ─── Markup ─────────────────────────────────────────────────────────────────
assert.strictEqual(withMarkup(119, BOOKING), 136.85, '119 + 15 %');
assert.strictEqual(withMarkup(119, DEFAULT_RULE), 119, 'no markup leaves the price alone');
assert.strictEqual(withMarkup(119, null), 119, 'and so does no rule');
console.log('  ok  націнка рахується від брутто і не чіпає ціну, коли її нема');

// A markup must not introduce a third decimal — the number is pushed to a
// channel and later printed on an invoice.
assert.strictEqual(withMarkup(89.9, { ...BOOKING, markup_percent: 7.5 }), 96.64, 'rounded to the cent');
console.log('  ok  націнка лишається сумою в центах, а не дробом');

console.log('channel-rate-rule: правило обирається за каналом, націнка — від брутто');
