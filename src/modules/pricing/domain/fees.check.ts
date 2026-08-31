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
  { feeBreakdown: [{ name: 'Прибирання', amount: 500, collectedFor: 'property' }], feesTotal: 500 },
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

// ── applies_to: звільнення СКАЗАНЕ, а не вгадане ─────────────────────
//
// Міграція 0050. До неї «діти не платять мито» жило в тому, що
// `per_person_per_night` мовчки рахував лише дорослих — і той самий трюк
// недобирав гроші готелю зі збором «Сніданок, за особу за ніч».
//
// ctx — 2 дорослих + 1 дитина, 3 ночі.
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'per_person_per_night', amount: 50, applies_to: 'adults' }], ctx).feesTotal,
  300, 'applies_to=adults — 50 × 2 дорослих × 3 ночі, дитина звільнена');
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'per_person_per_night', amount: 50, applies_to: 'all' }], ctx).feesTotal,
  450, 'applies_to=all — ті самі 50 × 3 особи × 3 ночі');
assert.strictEqual(
  applyFees([{ name: 'Трансфер', type: 'per_person', amount: 200, applies_to: 'adults' }], ctx).feesTotal,
  400, 'звільнення діє й на per_person, не лише на per_person_per_night');

// Рядок, старший за міграцію: поля немає взагалі. Дефолт мусить збігатися з
// тією арифметикою, яку цей рядок уже мав, інакше міграція тихо переоцінила
// б кожен наявний збір.
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'per_person_per_night', amount: 50 }], ctx).feesTotal,
  applyFees([{ name: 'Мито', type: 'per_person_per_night', amount: 50, applies_to: 'all' }], ctx).feesTotal,
  'відсутнє applies_to = all: рядок до 0050 рахується так само, як рахувався');
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'per_person_per_night', amount: 50, applies_to: null }], ctx).feesTotal,
  450, 'NULL із бази — теж all, а не привід пропустити збір');

// Для типів без «person» у назві поле ні на що не множиться. Це не помилка:
// «прибирання, лише з дорослих» — беззмістовне уточнення, а не зіпсовані дані.
assert.strictEqual(
  applyFees([{ name: 'Прибирання', type: 'per_stay', amount: 500, applies_to: 'adults' }], ctx).feesTotal,
  500, 'per_stay не залежить від того, кого рахувати');

// Бронь без дорослих — граничний, але реальний стан даних. Збір «лише з
// дорослих» тоді дорівнює нулю, а не всім гостям.
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'per_person', amount: 50, applies_to: 'adults' }],
    { ...ctx, adults: 0, children: 2 }).feesTotal,
  0, 'нуль дорослих — нуль «дорослого» збору, а не мовчазний відкат до всіх гостей');
console.log('  ok  applies_to звільняє дітей там, де це сказано, і ніде більше');

// ── collected_for: класифікація їде разом із сумою ───────────────────
//
// Ядро знає лише «виручка готелю» проти «збір для громади» і НЕ знає слова
// «турзбір». Українське «рядок 11 без ПДВ» і німецький durchlaufender Posten
// читає модуль юрисдикції (AGENTS.md, інваріант 22).
const classified = applyFees([
  { name: 'Прибирання', type: 'per_stay', amount: 500 },
  { name: 'Місцевий збір', type: 'per_person_per_night', amount: 50, collected_for: 'authority' },
], ctx);
assert.deepStrictEqual(
  classified.feeBreakdown.map((f) => [f.name, f.collectedFor]),
  [['Прибирання', 'property'], ['Місцевий збір', 'authority']],
  'класифікація мусить доїхати до розбивки — колонка, яку ніхто не читає, мертва');
assert.strictEqual(classified.feesTotal, 500 + 450,
  'на суму в квоті collected_for не впливає: гість платить те саме');
console.log('  ok  collected_for доїжджає в розбивку і не чіпає підсумок');

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

// ── Інваріант 9: гроші рахує money(), а не Math.round ────────────────
//
// Було `Math.round(accommodation * amount / 100)` — округлення до ЦІЛОГО.
// У кронах втрату не видно, в євро це центи в кожній квоті: 10 % від 119 €
// давало 12 €. Портьє називає гостю саме це число.
assert.strictEqual(
  applyFees([{ name: 'Сервісний збір', type: 'percentage', amount: 10 }],
    { ...ctx, accommodationTotal: 119 }).feesTotal,
  11.9, '10 % від 119 — це 11,90, а не 12');
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'percentage', amount: 7 }],
    { ...ctx, accommodationTotal: 100.05 }).feesTotal,
  7, '7 % від 100,05 — 7,0035, тобто 7,00 після заокруглення до центів');

// Double не має 0.10: 0.1 × 3 гостей = 0.30000000000000004, і це число їхало
// в квоту й у базу. Округлення на виході не рятує — там уже не те значення.
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'per_person', amount: 0.1 }], ctx).feesTotal,
  0.3, 'дрібне мито на трьох гостей не має давати хвіст із double');
assert.strictEqual(
  applyFees([{ name: 'Мито', type: 'per_person_per_night', amount: 0.1 }], ctx).feesTotal,
  0.9, 'те саме через три ночі');

// Підсумок дорівнює сумі своїх же рядків: інакше гість бачить розбивку, яка
// не сходиться з числом під нею.
const tails = applyFees([
  { name: 'A', type: 'per_person', amount: 0.1 },
  { name: 'B', type: 'per_night', amount: 0.2 },
  { name: 'C', type: 'percentage', amount: 3 },
], { ...ctx, accommodationTotal: 119 });
assert.strictEqual(tails.feesTotal,
  Number(tails.feeBreakdown.reduce((s, f) => s + f.amount, 0).toFixed(2)),
  'сума зборів мусить дорівнювати сумі рядків розбивки');
console.log('  ok  збори рахуються через money(), підсумок сходиться з рядками');

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

// Те саме правило для двох нових полів. Значення поза CHECK означає, що база
// пішла вперед без коду; вгадати тут — це або недобір, або переплата гостя,
// і обидва мовчазні. Зниклий збір видно одразу: підсумок не сходиться.
for (const [field, row] of [
  ['applies_to', { name: 'Мито', type: 'per_person', amount: 50, applies_to: 'seniors' }],
  ['collected_for', { name: 'Мито', type: 'per_person', amount: 50, collected_for: 'platform' }],
] as const) {
  const prev = console.error;
  let said = '';
  console.error = (m) => { said = String(m); };
  const res = applyFees([row], ctx);
  console.error = prev;
  assert.strictEqual(res.feesTotal, 0, `невідоме ${field} не сміє порахуватися за вгаданим правилом`);
  assert.ok(said.includes(field), `невідоме ${field} мусить лишити слід у логу`);
}
console.log('  ok  невідомі applies_to / collected_for відмовляють, а не вгадують');

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
