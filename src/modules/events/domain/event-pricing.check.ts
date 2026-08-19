/**
 * The hall price ladder and the collision rule.
 *
 *   node src/modules/events/domain/event-pricing.check.ts
 *
 * Two behaviours here have a wrong-but-plausible twin. The ladder must walk
 * UP through blocks the hall offers — the pilot's Saal has no 2-hour price,
 * and "no price" must become the 4-hour suggestion, not 0 and not the price
 * of a block the duration overflows. And the overlap must be half-open:
 * 12:00–14:00 after 10:00–12:00 is the normal way two seminars share a
 * Tuesday, and `<=` instead of `<` would refuse every back-to-back pair.
 */
import assert from 'node:assert';
import { suggestedBlockPrice, timesOverlap, minutesBetween } from './event-pricing.ts';

// ── the pilot's own sheet ─────────────────────────────────────────────────────
const kleinerSaal = { h2: 49, h4: 79, h8: 119, h8plus: 149 };
assert.strictEqual(suggestedBlockPrice(kleinerSaal, 90), 49, '90 хв — блок «до 2 год»');
assert.strictEqual(suggestedBlockPrice(kleinerSaal, 120), 49, 'рівно 2 год — ще блок «до 2 год»');
assert.strictEqual(suggestedBlockPrice(kleinerSaal, 121), 79, '2 год 1 хв — уже «до 4 год»');
assert.strictEqual(suggestedBlockPrice(kleinerSaal, 480), 119, '8 год — «до 8 год»');
assert.strictEqual(suggestedBlockPrice(kleinerSaal, 600), 149, '10 год — «понад 8 год»');
console.log('  ok  драбина блоків: 2/4/8/8+ по тривалості');

// The Saal offers no 2-hour block: a short booking climbs to the first block
// that exists. Zero would be a price; climbing is a suggestion.
const saal = { h4: 190, h8: 290, h8plus: 390 };
assert.strictEqual(suggestedBlockPrice(saal, 90), 190, 'Saal без 2-год блоку: 90 хв → ціна 4 год');
const terrasse = {};
assert.strictEqual(suggestedBlockPrice(terrasse, 240), null, 'зала без цін → null, не 0');
assert.strictEqual(suggestedBlockPrice(kleinerSaal, 0), null, 'нульова тривалість → null');
assert.strictEqual(suggestedBlockPrice(kleinerSaal, NaN), null, 'NaN → null');
console.log('  ok  відсутній блок піднімається вгору, відсутні ціни — чесний null');

// ── half-open time ranges ─────────────────────────────────────────────────────
assert.strictEqual(timesOverlap('10:00', '12:00', '11:00', '13:00'), true, 'перетин — конфлікт');
assert.strictEqual(timesOverlap('10:00', '12:00', '12:00', '14:00'), false,
  'кінець одного = початок іншого: двері спільні, зала — ні');
assert.strictEqual(timesOverlap('12:00', '14:00', '10:00', '12:00'), false, 'і в зворотному порядку');
assert.strictEqual(timesOverlap('10:00', '14:00', '11:00', '12:00'), true, 'вкладений — конфлікт');
assert.strictEqual(timesOverlap('09:00', '10:00', '18:00', '20:00'), false, 'ранок і вечір не стрічаються');
console.log('  ok  [from, to): події впритул не конфліктують');

assert.strictEqual(minutesBetween('10:00', '12:30'), 150);
assert.ok(Number.isNaN(minutesBetween('10:00', 'abcd')), 'зламаний час → NaN, не тихе число');
console.log('  ok  хвилини рахуються, сміття — NaN');

console.log('ціна зали — підказка з драбини блоків, а колізія — питання півінтервалу');
