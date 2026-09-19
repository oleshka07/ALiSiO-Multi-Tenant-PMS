/**
 * Рядок 11: збір іде в чек ПОЗА базою ПДВ (Т9).
 *
 *   node src/modules/fiscal-ua/domain/prro-receipt.check.ts
 *
 * ── Що саме стверджується, і чому фікстура саме така ────────────────────
 *
 * Твердження про ВІСЬ: рішення «поза базою» ухвалюється за РОДОМ рядка
 * (`kind = 'city_tax'`), а не за нульовою ставкою. Тому у фікстурі є обидва
 * значення осі — рядок зі ставкою 0, який у базі ЛИШАЄТЬСЯ (звільнена
 * послуга), і збір зі ставкою 0, який з бази ВИХОДИТЬ (інваріант 26).
 *
 * Числа несумісні з альтернативним прочитанням, і це головне:
 *
 *   за родом (правильно):   база 1240, поза базою  60, разом 1300
 *   за ставкою (помилка):   база 1200, поза базою 100, разом 1300
 *
 * Сума чека однакова в обох прочитаннях — саме тому перевірка суми нічого
 * не доводить, і саме тому тут перевіряються ОБИДВА доданки окремо. Гейт,
 * який дивився б лише на `total`, був би зелений на обох.
 *
 * ── Доведено червоним ───────────────────────────────────────────────────
 *
 * Мутація: `OUTSIDE_VAT_BASE` у `prro-receipt.ts` спорожнюється (збір
 * перестає виходити з бази). Код лишається робочим — чек будується, сума
 * та сама, — а сцена червона на трьох твердженнях. Друга мутація: рішення
 * за `vat_rate === 0` замість роду — теж червона, і це та сама вісь із
 * іншого боку.
 */
import assert from 'node:assert';

const { buildPrroReceipt, PrroReceiptRefusal } = await import('./prro-receipt.ts');

// ── Фікстура: чотири рядки, три ставки, два способи оплати ──────────────
const items = [
  { kind: 'lodging', description: 'Проживання', quantity: 2, unit_price_gross: 500, total_gross: 1000, vat_rate: 20 },
  { kind: 'service', description: 'Сніданок', quantity: 2, unit_price_gross: 100, total_gross: 200, vat_rate: 7 },
  // Звільнена від ПДВ послуга: ставка НУЛЬ, але в базі лишається.
  { kind: 'service', description: 'Страхування', quantity: 1, unit_price_gross: 40, total_gross: 40, vat_rate: 0 },
  // Збір: та сама ставка нуль — і з бази ВИХОДИТЬ. Це і є вісь.
  { kind: 'city_tax', description: 'Туристичний збір', quantity: 2, unit_price_gross: 30, total_gross: 60, vat_rate: 0 },
];
const payments = [
  { method: 'cash', amount: 800 },
  { method: 'card_terminal', amount: 500 },
];

const receipt = buildPrroReceipt({ items, payments, currency: 'UAH' });

assert.strictEqual(receipt.total, 1300, 'сума чека — усі рядки разом');

// ── Твердження 1: збір НЕ в базі ПДВ ───────────────────────────────────
const base = receipt.vatAmounts.reduce((s, v) => s + v.amount, 0);
assert.strictEqual(base, 1240,
  'база ПДВ = 1240 (1000 + 200 + 40). 1200 означало б, що з бази вийшла й звільнена послуга; 1300 — що збір у базі');
assert.strictEqual(receipt.outsideVatBase, 60,
  'поза базою рівно збір. 100 означало б рішення за ставкою, 0 — що збір потрапив у базу');
assert.strictEqual(base + receipt.outsideVatBase, receipt.total,
  'сума чека мусить сходитись із ДВОХ доданків, інакше одне з чисел вигадане');

// ── Твердження 2: ставка нуль сама по собі з бази не виводить ──────────
const zero = receipt.vatAmounts.find((v) => v.rate === 0);
assert.ok(zero, 'звільнена послуга мусить лишити в базі кошик зі ставкою 0');
assert.strictEqual(zero.amount, 40, 'у кошику 0 % — лише звільнена послуга, без збору');
assert.strictEqual(receipt.vatAmounts.length, 3, 'три кошики: 0, 7, 20 — збір жодного не утворює');
assert.deepStrictEqual(receipt.vatAmounts.map((v) => v.rate), [0, 7, 20],
  'кошики впорядковані за ставкою — чек читає людина');

// ── Твердження 3: рядок збору названий у чеку і несе `null`, не 0 ──────
const levy = receipt.lines.find((l) => l.name === 'Туристичний збір');
assert.ok(levy, 'збір мусить лишитись РЯДКОМ чека, а не зникнути з нього');
assert.strictEqual(levy.vatRate, null,
  '«поза базою» позначається null. Нуль тут означав би ставку, тобто рядок у базі');
assert.strictEqual(levy.totalGross, 60);
const insured = receipt.lines.find((l) => l.name === 'Страхування');
assert.strictEqual(insured?.vatRate, 0, 'звільнена послуга несе саме ставку 0, не null');
console.log('  ok  рядок 11: збір поза базою ПДВ за РОДОМ, ставка 0 сама з бази не виводить');

// ── Твердження 4: способи оплати ───────────────────────────────────────
assert.deepStrictEqual(receipt.payments.map((p) => [p.method, p.amount]),
  [['cash', 800], ['card_terminal', 500]], 'обидва касові способи доходять до чека');
assert.throws(() => buildPrroReceipt({
  items, payments: [{ method: 'transfer', amount: 1300 }], currency: 'UAH',
}), PrroReceiptRefusal, 'переказ не касовий оборот — названа відмова, не мовчазний пропуск');
assert.throws(() => buildPrroReceipt({
  items, payments: [{ method: 'voucher', amount: 1300 }], currency: 'UAH',
}), /not a till movement/, 'ваучер так само');
console.log('  ok  готівка й термінал доходять до чека, переказ і ваучер — названа відмова');

// ── Твердження 5: часткова оплата не вигадується ───────────────────────
//
// Інваріант 17 у своєму роді: числа, якого ніхто не називав, у реєстр не
// їде. Чек на завдаток — питання юрисдикції, і воно стоїть у чекпоінті.
assert.throws(() => buildPrroReceipt({
  items, payments: [{ method: 'cash', amount: 800 }], currency: 'UAH',
}), /do not agree/, 'сума платежів менша за суму рядків — відмова, а не чек на 800');
assert.throws(() => buildPrroReceipt({
  items, payments: [], currency: 'UAH',
}), /at least one till payment/, 'чек без оплати — не чек');
assert.throws(() => buildPrroReceipt({
  items: [], payments, currency: 'UAH',
}), /at least one charge/, 'порожнє фоліо реєструвати нічим');
console.log('  ok  часткова оплата, порожній чек і порожнє фоліо — названі відмови');

// ── Твердження 6: округлення йде через money() ─────────────────────────
//
// 1.005 через `* 100 / 100` дає 1.00, а не 1.01: це число підписує каса.
const rounded = buildPrroReceipt({
  items: [{ kind: 'service', description: 'Дрібниця', quantity: 1, unit_price_gross: 1.005, total_gross: 1.005, vat_rate: 20 }],
  payments: [{ method: 'cash', amount: 1.01 }],
  currency: 'UAH',
});
assert.strictEqual(rounded.total, 1.01, 'сума округлюється money(), а не множенням на 100');

console.log('чек із фоліо: збір поза базою ПДВ, каса бере лише касові способи');
