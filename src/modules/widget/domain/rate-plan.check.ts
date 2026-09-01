/**
 * Ціна, яку показали, і ціна, яку списали, — одне число.
 *
 *   node src/modules/widget/domain/rate-plan.check.ts
 *
 * Тариф міняв ціну лише в пошуку: гість бачив «−20 %», бронював за базовою.
 * Нижче — правило, яким тепер користуються обидва хендлери, і копійка, через
 * яку вони розходились би, якби кожен рахував сам.
 */
import assert from 'node:assert';
import { ratePlanNightPrice } from './rate-plan.ts';

// ─── Точка збуту НЕ називає власної ціни (рішення Ц7) ───────────────────────
//
// Тариф сайту вміє одне: ЗСУНУТИ базу відсотком. Назвати власне число він не
// може, і раніше нібито міг: гілка питала поле в обʼєкта із `site_rate_plans`,
// де такої колонки немає. Мертва в трьох місцях — пошук, календар, бронювання.
//
// Тепер це не «прибрати непрацююче», а контракт: база одна, точка збуту лише
// множить (Ц7). Тому перевіряємо саме те, чого більше не має статися —
// значення, яке видає себе за ціну, ігнорується як ціна.
//
// Ключ у ЛАПКАХ навмисно: голий `fixed_price` означає колонку, і саме його
// шукає `check-price-source.mjs`. Так контракт не потребує винятку в гейті —
// рівно як шов композиції в Р10.
assert.strictEqual(
  ratePlanNightPrice(2500, { 'fixed_price': 1800 } as never), 2500,
  'тариф сайту назвав власну ціну — жодна точка збуту цього не робить (Ц7)');
assert.strictEqual(
  ratePlanNightPrice(2500, { 'fixed_price': 1800, pricing_mode: 'dependent', pricing_modifier_percent: 20 } as never),
  2000,
  'модифікатор програв неіснуючій фіксованій ціні — зсув має лишатися єдиним, що вміє точка збуту');
console.log('  ok  точка збуту зсуває базу і не називає власного числа');

// ── Без тарифу нічого не змінюється ──────────────────────────────────
assert.strictEqual(ratePlanNightPrice(2500, null), 2500);
assert.strictEqual(ratePlanNightPrice(2500, undefined), 2500);
assert.strictEqual(ratePlanNightPrice(2500, {}), 2500, 'порожній тариф — це не тариф');
assert.strictEqual(
  ratePlanNightPrice(2500, { pricing_modifier_percent: 20 }), 2500,
  'відсоток без pricing_mode = dependent не діє — так само, як у пошуку',
);
console.log('  ok  без тарифу ціна ночі лишається базовою');

// ── Знижка і надбавка ────────────────────────────────────────────────
assert.strictEqual(
  ratePlanNightPrice(2500, { pricing_mode: 'dependent', pricing_modifier_percent: 20 }), 2000,
  '20 % за замовчуванням — це знижка: pricing_modifier_type порожній',
);
assert.strictEqual(
  ratePlanNightPrice(2500, { pricing_mode: 'dependent', pricing_modifier_percent: 20, pricing_modifier_type: 'less' }), 2000);
assert.strictEqual(
  ratePlanNightPrice(2500, { pricing_mode: 'dependent', pricing_modifier_percent: 20, pricing_modifier_type: 'more' }), 3000);

// Копійка. 20 % від 119 — це 95,20, і саме через такі числа два незалежні
// підрахунки розходяться на суму заїзду.
assert.strictEqual(
  ratePlanNightPrice(119, { pricing_mode: 'dependent', pricing_modifier_percent: 20 }), 95.2,
  'money() на кожну ніч, а не Math.round: інваріант 9',
);
const threeNights = [119, 119, 119]
  .map((p) => ratePlanNightPrice(p, { pricing_mode: 'dependent', pricing_modifier_percent: 20 }))
  .reduce((a, b) => a + b, 0);
assert.strictEqual(Math.round(threeNights * 100) / 100, 285.6, 'три ночі по 95,20 — це 285,60');
console.log('  ok  знижка й надбавка рахуються по ночах, із копійками');

// Розділ «фіксована ціна» прибрано разом із самою можливістю (Ц7). Його
// твердження перенесені нагору у зворотному вигляді: значення, яке видає себе
// за ціну, ігнорується як ціна.

console.log('rate-plan: точка збуту зсуває базу і не називає власного числа');
