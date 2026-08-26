/**
 * Збори в квоті рахуються так, як написано на етикетці.
 *
 *   node src/modules/pricing/domain/fees.check.ts
 *
 * Ці числа портьє називає гостю вголос. Помилка тут не падає й не логується
 * — вона просто робить суму трохи іншою, і виявляється на виїзді, коли гість
 * уже почув ціну.
 *
 * Найдовше тут жила не арифметика, а порожня таблиця: `fees_taxes`
 * наповнював лише demo-seed, тож у кожного реального клієнта мито й
 * прибирання були нулем — і це мало вигляд «готель таких зборів не має».
 */
import assert from 'node:assert';
import { applyFees } from './fees.ts';

const ctx = { nights: 3, adults: 2, children: 1, accommodationTotal: 9000 };

// ── Пʼять типів, пʼять різних множників ──────────────────────────────
assert.deepStrictEqual(
  applyFees([{ name: 'Прибирання', type: 'per_stay', amount: 500 }], ctx),
  { feeBreakdown: [{ name: 'Прибирання', amount: 500 }], feesTotal: 500 },
  'per_stay не залежить ні від ночей, ні від гостей');

assert.strictEqual(
  applyFees([{ name: 'Паркінг', type: 'per_night', amount: 100 }], ctx).feesTotal,
  300, 'per_night — на кожну ніч, незалежно від кількості гостей');

assert.strictEqual(
  applyFees([{ name: 'Трансфер', type: 'per_person', amount: 200 }], ctx).feesTotal,
  600, 'per_person — на кожного гостя, дітей включно');

console.log('  ok  per_stay, per_night, per_person рахуються за своїми множниками');

// ── Те, заради чого цей файл написаний ───────────────────────────────
//
// Було `amount * adults * nights`, поруч із `per_person`, який рахував
// adults + children. Два поля з тим самим словом «person» рахували різні
// множини людей, і ніде не було сказано чому. Готель зі збором «Сніданок,
// за особу за ніч» недобирав на кожній дитині — і бачив це аж у звіті.
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'per_person_per_night', amount: 50 }], ctx).feesTotal,
  450, 'per_person_per_night мусить рахувати ВСІХ гостей: 50 × 3 особи × 3 ночі');
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'per_person_per_night', amount: 50 }],
    { ...ctx, children: 0 }).feesTotal,
  300, 'без дітей — те саме число, що й раніше');
console.log('  ok  «за особу за ніч» — це за КОЖНУ особу, як і «за особу»');

// ── Відсоток ─────────────────────────────────────────────────────────
//
// Від проживання, а не від проміжного підсумку: інакше порядок рядків у
// таблиці міняв би суму, і два готелі з однаковими правилами діставали б
// різні числа.
const mixed = applyFees([
  { name: 'Прибирання', type: 'per_stay', amount: 500 },
  { name: 'Сервісний збір', type: 'percentage', amount: 10 },
], ctx);
assert.strictEqual(mixed.feesTotal, 500 + 900,
  'відсоток рахується від проживання, а не від суми з попереднім збором');
assert.deepStrictEqual(mixed.feeBreakdown.map((f) => f.name), ['Прибирання', 'Сервісний збір']);
console.log('  ok  відсоток не залежить від порядку рядків');

// ── Що не потрапляє в розбивку ───────────────────────────────────────
assert.deepStrictEqual(
  applyFees([{ name: 'Порожній', type: 'per_stay', amount: 0 }], ctx),
  { feeBreakdown: [], feesTotal: 0 }, 'рядок «Прибирання 0» у квоті для гостя — шум');
assert.strictEqual(
  applyFees([{ name: 'Мінус', type: 'per_stay', amount: -100 }], ctx).feesTotal, 0,
  'відʼємний збір — це знижка, і вона живе не тут');
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'per_person_per_night', amount: 50 }],
    { ...ctx, nights: 0 }).feesTotal,
  0, 'нуль ночей — нуль зборів, а не збір за ніч, якої немає');
console.log('  ok  нуль, мінус і нуль ночей не створюють рядка');

// ── Тип, якого схема не знає ─────────────────────────────────────────
//
// Означає, що база змінилась, а цей файл — ні. Тихо додати нуль — значить
// недорахувати гроші й нічого про це не сказати.
const before = console.error;
let complained = '';
console.error = (m) => { complained = String(m); };
const unknown = applyFees([{ name: 'Дивний', type: 'per_fortnight', amount: 100 }], ctx);
console.error = before;
assert.strictEqual(unknown.feesTotal, 0);
assert.ok(complained.includes('per_fortnight'),
  'невідомий тип збору мусить лишити слід у логу, а не зникнути');
console.log('  ok  невідомий тип збору кричить, а не мовчить');

// ── Сміття з бази не валить квоту ────────────────────────────────────
assert.strictEqual(applyFees([], ctx).feesTotal, 0);
assert.strictEqual(applyFees(null as never, ctx).feesTotal, 0, 'порожня таблиця — не виняток');
assert.strictEqual(
  applyFees([{ name: 'NaN', type: 'per_stay', amount: 'не число' }], ctx).feesTotal, 0);
assert.strictEqual(
  applyFees([{ name: 'Рядок', type: 'per_night', amount: '100' }], ctx).feesTotal, 300,
  'NUMERIC із Postgres приїжджає рядком — це нормальне число, а не сміття');
console.log('  ok  рядкові NUMERIC рахуються, справжнє сміття — ні');

console.log('збори: етикетка збігається з арифметикою');
