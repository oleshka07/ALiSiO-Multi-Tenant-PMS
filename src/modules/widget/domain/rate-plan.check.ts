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
import { ratePlanNightPrice, ratePlanNamesItsOwnPrice } from './rate-plan.ts';

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

// ── Фіксована ціна ───────────────────────────────────────────────────
assert.strictEqual(ratePlanNightPrice(2500, { fixed_price: 1800 }), 1800);
assert.strictEqual(
  ratePlanNightPrice(2500, { fixed_price: 1800, pricing_mode: 'dependent', pricing_modifier_percent: 50 }), 1800,
  'заповнені обидва поля — це помилка оператора, а не команда застосувати обидва; виграє те, що названо прямо',
);
assert.strictEqual(ratePlanNightPrice(2500, { fixed_price: 0 }), 0,
  'нуль — це названа ціна, а не порожнє поле');
assert.strictEqual(ratePlanNightPrice(2500, { fixed_price: '' }), 2500,
  'порожнє поле форми приходить як рядок і не має ставати нулем');
console.log('  ok  фіксована ціна перекриває базову, а порожнє поле — ні');

// ── Чи тариф називає ціну сам ────────────────────────────────────────
assert.strictEqual(ratePlanNamesItsOwnPrice({ fixed_price: 1800 }), true);
assert.strictEqual(ratePlanNamesItsOwnPrice({ fixed_price: 0 }), true);
assert.strictEqual(ratePlanNamesItsOwnPrice({ fixed_price: null }), false);
assert.strictEqual(ratePlanNamesItsOwnPrice({ pricing_mode: 'dependent', pricing_modifier_percent: 20 }), false,
  'модифікатор рахують ВІД ціни календаря, тож без календаря він нічого не означає');
assert.strictEqual(ratePlanNamesItsOwnPrice(null), false);
console.log('  ok  видно, коли тариф є ціною, а коли лише надбавкою до неї');
