/**
 * Price by occupancy, and the discount for staying longer.
 *
 *   node src/modules/pricing/domain/occupancy-price.check.ts
 *
 * The shape is the pilot's: two seasons, the same room sold to one person and
 * to two at different prices, and a length-of-stay tier that takes 10 € off a
 * double and 5 € off a single from the third night on.
 *
 * The prices below are placeholders with the pilot's STRUCTURE, not its rate
 * card — the real matrix goes in as data through the admin screen. What is
 * asserted is the arithmetic and the precedence rules, and those do not change
 * when the numbers do.
 */
import assert from 'node:assert';
import { quoteStay, addDays, type PriceRow, type LosTier } from './occupancy-price.ts';

const DZ = 'ut_dz';
const V = 'ut_vierbett';

// Standing prices, open-ended, plus a high season laid over them.
const MATRIX: PriceRow[] = [
  { unit_type_id: DZ, persons: 1, price_gross: 89 },
  { unit_type_id: DZ, persons: 2, price_gross: 119 },
  { unit_type_id: DZ, persons: 1, price_gross: 109, valid_from: '2026-07-01', valid_to: '2026-08-31' },
  { unit_type_id: DZ, persons: 2, price_gross: 149, valid_from: '2026-07-01', valid_to: '2026-08-31' },
  // One category, four prices — the Vierbettzimmer rule.
  { unit_type_id: V, persons: 1, price_gross: 99 },
  { unit_type_id: V, persons: 2, price_gross: 139 },
  { unit_type_id: V, persons: 3, price_gross: 169 },
  { unit_type_id: V, persons: 4, price_gross: 199 },
];

// "From 3 nights: −10 € on double occupancy, −5 € on single."
const TIERS: LosTier[] = [
  { min_nights: 3, adjustment_gross: -10, persons: 2 },
  { min_nights: 3, adjustment_gross: -5, persons: 1 },
];

// ─── The same room, two occupancies, two prices, one category ───────────────
const single = quoteStay({ checkIn: '2026-03-10', nights: 1, persons: 1, unitTypeId: DZ, matrix: MATRIX });
const double = quoteStay({ checkIn: '2026-03-10', nights: 1, persons: 2, unitTypeId: DZ, matrix: MATRIX });
assert.strictEqual(single.total, 89, 'one person in a double');
assert.strictEqual(double.total, 119, 'two people in the same double');
console.log('  ok  той самий номер: одна особа 89, двоє 119 — категорія одна');

// ─── A stay that crosses a season is priced night by night ──────────────────
//
// Three nights from 30 June: two of them are still low season, one is high.
// A single multiplication would charge one price for all three.
const crossing = quoteStay({ checkIn: '2026-06-29', nights: 3, persons: 2, unitTypeId: DZ, matrix: MATRIX });
assert.deepStrictEqual(
  crossing.nights.map((n) => [n.date, n.base]),
  [['2026-06-29', 119], ['2026-06-30', 119], ['2026-07-01', 149]],
  'each night is priced by its own date',
);
console.log('  ok  проживання через межу сезону рахується поніч: 119 · 119 · 149');

// ─── The narrower window wins, and the standing price is the fallback ───────
const inSeason = quoteStay({ checkIn: '2026-07-15', nights: 1, persons: 2, unitTypeId: DZ, matrix: MATRIX });
assert.strictEqual(inSeason.total, 149, 'the season row overrides the open-ended one');
const outOfSeason = quoteStay({ checkIn: '2026-09-15', nights: 1, persons: 2, unitTypeId: DZ, matrix: MATRIX });
assert.strictEqual(outOfSeason.total, 119, 'and outside it the standing price applies again');
console.log('  ok  вужче вікно перекриває базову ціну, поза ним вона повертається');

// ─── Length of stay ─────────────────────────────────────────────────────────
const twoNights = quoteStay({ checkIn: '2026-03-10', nights: 2, persons: 2, unitTypeId: DZ, matrix: MATRIX, losTiers: TIERS });
assert.strictEqual(twoNights.total, 238, 'two nights: no tier, 2 × 119');

const threeNights = quoteStay({ checkIn: '2026-03-10', nights: 3, persons: 2, unitTypeId: DZ, matrix: MATRIX, losTiers: TIERS });
assert.strictEqual(threeNights.total, 327, 'three nights: 3 × (119 − 10)');
assert.strictEqual(threeNights.nights[0].adjustment, -10, 'the discount is per night, and visible');
console.log('  ok  від третьої ночі −10 € за ніч: 327 замість 357');

// The single-occupancy tier is a different number, and it is picked by persons.
const threeSingle = quoteStay({ checkIn: '2026-03-10', nights: 3, persons: 1, unitTypeId: DZ, matrix: MATRIX, losTiers: TIERS });
assert.strictEqual(threeSingle.total, 252, 'three nights alone: 3 × (89 − 5)');
console.log('  ok  для однієї особи діє свій тир: −5 € за ніч');

// ─── Vierbett at every occupancy: one category, four prices ─────────────────
const vierbett = [1, 2, 3, 4].map((p) =>
  quoteStay({ checkIn: '2026-03-10', nights: 1, persons: p, unitTypeId: V, matrix: MATRIX }).total);
assert.deepStrictEqual(vierbett, [99, 139, 169, 199], 'four occupancies, four prices, one category');
console.log('  ok  Vierbett на 1/2/3/4 особи — чотири ціни, одна категорія');

// The acceptance case from the brief: Vierbett, three people, three nights.
const vierbettLos = quoteStay({
  checkIn: '2026-03-10', nights: 3, persons: 3, unitTypeId: V, matrix: MATRIX,
  losTiers: [...TIERS, { min_nights: 3, adjustment_gross: -12, persons: 3 }],
});
assert.strictEqual(vierbettLos.total, 471, 'Vierbett, three people, from three nights: 3 × (169 − 12)');
console.log('  ok  Vierbett на трьох від трьох ночей — саме той випадок із брифу');

// ─── The highest threshold reached wins ─────────────────────────────────────
const LADDER: LosTier[] = [
  { min_nights: 3, adjustment_gross: -10 },
  { min_nights: 7, adjustment_gross: -25 },
];
assert.strictEqual(
  quoteStay({ checkIn: '2026-03-10', nights: 7, persons: 2, unitTypeId: DZ, matrix: MATRIX, losTiers: LADDER }).nights[0].adjustment,
  -25, 'a week reaches the second tier, not the first',
);
assert.strictEqual(
  quoteStay({ checkIn: '2026-03-10', nights: 6, persons: 2, unitTypeId: DZ, matrix: MATRIX, losTiers: LADDER }).nights[0].adjustment,
  -10, 'six nights stay on the first',
);
console.log('  ok  діє найвищий досягнутий поріг, а не перший підхожий');

// ─── A missing price is reported, never invented ────────────────────────────
const five = quoteStay({ checkIn: '2026-03-10', nights: 1, persons: 5, unitTypeId: V, matrix: MATRIX });
assert.deepStrictEqual(five.nights, [], 'no price for five people');
assert.deepStrictEqual(five.missing, ['2026-03-10'], 'and the day is named');
assert.strictEqual(five.total, 0, 'the total is not a guess');
console.log('  ok  ціни немає — день названо, а не вигадано число');

// A partial gap is reported too: two nights priced, one missing, and the
// caller must not read the total as the price of the stay.
const gapMatrix: PriceRow[] = [
  { unit_type_id: DZ, persons: 2, price_gross: 119, valid_from: '2026-03-10', valid_to: '2026-03-11' },
];
const gap = quoteStay({ checkIn: '2026-03-10', nights: 3, persons: 2, unitTypeId: DZ, matrix: gapMatrix });
assert.strictEqual(gap.nights.length, 2, 'two nights had a price');
assert.deepStrictEqual(gap.missing, ['2026-03-12'], 'the third is named');
console.log('  ok  часткова прогалина теж називається, а не ховається в підсумку');

// ─── A discount may not exceed the price ────────────────────────────────────
const huge = quoteStay({
  checkIn: '2026-03-10', nights: 3, persons: 2, unitTypeId: DZ, matrix: MATRIX,
  losTiers: [{ min_nights: 3, adjustment_gross: -500 }],
});
assert.strictEqual(huge.total, 0, 'a night never costs less than nothing');
console.log('  ok  знижка не робить ніч відʼємною');

// ─── A house-wide row applies where no type-specific one exists ─────────────
const HOUSE: PriceRow[] = [
  { persons: 2, price_gross: 100 },
  { unit_type_id: DZ, persons: 2, price_gross: 119 },
];
assert.strictEqual(quoteStay({ checkIn: '2026-03-10', nights: 1, persons: 2, unitTypeId: DZ, matrix: HOUSE }).total, 119,
  'the specific type wins');
assert.strictEqual(quoteStay({ checkIn: '2026-03-10', nights: 1, persons: 2, unitTypeId: 'ut_other', matrix: HOUSE }).total, 100,
  'and everything else falls back to the house price');
console.log('  ok  ціна для типу перекриває загальнобудинкову, решта падає на неї');

// ─── Dates do not drift across a month, a year or a DST change ─────────────
assert.strictEqual(addDays('2026-02-28', 1), '2026-03-01', 'February in a non-leap year');
assert.strictEqual(addDays('2028-02-28', 1), '2028-02-29', 'and a leap year');
assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01', 'across the new year');
assert.strictEqual(addDays('2026-03-28', 2), '2026-03-30', 'across the European DST switch');
console.log('  ok  дати не зсуваються ні на межі місяця, ні на переводі годинника');

console.log('occupancy-price: заселеність міняє ціну, ніколи не категорію');
