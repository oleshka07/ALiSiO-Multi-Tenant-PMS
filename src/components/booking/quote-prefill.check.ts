/**
 * Ціна номера показується ДО збереження броні.
 *
 *   node src/components/booking/quote-prefill.check.ts
 *
 * Помилка, яку це тримає: форма створення броні мала поле «Вартість» із
 * підказкою «авто з прайсингу», а запит `POST /api/pricing/quote` робила
 * лише у `handleSubmit`. Портьє обирав тип номера і кількість гостей, поле
 * лишалось порожнім — і назвати гостю вартість номера він не міг. Прайсинг
 * при цьому відповідав правильно (німецький готель, DZ на 2 осіб, 100 EUR за
 * ніч): запиту просто не було.
 *
 * Друга половина — інваріант 17: квота, яка не покриває всі ночі, НЕ
 * підставляє часткову суму. Часткове число в полі «Вартість» виглядає як
 * повна вартість, і бронь поїхала б за ціною, якої готель ніколи не називав.
 */
import assert from 'node:assert';
import { shouldAskQuote, readQuote, nightsBetween } from './quote-prefill.ts';

const BASE = {
  mode: 'create' as const,
  priceTouched: false,
  unitTypeId: 'ut_dz',
  checkIn: '2026-09-10',
  checkOut: '2026-09-12',
};

// ─── Коли форма питає ціну ──────────────────────────────────────────────────

assert.strictEqual(shouldAskQuote(BASE), true,
  'обрано тип номера і дати — форма мусить спитати ціну, а не чекати на «Створити»');

assert.strictEqual(shouldAskQuote({ ...BASE, mode: 'edit' }), false,
  'редагування наявної броні не перепитує ціну: там сума вже узгоджена з гостем');

assert.strictEqual(shouldAskQuote({ ...BASE, priceTouched: true }), false,
  'оператор увів суму руками — його число не можна затирати автоматичним');

assert.strictEqual(shouldAskQuote({ ...BASE, unitTypeId: '' }), false,
  'без типу номера питати нічого');

assert.strictEqual(shouldAskQuote({ ...BASE, checkOut: '' }), false,
  'без дати виїзду питати нічого');

assert.strictEqual(shouldAskQuote({ ...BASE, checkOut: '2026-09-10' }), false,
  'нуль ночей — це не проживання');

// ─── Що робиться з відповіддю ───────────────────────────────────────────────

assert.deepStrictEqual(
  readQuote({ ok: true, body: { total: 245, missingDays: 0, hasPricing: true, currency: 'EUR' } }),
  { price: '245', missingDays: 0, reason: 'priced', cityTax: 0 },
  'повністю оцінена квота лягає в поле «Вартість»');

assert.deepStrictEqual(
  readQuote({ ok: true, body: { total: 100, missingDays: 1, hasPricing: true, currency: 'EUR' } }),
  { price: '', missingDays: 1, reason: 'missing', cityTax: 0 },
  'ніч без ціни не стає частковою сумою в полі — інваріант 17');

assert.deepStrictEqual(
  readQuote({ ok: true, body: { total: 0, missingDays: 2, hasPricing: false, currency: 'EUR' } }),
  { price: '', missingDays: 2, reason: 'missing', cityTax: 0 },
  'жодної оціненої ночі — поле лишається порожнім і причина названа');

assert.deepStrictEqual(
  readQuote({ ok: false }),
  { price: '', missingDays: 0, reason: 'failed', cityTax: 0 },
  'прайсинг не відповів — це «не дізнались», а не «ціна нуль»');

assert.deepStrictEqual(
  readQuote({ ok: true, body: { total: 0, hasPricing: true } }),
  { price: '', missingDays: 0, reason: 'failed', cityTax: 0 },
  'нуль без пояснення в поле не пишеться: нуль — це безкоштовна бронь');

// ─── Валюта: невідома не вважається збігом ──────────────────────────────────
//
// Модалка броні мала власну копію цих правил, і вона казала протилежне:
//
//     const currencyOk = !q?.currency || !b.currency || q.currency === b.currency;
//
// тобто квота БЕЗ валюти проходила як «валюта та сама». А відсутня валюта —
// рівно той випадок, коли вірити числу не можна: німецький готель дістав би в
// бронь суму, порахувану в кронах, і побачив би це аж у рахунку.
assert.deepStrictEqual(
  readQuote({ ok: true, body: { total: 400, hasPricing: true, currency: 'EUR' } }, 'EUR'),
  { price: '400', missingDays: 0, reason: 'priced', cityTax: 0 },
  'та сама валюта — квоті можна вірити');
assert.strictEqual(
  readQuote({ ok: true, body: { total: 400, hasPricing: true, currency: 'CZK' } }, 'EUR').reason,
  'failed', 'інша валюта — числу вірити не можна');
assert.strictEqual(
  readQuote({ ok: true, body: { total: 400, hasPricing: true } }, 'EUR').reason,
  'failed', 'квота БЕЗ валюти проти броні в EUR — не збіг, а невідомість');
assert.strictEqual(
  readQuote({ ok: true, body: { total: 400, hasPricing: true } }).reason,
  'priced', 'без очікуваної валюти перевірки немає — це форма створення');
console.log('  ok  невідома валюта не вважається збігом');

// ─── Ночі ───────────────────────────────────────────────────────────────────

assert.strictEqual(nightsBetween('2026-09-10', '2026-09-12'), 2);
assert.strictEqual(nightsBetween('2026-09-12', '2026-09-10'), 0);
assert.strictEqual(nightsBetween('', '2026-09-12'), 0);

// Літній перехід: у зоні на схід/захід від UTC різниця дат не мусить
// «з'їдати» ніч. Рахуємо в UTC саме тому.
assert.strictEqual(nightsBetween('2026-03-28', '2026-03-30'), 2,
  'перехід на літній час не міняє кількість ночей');

// ─── Сторож гонки стоїть ПЕРЕД виходом із ефекту ────────────────────────────
//
// Це не арифметика, а порядок рядків, тож перевіряється текстом.
//
// Було: `quoteSeq` збільшувався ПІСЛЯ `if (!shouldAskQuote(...)) return`. Коли
// умови переставали дозволяти запит — портьє стер дату виїзду, змінив тип
// номера, — ефект виходив, не чіпаючи лічильник. Запит, який на той момент
// летів за старі дати, повертався, бачив свій номер актуальним і дописував
// ціну ТИХ дат у поле, що вже показує інші. Сторож існував і саме в цьому
// випадку не спрацьовував.
//
// Друга половина — submit: поки квота летить, поле «Вартість» ще порожнє, і
// збереження в цю мить створювало бронь за нуль.
{
  const fs = await import('node:fs');
  const src = fs.readFileSync('src/components/booking/BookingForm.tsx', 'utf8');
  const code = src.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');

  const bump = code.indexOf('++quoteSeq.current');
  const guard = code.indexOf('shouldAskQuote(');
  assert.ok(bump > 0 && guard > 0, 'не знайшов ефект квоти — гейт дивиться не туди');
  assert.ok(bump < guard,
    'quoteSeq мусить збільшуватись ДО виходу з ефекту: інакше відповідь на '
    + 'застарілі дати долітає й дописує ціну в поле, яке показує інші');

  const submit = code.slice(code.indexOf('const handleSubmit'));
  const body = submit.slice(0, submit.indexOf('const v = validate()'));
  assert.ok(/quoteState\.loading/.test(body),
    'handleSubmit мусить відмовляти, поки квота летить — інакше бронь їде за нуль');
  console.log('  ok  сторож гонки перед виходом, submit чекає на квоту');
}


// ─── Турзбір із квоти ───────────────────────────────────────────────────────
//
// Збір «для громади» сидить УСЕРЕДИНІ `total`, як і решта зборів: гість
// платить його разом із проживанням. Але на рахунку він мусить стати окремим
// рядком без ПДВ, і бере його `postStayCharges` із `reservations.city_tax_amount`.
//
// Якщо форма це поле не заповнить, збір поїде в рядок ПРОЖИВАННЯ під його
// ставкою — 7 % у Німеччині на гроші, які не є виручкою готелю. Рівно та
// помилка, яку вже виправлено на іншому шляху (stay-charges.city-tax.check.ts).

const withLevy = (fees: unknown[]) => readQuote({
  ok: true,
  body: { total: 345, missingDays: 0, hasPricing: true, currency: 'EUR', feeBreakdown: fees as never },
});

assert.strictEqual(
  withLevy([
    { name: 'Прибирання', amount: 35, collectedFor: 'property' },
    { name: 'Kurtaxe', amount: 10, collectedFor: 'authority' },
  ]).cityTax,
  10, 'збір для громади дістається з розбивки, збір готелю — ні');

assert.strictEqual(
  withLevy([{ name: 'Прибирання', amount: 35, collectedFor: 'property' }]).cityTax,
  0, 'готель без турзбору — нуль, а не «щось із розбивки»');

assert.strictEqual(withLevy([]).cityTax, 0, 'порожня розбивка — нуль');
assert.strictEqual(
  readQuote({ ok: true, body: { total: 345, missingDays: 0, hasPricing: true, currency: 'EUR' } }).cityTax,
  0, 'квота без поля feeBreakdown (старий сервер) не валить форму');

// Два збори для громади складаються, і сума заокруглена: рядки заокруглені
// кожен, але їхня сума в double дає хвіст, а це число їде в базу як гроші.
assert.strictEqual(
  withLevy([
    { name: 'A', amount: 0.1, collectedFor: 'authority' },
    { name: 'B', amount: 0.2, collectedFor: 'authority' },
  ]).cityTax,
  0.3, 'сума зборів громади не має тягнути хвіст double');

// Немає ціни — немає й збору. Часткова сума не підставляється (інваріант 17),
// а збір без ціни був би числом без підстави.
assert.strictEqual(
  readQuote({
    ok: true,
    body: { total: 345, missingDays: 1, hasPricing: true, currency: 'EUR',
      feeBreakdown: [{ name: 'Kurtaxe', amount: 10, collectedFor: 'authority' }] },
  }).cityTax,
  0, 'ніч без ціни — і збору теж немає');
assert.strictEqual(
  readQuote({ ok: false }).cityTax, 0, 'квота не приїхала — збору немає');

// Сміття з мережі не стає грошима.
assert.strictEqual(
  withLevy([{ name: 'Дивне', amount: 'багато', collectedFor: 'authority' }]).cityTax, 0);
assert.strictEqual(
  withLevy([{ name: 'Мінус', amount: -5, collectedFor: 'authority' }]).cityTax, 0,
  'відʼємний збір не стає відʼємним турзбором на броні');

// Турзбір, який готель поклав У ЦІНУ ночі, їде окремим списком `includedFees`
// — але це все одно турзбір, і на документі він мусить стояти окремим рядком
// без ПДВ. Гість не платить його зверху, проте `total` містить його однаково.
assert.strictEqual(
  readQuote({
    ok: true,
    body: {
      total: 345, missingDays: 0, hasPricing: true, currency: 'EUR',
      feeBreakdown: [{ name: 'Прибирання', amount: 35, collectedFor: 'property' }],
      includedFees: [{ name: 'Kurtaxe', amount: 10, collectedFor: 'authority' }],
    },
  }).cityTax,
  10, 'збір громади, вже включений у ціну ночі, теж мусить доїхати до броні');

// Обидва списки разом — і жодного подвоєння: це РІЗНІ рядки, не той самий.
assert.strictEqual(
  readQuote({
    ok: true,
    body: {
      total: 345, missingDays: 0, hasPricing: true, currency: 'EUR',
      feeBreakdown: [{ name: 'Kurtaxe', amount: 10, collectedFor: 'authority' }],
      includedFees: [{ name: 'Ortstaxe', amount: 5, collectedFor: 'authority' }],
    },
  }).cityTax,
  15, 'два різні збори громади складаються');

console.log('  ok  турзбір із квоти доходить до поля броні, і лише він');

console.log('quote-prefill.check.ts OK');
