/**
 * Picking the rule, and the markup.
 *
 *   node src/modules/invoicing/domain/channel-rate-rule.check.ts
 */
import assert from 'node:assert';
import { ruleFor, withMarkup, type ChannelRateRule } from './channel-rate-rule.ts';

const base = {
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
