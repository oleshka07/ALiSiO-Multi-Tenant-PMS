/**
 * Правило вихідних живе в ОДНОМУ місці, і воно називає колонку.
 *
 *   node src/modules/pricing/domain/day-price.check.ts
 *
 * Блок 6, привід: 07.09.2026 власник поставив на суботу 333 і отримав 115 —
 * `weekend_price` перебивав `base_price` беззвучно, а екран не казав, звідки
 * число. Перше, що з цього треба тримати машиною, — щоб правило не мало
 * копій: доти їх було три (`nightly-price.ts`, `price-calendar.repo.ts`,
 * `widget-calendar-public.handlers.ts`), і вони вже розходились — у сітці
 * місяця не було варти на нуль і відʼємне.
 *
 * Осі (інваріант 26): будній день і день вихідних (правило зелене й без осі,
 * якщо всі дати одного роду); рядок із `weekend_price` і без нього; нуль,
 * відʼємне і `null` у колонці вихідних — три різні способи сказати «ціни
 * немає», кожен із яких колись продавав ніч за своє число.
 */
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { isWeekendDate, dayRowPrice, priceOrigin } from './day-price.ts';

// ── 1. Який день вважається вихідним ──────────────────────────────────────
// 2026-11-20 — пʼятниця, 21 — субота, 22 — неділя, 23 — понеділок.
assert.strictEqual(isWeekendDate('2026-11-19'), false, 'четвер — будній');
assert.strictEqual(isWeekendDate('2026-11-20'), true, 'пʼятниця — вихідний');
assert.strictEqual(isWeekendDate('2026-11-21'), true, 'субота');
assert.strictEqual(isWeekendDate('2026-11-22'), true, 'неділя');
assert.strictEqual(isWeekendDate('2026-11-23'), false, 'понеділок — будній');

// ── 2. Колонка називається, а не вгадується ───────────────────────────────
const row = { base_price: 333, weekend_price: 115 };
assert.deepStrictEqual(dayRowPrice(row, '2026-11-19'), { price: 333, column: 'base' },
  'у будній діє базова — і сказано, що базова');
assert.deepStrictEqual(dayRowPrice(row, '2026-11-21'), { price: 115, column: 'weekend' },
  'у суботу діє ціна вихідних — і сказано, що вихідних: саме цього не було на екрані 07.09');

// Без ціни вихідних субота бере базову — і це теж 'base', не «вихідна, яка
// дорівнює базовій»: підпис має казати правду про джерело.
assert.deepStrictEqual(dayRowPrice({ base_price: 333, weekend_price: null }, '2026-11-21'),
  { price: 333, column: 'base' }, 'порожня ціна вихідних = як базова');

// ── 3. Три способи сказати «ціни вихідних немає» ──────────────────────────
for (const [weekend, why] of [[0, 'нуль'], [-10, 'відʼємне'], [null, 'порожнє']] as [number | null, string][]) {
  assert.deepStrictEqual(dayRowPrice({ base_price: 333, weekend_price: weekend }, '2026-11-21'),
    { price: 333, column: 'base' }, `${why} у колонці вихідних не має продавати суботу за нього`);
}
assert.deepStrictEqual(dayRowPrice({ base_price: null, weekend_price: null }, '2026-11-21'),
  { price: null, column: 'base' }, 'рядок лише з обмеженнями ціни не має — ніч не продається');

// ── 4. Ключ походження — таблиця ПЛЮС колонка ─────────────────────────────
assert.strictEqual(priceOrigin('calendar', 'weekend'), 'unit_type_weekend');
assert.strictEqual(priceOrigin('calendar', 'base'), 'unit_type');
assert.strictEqual(priceOrigin('rate_plan', 'weekend'), 'rate_plan_weekend');
assert.strictEqual(priceOrigin('rate_plan', 'base'), 'rate_plan');
assert.strictEqual(priceOrigin('matrix'), 'matrix', 'матриця колонки вихідних не має за означенням');

// ── 5. Копій правила не лишилось ──────────────────────────────────────────
//
// Статично, і саме тому, що поведінка тут нічого про копії не каже: три
// однакові рядки в трьох файлах дають зелений результат кожен окремо. Шукаємо
// сам візерунок «вихідний ? ціна вихідних : базова» поза цим модулем.
const FILES = [
  'src/modules/pricing/data/nightly-price.ts',
  'src/modules/pricing/data/price-calendar.repo.ts',
  'src/modules/widget/api/widget-calendar-public.handlers.ts',
];
for (const f of FILES) {
  const text = (await readFile(new URL(`../../../../${f}`, import.meta.url), 'utf8'))
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/isWeekend\s*&&\s*\w*[Ww]eekend\w*\s*!=\s*null\s*\?/.test(text),
    `${f}: своя копія правила вихідних — має бути виклик dayRowPrice() з @pricing/domain/day-price`);
  assert.ok(/dayRowPrice|min_weekend_price/.test(text),
    `${f}: правило вихідних мусить приходити з одного місця`);
}

console.log('day-price: правило вихідних одне, воно називає колонку, нуль і відʼємне не продають ніч');
