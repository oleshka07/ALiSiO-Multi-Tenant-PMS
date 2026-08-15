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
//
// 188,05 is the CHANNEL amount; 143,05 is the accommodation LINE that comes
// out of it. Worth stating because the two get confused: 143,05 is the number
// printed on the reference invoice, so it reads like the input, and a fixture
// written that way would assert a split of a figure that was already split.
const three = splitOtaAmount({ totalGross: 188.05, persons: 3, nights: 1, ...DE })!;
assert.deepStrictEqual(
  three.map((l) => [l.kind, l.quantity, l.totalGross]),
  [['lodging', 1, 143.05], ['breakfast_food', 3, 36], ['breakfast_drinks', 3, 9]],
  'three breakfasts, and the room is what is left',
);
assert.strictEqual(linesGross(three), 188.05, 'still adds up');
console.log('  ok  188,05 каналу → 143,05 / 36,00 / 9,00 — рядки еталонної фактури');

// ─── Two people, two nights: a real booking from the pilot's channel ────────
//
// The second acceptance case, and the one that catches a breakfast counted per
// STAY instead of per person per night: four person-nights, not two.
const stay = splitOtaAmount({ totalGross: 274.50, persons: 2, nights: 2, ...DE })!;
assert.deepStrictEqual(
  stay.map((l) => [l.kind, l.quantity, l.totalGross]),
  [['lodging', 1, 214.50], ['breakfast_food', 4, 48], ['breakfast_drinks', 4, 12]],
  '274,50 for two people over two nights → 214,50 / 48,00 / 12,00',
);
assert.strictEqual(linesGross(stay), 274.50, 'still adds up');

// And what the invoice groups it into: everything at 7% together, drinks alone.
const stayGroups = taxGroups(stay.map((l) => ({ gross: l.totalGross, vatRate: l.vatRate })));
assert.deepStrictEqual(
  stayGroups.map((g) => [g.vatRate, g.gross]),
  [[19, 12], [7, 262.50]],
  'the recapitulation the accountant sees — highest rate first, as on the paper',
);
console.log('  ok  274,50 на двох за дві ночі → 214,50 / 48,00 / 12,00, групи 262,50 і 12,00');

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

// ─── Ручна знижка на проживання (§ Rabattierung auf den ÜN-Preis) ───────────
//
// Власник пілота: «Es muss bitte möglich sein, eine 10- bzw. 20%-Rabattierung
// auf den ÜN-Preis manuell eingeben zu können». На ÜN-Preis — і більше ні на
// що. Сніданок гість купує за його ціною, хто б він не був.

{
  const withBreakfast = {
    totalGross: 188.05, persons: 1, nights: 1, lodgingVatRate: 7,
    breakfast: { foodPrice: 12, drinksPrice: 3, foodVatRate: 7, drinksVatRate: 19 },
  };

  const full = splitOtaAmount(withBreakfast)!;
  const room = full.find((l) => l.kind === 'lodging')!;
  assert.strictEqual(room.totalGross, 173.05, '188,05 − 12 − 3');
  assert.strictEqual(room.discount, undefined, 'без знижки рядок про неї мовчить');

  const ten = splitOtaAmount({ ...withBreakfast, lodgingDiscountPercent: 10 })!;
  const cheaper = ten.find((l) => l.kind === 'lodging')!;
  assert.strictEqual(cheaper.totalGross, 155.75, '173,05 − 10 % = 155,745 → 155,75');
  assert.deepStrictEqual(cheaper.discount, { percent: 10, grossBefore: 173.05 },
    'рядок несе, з чого і скільки зняли');

  // Сніданок незмінний — інакше знижка тихо переносила б гроші між ставками.
  for (const kind of ['breakfast_food', 'breakfast_drinks'] as const) {
    assert.strictEqual(
      ten.find((l) => l.kind === kind)!.totalGross,
      full.find((l) => l.kind === kind)!.totalGross,
      `${kind} знижка не чіпає`,
    );
  }
  console.log('  ok  знижка знімається лише з проживання, сніданок недоторканий');

  // Ставки лишаються ті самі: знижка міняє суму, а не природу послуги.
  assert.strictEqual(cheaper.vatRate, room.vatRate, 'ставка проживання не змінилась');
  console.log('  ok  знижка не міняє ставку ПДВ');
}

// Без сніданку — знижка лягає на весь рядок.
{
  const plain = splitOtaAmount({
    totalGross: 200, persons: 2, nights: 1, lodgingVatRate: 7, lodgingDiscountPercent: 20,
  })!;
  assert.strictEqual(plain.length, 1);
  assert.strictEqual(plain[0].totalGross, 160, '200 − 20 %');
  assert.strictEqual(plain[0].unitPriceGross, 160, 'ціна за одиницю теж зі знижкою');
  console.log('  ok  тариф без сніданку — знижка на весь рядок');
}

// Межі: помилка в полі не має ставати грошима.
{
  const at = (percent: number) => splitOtaAmount({
    totalGross: 100, persons: 1, nights: 1, lodgingVatRate: 7, lodgingDiscountPercent: percent,
  })![0].totalGross;

  assert.strictEqual(at(-10), 100, 'відʼємний відсоток — не націнка, а нуль');
  assert.strictEqual(at(0), 100, 'нуль лишає ціну');
  assert.strictEqual(at(100), 0, 'сто відсотків — безкоштовно, але не мінус');
  assert.strictEqual(at(150), 0, 'понад сто не робить готель боржником гостя');
  assert.strictEqual(at(NaN), 100, 'порожнє поле — це відсутня знижка');
  console.log('  ok  −10, 0, 100, 150 і NaN не породжують відʼємного рахунку');
}

// Копійки: 7 % від 33,33 не мають зникати ні в чий бік.
{
  const odd = splitOtaAmount({
    totalGross: 33.33, persons: 1, nights: 1, lodgingVatRate: 7, lodgingDiscountPercent: 10,
  })![0];
  assert.strictEqual(odd.totalGross, 30, '33,33 − 10 % = 29,997 → 30,00');
  assert.strictEqual(odd.totalGross, odd.unitPriceGross, 'сума і ціна за одиницю однакові');
  console.log('  ok  округлення до копійки, без розбіжності між ціною і сумою');
}
