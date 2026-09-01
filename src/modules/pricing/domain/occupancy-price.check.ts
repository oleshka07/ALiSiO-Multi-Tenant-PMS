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
const single = quoteStay({ checkIn: '2026-03-10', nights: 1, adults: 1, unitTypeId: DZ, matrix: MATRIX });
const double = quoteStay({ checkIn: '2026-03-10', nights: 1, adults: 2, unitTypeId: DZ, matrix: MATRIX });
assert.strictEqual(single.total, 89, 'one person in a double');
assert.strictEqual(double.total, 119, 'two people in the same double');
console.log('  ok  той самий номер: одна особа 89, двоє 119 — категорія одна');

// ─── A stay that crosses a season is priced night by night ──────────────────
//
// Three nights from 30 June: two of them are still low season, one is high.
// A single multiplication would charge one price for all three.
const crossing = quoteStay({ checkIn: '2026-06-29', nights: 3, adults: 2, unitTypeId: DZ, matrix: MATRIX });
assert.deepStrictEqual(
  crossing.nights.map((n) => [n.date, n.base]),
  [['2026-06-29', 119], ['2026-06-30', 119], ['2026-07-01', 149]],
  'each night is priced by its own date',
);
console.log('  ok  проживання через межу сезону рахується поніч: 119 · 119 · 149');

// ─── The narrower window wins, and the standing price is the fallback ───────
const inSeason = quoteStay({ checkIn: '2026-07-15', nights: 1, adults: 2, unitTypeId: DZ, matrix: MATRIX });
assert.strictEqual(inSeason.total, 149, 'the season row overrides the open-ended one');
const outOfSeason = quoteStay({ checkIn: '2026-09-15', nights: 1, adults: 2, unitTypeId: DZ, matrix: MATRIX });
assert.strictEqual(outOfSeason.total, 119, 'and outside it the standing price applies again');
console.log('  ok  вужче вікно перекриває базову ціну, поза ним вона повертається');

// ─── A window open on one side is still a season, not a standing price ──────
//
// The pilot's rate card is written exactly this way: "until 31.12.2026" has no
// start, "from 01.03.2027" has no end. Both must beat the dateless row — and
// must do it whichever order the rows arrive in. When both answered "infinitely
// wide", the comparator called them equal and the winner was decided by the
// SQL row order: the same night came out 89 or 45.
const HALF_OPEN: PriceRow[] = [
  { unit_type_id: DZ, persons: 2, price_gross: 89, valid_to: '2026-12-31' },
  { unit_type_id: DZ, persons: 2, price_gross: 45 },
];
for (const [name, matrix] of [['season first', HALF_OPEN], ['dateless first', [...HALF_OPEN].reverse()]] as const) {
  assert.strictEqual(
    quoteStay({ checkIn: '2026-08-15', nights: 1, adults: 2, unitTypeId: DZ, matrix }).total,
    89, `a window with only an end beats the dateless row (${name})`,
  );
}
const FROM_ONLY: PriceRow[] = [
  { unit_type_id: DZ, persons: 2, price_gross: 45 },
  { unit_type_id: DZ, persons: 2, price_gross: 93, valid_from: '2027-03-01' },
];
assert.strictEqual(
  quoteStay({ checkIn: '2027-06-01', nights: 1, adults: 2, unitTypeId: DZ, matrix: FROM_ONLY }).total,
  93, 'and so does a window with only a start',
);
assert.strictEqual(
  quoteStay({ checkIn: '2027-01-15', nights: 1, adults: 2, unitTypeId: DZ, matrix: FROM_ONLY }).total,
  45, 'before it starts, the dateless row is what is left',
);
console.log('  ok  вікно, відкрите з одного боку, перекриває рядок без дат — за будь-якого порядку рядків');

// ─── Length of stay ─────────────────────────────────────────────────────────
const twoNights = quoteStay({ checkIn: '2026-03-10', nights: 2, adults: 2, unitTypeId: DZ, matrix: MATRIX, losTiers: TIERS });
assert.strictEqual(twoNights.total, 238, 'two nights: no tier, 2 × 119');

const threeNights = quoteStay({ checkIn: '2026-03-10', nights: 3, adults: 2, unitTypeId: DZ, matrix: MATRIX, losTiers: TIERS });
assert.strictEqual(threeNights.total, 327, 'three nights: 3 × (119 − 10)');
assert.strictEqual(threeNights.nights[0].adjustment, -10, 'the discount is per night, and visible');
console.log('  ok  від третьої ночі −10 € за ніч: 327 замість 357');

// The single-occupancy tier is a different number, and it is picked by persons.
const threeSingle = quoteStay({ checkIn: '2026-03-10', nights: 3, adults: 1, unitTypeId: DZ, matrix: MATRIX, losTiers: TIERS });
assert.strictEqual(threeSingle.total, 252, 'three nights alone: 3 × (89 − 5)');
console.log('  ok  для однієї особи діє свій тир: −5 € за ніч');

// ─── Vierbett at every occupancy: one category, four prices ─────────────────
const vierbett = [1, 2, 3, 4].map((p) =>
  quoteStay({ checkIn: '2026-03-10', nights: 1, adults: p, unitTypeId: V, matrix: MATRIX }).total);
assert.deepStrictEqual(vierbett, [99, 139, 169, 199], 'four occupancies, four prices, one category');
console.log('  ok  Vierbett на 1/2/3/4 особи — чотири ціни, одна категорія');

// The acceptance case from the brief: Vierbett, three people, three nights.
const vierbettLos = quoteStay({
  checkIn: '2026-03-10', nights: 3, adults: 3, unitTypeId: V, matrix: MATRIX,
  losTiers: [...TIERS, { min_nights: 3, adjustment_gross: -12, adults: 3 }],
});
assert.strictEqual(vierbettLos.total, 471, 'Vierbett, three people, from three nights: 3 × (169 − 12)');
console.log('  ok  Vierbett на трьох від трьох ночей — саме той випадок із брифу');

// ─── The highest threshold reached wins ─────────────────────────────────────
const LADDER: LosTier[] = [
  { min_nights: 3, adjustment_gross: -10 },
  { min_nights: 7, adjustment_gross: -25 },
];
assert.strictEqual(
  quoteStay({ checkIn: '2026-03-10', nights: 7, adults: 2, unitTypeId: DZ, matrix: MATRIX, losTiers: LADDER }).nights[0].adjustment,
  -25, 'a week reaches the second tier, not the first',
);
assert.strictEqual(
  quoteStay({ checkIn: '2026-03-10', nights: 6, adults: 2, unitTypeId: DZ, matrix: MATRIX, losTiers: LADDER }).nights[0].adjustment,
  -10, 'six nights stay on the first',
);
console.log('  ok  діє найвищий досягнутий поріг, а не перший підхожий');

// ─── A missing price is reported, never invented ────────────────────────────
const five = quoteStay({ checkIn: '2026-03-10', nights: 1, adults: 5, unitTypeId: V, matrix: MATRIX });
assert.deepStrictEqual(five.nights, [], 'no price for five people');
assert.deepStrictEqual(five.missing, ['2026-03-10'], 'and the day is named');
assert.strictEqual(five.total, 0, 'the total is not a guess');
console.log('  ok  ціни немає — день названо, а не вигадано число');

// A partial gap is reported too: two nights priced, one missing, and the
// caller must not read the total as the price of the stay.
const gapMatrix: PriceRow[] = [
  { unit_type_id: DZ, persons: 2, price_gross: 119, valid_from: '2026-03-10', valid_to: '2026-03-11' },
];
const gap = quoteStay({ checkIn: '2026-03-10', nights: 3, adults: 2, unitTypeId: DZ, matrix: gapMatrix });
assert.strictEqual(gap.nights.length, 2, 'two nights had a price');
assert.deepStrictEqual(gap.missing, ['2026-03-12'], 'the third is named');
console.log('  ok  часткова прогалина теж називається, а не ховається в підсумку');

// ─── A discount may not exceed the price ────────────────────────────────────
const huge = quoteStay({
  checkIn: '2026-03-10', nights: 3, adults: 2, unitTypeId: DZ, matrix: MATRIX,
  losTiers: [{ min_nights: 3, adjustment_gross: -500 }],
});
assert.strictEqual(huge.total, 0, 'a night never costs less than nothing');
console.log('  ok  знижка не робить ніч відʼємною');

// ─── A house-wide row applies where no type-specific one exists ─────────────
const HOUSE: PriceRow[] = [
  { persons: 2, price_gross: 100 },
  { unit_type_id: DZ, persons: 2, price_gross: 119 },
];
assert.strictEqual(quoteStay({ checkIn: '2026-03-10', nights: 1, adults: 2, unitTypeId: DZ, matrix: HOUSE }).total, 119,
  'the specific type wins');
assert.strictEqual(quoteStay({ checkIn: '2026-03-10', nights: 1, adults: 2, unitTypeId: 'ut_other', matrix: HOUSE }).total, 100,
  'and everything else falls back to the house price');
console.log('  ok  ціна для типу перекриває загальнобудинкову, решта падає на неї');

// ─── A category the discount must NOT reach ─────────────────────────────────
//
// The pilot has one: its Exklusivsuite is sold at one price and never
// discounted, while every other category takes −5 or −10 from the third night.
//
// There is no "except this one" here on purpose — a rule that lists exceptions
// grows an exception per hotel. The way to exclude a category is to write the
// tiers PER CATEGORY and leave that one out. This asserts both halves: the
// listed ones get it, the unlisted one gets nothing.
//
// The trap is the shortcut: one house-wide row instead of six looks equivalent
// and quietly discounts the suite too. Second assertion is that trap, spelled
// out, so nobody re-discovers it on an invoice.
const PER_CATEGORY: LosTier[] = [
  { unit_type_id: DZ, min_nights: 3, adjustment_gross: -10, persons: 2 },
  { unit_type_id: V, min_nights: 3, adjustment_gross: -10, persons: 2 },
];
const EXCLUSIVE = 'ut_exclusive';
const WITH_SUITE: PriceRow[] = [...MATRIX, { unit_type_id: EXCLUSIVE, persons: 2, price_gross: 159 }];

assert.strictEqual(
  quoteStay({ checkIn: '2026-03-10', nights: 3, adults: 2, unitTypeId: EXCLUSIVE, matrix: WITH_SUITE, losTiers: PER_CATEGORY }).total,
  477, 'the category with no tier of its own keeps its price: 3 × 159',
);
assert.strictEqual(
  quoteStay({ checkIn: '2026-03-10', nights: 3, adults: 2, unitTypeId: DZ, matrix: WITH_SUITE, losTiers: PER_CATEGORY }).total,
  327, 'and the ones that are listed still get it',
);
assert.strictEqual(
  quoteStay({
    checkIn: '2026-03-10', nights: 3, adults: 2, unitTypeId: EXCLUSIVE, matrix: WITH_SUITE,
    losTiers: [{ min_nights: 3, adjustment_gross: -10, adults: 2 }],
  }).total,
  447, 'one house-wide row instead of six DOES reach it — that is the trap',
);
console.log('  ok  категорія без свого тира знижки не отримує; загальнобудинковий рядок — отримує');

// ─── Dates do not drift across a month, a year or a DST change ─────────────
assert.strictEqual(addDays('2026-02-28', 1), '2026-03-01', 'February in a non-leap year');
assert.strictEqual(addDays('2028-02-28', 1), '2028-02-29', 'and a leap year');
assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01', 'across the new year');
assert.strictEqual(addDays('2026-03-28', 2), '2026-03-30', 'across the European DST switch');
console.log('  ok  дати не зсуваються ні на межі місяця, ні на переводі годинника');

// ─── Ц12: дитина не коштує як дорослий ────────────────────────────────────
//
// Крок «побачити червоним» (інваріант 24). Сімʼя — двоє дорослих і двоє
// дітей у чотиримісному номері. Сьогодні `persons` складає їх усіх, тож
// котирування бере рядок на ЧОТИРЬОХ ДОРОСЛИХ (199). Правильно — рядок на
// двох дорослих (139) плюс надбавка за кожну дитину.
const family = quoteStay({
  checkIn: '2026-03-10', nights: 1, adults: 2, children: 2, childExtraGross: 20,
  unitTypeId: V, matrix: MATRIX,
});
assert.strictEqual(family.total, 139 + 2 * 20,
  'сімʼя 2+2 має коштувати рядок на двох дорослих плюс дві дитячі надбавки');
// І та сама кімната на чотирьох ДОРОСЛИХ — це інше число й інший рядок.
assert.strictEqual(
  quoteStay({ checkIn: '2026-03-10', nights: 1, adults: 4, unitTypeId: V, matrix: MATRIX }).total,
  199, 'четверо дорослих беруть свій рядок матриці, а не дитячу надбавку');
console.log('  ok  дитина рахується надбавкою, а не як дорослий');

// ── Ціни, якої готель не називав, не існує — і для дітей теж ───────────────
//
// Найспокусливіше місце в усьому рішенні: `?? 0` тут виглядав би нешкідливо і
// означав би «діти безкоштовно» від імені готелю, який цього не казав. Той
// самий `?? 0` уже коштував цьому проєкту бронювання за нуль у
// `bulkUpdatePrices`. Нуль — теж ціна, але її називають.
const unstated = quoteStay({
  checkIn: '2026-03-10', nights: 2, adults: 2, children: 1,
  unitTypeId: V, matrix: MATRIX,
});
assert.strictEqual(unstated.total, 0, 'ніч із дітьми без названої ціни не має коштувати нічого');
assert.deepStrictEqual(unstated.missing, ['2026-03-10', '2026-03-11'],
  'дитина без ціни мусить давати missing, а не безкоштовну дитину');
const freeChildren = quoteStay({
  checkIn: '2026-03-10', nights: 1, adults: 2, children: 3, childExtraGross: 0,
  unitTypeId: V, matrix: MATRIX,
});
assert.strictEqual(freeChildren.total, 139, 'названий нуль — це «діти безкоштовно», і він працює');
assert.deepStrictEqual(freeChildren.missing, [], 'названий нуль не робить ніч непроданою');
console.log('  ok  неназвана ціна дитини = missing; названий нуль = безкоштовно');

// ── Знижка за тривалість дивиться на дорослих ─────────────────────────────
//
// Інакше «−10 € на двомісному від трьох ночей» переставало б діяти від того,
// що з батьками поїхала дитина — знижка зникала б рівно там, де сімʼя.
assert.strictEqual(
  quoteStay({
    checkIn: '2026-03-10', nights: 3, adults: 2, children: 1, childExtraGross: 10,
    unitTypeId: DZ, matrix: MATRIX, losTiers: TIERS,
  }).total,
  3 * (119 + 10 - 10), 'знижка за тривалість зникла через дитину');
console.log('  ok  знижка за тривалість тримається дорослих, а не голів');

console.log('occupancy-price: заселеність міняє ціну, ніколи не категорію');
