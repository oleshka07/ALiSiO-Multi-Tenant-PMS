/**
 * Splitting one channel amount into invoice lines.
 *
 *   node src/modules/finance/domain/ota-split.check.ts
 *
 * The headline case is the pilot's own acceptance criterion: a booking that
 * arrives as 91,05 € for one person must come out as 76,05 accommodation,
 * 12,00 breakfast food and 3,00 breakfast drinks. Reception does that sum by
 * hand today, for every channel booking.
 */
import assert from 'node:assert';
import { splitOtaAmount, linesGross } from './ota-split.ts';
import { taxGroups } from './invoice-vat.ts';

// The pilot's configuration: breakfast 15,00 = 12,00 food + 3,00 drinks;
// accommodation and food at the reduced rate, drinks at the standard one.
const DE = {
  lodgingVatRate: 7,
  breakfast: { foodPrice: 12, drinksPrice: 3, foodVatRate: 7, drinksVatRate: 19 },
};

// ─── The acceptance case ────────────────────────────────────────────────────
const one = splitOtaAmount({ totalGross: 91.05, persons: 1, nights: 1, ...DE })!;
assert.deepStrictEqual(
  one.map((l) => [l.kind, l.totalGross, l.vatRate]),
  [['lodging', 76.05, 7], ['breakfast_food', 12, 7], ['breakfast_drinks', 3, 19]],
  '91,05 for one person → 76,05 / 12,00 / 3,00',
);
assert.strictEqual(linesGross(one), 91.05, 'the lines must add up to what the channel sent');
console.log('  ok  91,05 на одну особу → 76,05 / 12,00 / 3,00');

// ─── Three people, one night: the reference invoice's own breakfast ─────────
const three = splitOtaAmount({ totalGross: 188.05, persons: 3, nights: 1, ...DE })!;
assert.deepStrictEqual(
  three.map((l) => [l.kind, l.quantity, l.totalGross]),
  [['lodging', 1, 143.05], ['breakfast_food', 3, 36], ['breakfast_drinks', 3, 9]],
  'three breakfasts, and the room is what is left',
);
assert.strictEqual(linesGross(three), 188.05, 'still adds up');
console.log('  ok  троє на ніч → 143,05 / 36,00 / 9,00 — рядки еталонної фактури');

// ─── Several nights: breakfast is charged per person PER NIGHT ─────────────
const twoNights = splitOtaAmount({ totalGross: 300, persons: 2, nights: 2, ...DE })!;
assert.strictEqual(twoNights.find((l) => l.kind === 'breakfast_food')!.quantity, 4, '2 × 2 = 4 breakfasts');
assert.strictEqual(twoNights.find((l) => l.kind === 'lodging')!.totalGross, 240, '300 − 48 − 12');
assert.strictEqual(linesGross(twoNights), 300, 'still adds up');
console.log('  ok  дві ночі × дві особи → чотири сніданки, решта — проживання');

// ─── Accommodation is the remainder, so the total never drifts ─────────────
//
// A price that does not divide evenly is where a computed-independently
// accommodation line would disagree with the booking confirmation by a cent.
const odd = splitOtaAmount({
  totalGross: 100.01, persons: 3, nights: 1,
  lodgingVatRate: 7,
  breakfast: { foodPrice: 8.33, drinksPrice: 2.77, foodVatRate: 7, drinksVatRate: 19 },
})!;
assert.strictEqual(linesGross(odd), 100.01, 'the sum equals the channel amount exactly');
assert.strictEqual(odd.find((l) => l.kind === 'lodging')!.totalGross, 66.71, '100,01 − 24,99 − 8,31');
console.log('  ok  ціна, що не ділиться рівно, не зсуває підсумок ні на цент');

// ─── A rate without breakfast is one line ──────────────────────────────────
const noBreakfast = splitOtaAmount({
  totalGross: 120, persons: 2, nights: 1, lodgingVatRate: 7, breakfast: null,
})!;
assert.strictEqual(noBreakfast.length, 1, 'one line');
assert.strictEqual(noBreakfast[0].totalGross, 120, 'the whole amount');
console.log('  ok  тариф без сніданку — один рядок');

// ─── Breakfast bigger than the booking is refused, not rounded away ────────
const impossible = splitOtaAmount({ totalGross: 10, persons: 3, nights: 1, ...DE });
assert.strictEqual(impossible, null, 'a negative accommodation line must never be produced');
console.log('  ok  сніданок, більший за всю броню, дає відмову, а не мінус на фактурі');

// ─── Nothing here knows a German number ────────────────────────────────────
//
// Czech configuration, same function: 12% accommodation, 21% drinks.
const cz = splitOtaAmount({
  totalGross: 3000, persons: 2, nights: 1,
  lodgingVatRate: 12,
  breakfast: { foodPrice: 200, drinksPrice: 50, foodVatRate: 12, drinksVatRate: 21 },
})!;
assert.deepStrictEqual(
  cz.map((l) => [l.totalGross, l.vatRate]),
  [[2500, 12], [400, 12], [100, 21]],
  'the same split with Czech rates and prices',
);
console.log('  ok  та сама функція з чеськими цінами і ставками');

// ─── The whole way through: channel amount → printed recapitulation ────────
//
// The three-person case above produces exactly the lines of invoice 22.421.
// Feeding them into the VAT grouping must give the numbers printed on that
// paper. This is the only assertion that covers the join between the two
// modules, and it is the join a guest actually sees.
const bar = { kind: 'lodging' as const, quantity: 1, unitPriceGross: 3.8, totalGross: 3.8, vatRate: 19 };
const recap = taxGroups([...three, bar].map((l) => ({ gross: l.totalGross, vatRate: l.vatRate })));
assert.deepStrictEqual(
  recap.map((g) => [g.vatRate, g.gross, g.net, g.tax]),
  [[19, 12.8, 10.76, 2.04], [7, 179.05, 167.34, 11.71]],
  'the split feeds the recapitulation printed on invoice 22.421',
);
console.log('  ok  від суми каналу до надрукованої рекапітуляції — ті самі цифри');

console.log('ota-split: одна сума каналу стає рядками, які сходяться до цента');
