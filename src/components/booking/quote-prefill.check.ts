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
  { price: '245', missingDays: 0, reason: 'priced' },
  'повністю оцінена квота лягає в поле «Вартість»');

assert.deepStrictEqual(
  readQuote({ ok: true, body: { total: 100, missingDays: 1, hasPricing: true, currency: 'EUR' } }),
  { price: '', missingDays: 1, reason: 'missing' },
  'ніч без ціни не стає частковою сумою в полі — інваріант 17');

assert.deepStrictEqual(
  readQuote({ ok: true, body: { total: 0, missingDays: 2, hasPricing: false, currency: 'EUR' } }),
  { price: '', missingDays: 2, reason: 'missing' },
  'жодної оціненої ночі — поле лишається порожнім і причина названа');

assert.deepStrictEqual(
  readQuote({ ok: false }),
  { price: '', missingDays: 0, reason: 'failed' },
  'прайсинг не відповів — це «не дізнались», а не «ціна нуль»');

assert.deepStrictEqual(
  readQuote({ ok: true, body: { total: 0, hasPricing: true } }),
  { price: '', missingDays: 0, reason: 'failed' },
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
  { price: '400', missingDays: 0, reason: 'priced' },
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

console.log('quote-prefill.check.ts OK');
