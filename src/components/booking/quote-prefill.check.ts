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

// ─── Ночі ───────────────────────────────────────────────────────────────────

assert.strictEqual(nightsBetween('2026-09-10', '2026-09-12'), 2);
assert.strictEqual(nightsBetween('2026-09-12', '2026-09-10'), 0);
assert.strictEqual(nightsBetween('', '2026-09-12'), 0);

// Літній перехід: у зоні на схід/захід від UTC різниця дат не мусить
// «з'їдати» ніч. Рахуємо в UTC саме тому.
assert.strictEqual(nightsBetween('2026-03-28', '2026-03-30'), 2,
  'перехід на літній час не міняє кількість ночей');

console.log('quote-prefill.check.ts OK');
