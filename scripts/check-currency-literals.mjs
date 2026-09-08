#!/usr/bin/env node
/**
 * Знак валюти, зашитий в екран.
 *
 *   node scripts/check-currency-literals.mjs            # звіт
 *   node scripts/check-currency-literals.mjs --strict    # храповик: ріст валить збірку
 *
 * Інваріант 20: дані, які клієнт може змінити сам, не бувають літералом у
 * коді. Валюта — саме такі дані, і вона приходить з готелю
 * (`useHotelCurrency()`), а не з клавіатури того, хто писав екран.
 *
 * Гейта на це не було. `check-reservation-currency.mjs` стереже ЗАПИС —
 * `INSERT` без названої валюти, — і про показ не каже нічого. Тому `Kč`
 * дожило до 2026-го у восьми місцях операторських екранів (4 файли): список
 * броней і картка гостя на телефоні (там і `'0 Kč'` у гілці порожнечі),
 * фінансовий огляд (плюс `toLocaleString('cs-CZ')` — формат числа першого
 * клієнта) і підсумки замовлень на дашборді. Симптом мовчазний: чеський
 * готель нічого не помітить, а німецький побачить свої євро, підписані
 * кронами.
 *
 * Храповик, а не заборона: `pricing/` і `documents/` мають літерали, які цей
 * прохід не чіпав (заголовки таблиці тарифів, чеський зразок фактури), і вони
 * належать іншим сесіям. Стеля кожного файла зафіксована; нове порушення
 * валить збірку, виправлене вимагає опустити стелю, новий файл народжується зі
 * стелею нуль.
 *
 * Знаки навмисно однозначні. `$` рахується лише перед цифрою (`$100`), бо
 * інакше кожен `${…}` у шаблонному рядку був би «валютою».
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOTS = ['src/components', 'src/app/app'];
const BASELINE = 'scripts/check-currency-literals.baseline.json';

const SIGNS = [
  ['Kč', /Kč/g],
  ['€', /€/g],
  ['zł', /zł/g],
  ['₴', /₴/g],
  ['£', /£/g],
  ['$', /\$(?=\d)/g],
];

// Локаль числа (`toLocaleString('cs-CZ')`) — той самий клас інваріанта 20, але
// ІНШЕ питання, і в цьому гейті його немає навмисно: та сама конструкція
// форматує дати (`new Date(…).toLocaleString('uk-UA')`), де локаль правильна,
// і гейт, що судить обидва випадки одним регексом, доповідав би про валюту там,
// де її нема. Знайдене при написанні цього проходу — 14 місць у фінансових
// екранах, серед них `${…toLocaleString('cs-CZ')} CZK` — передано у звіті.

/** Коментарі забілюються, а не вирізаються: номери рядків мають лишитись. */
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* walk(full); continue; }
    if (/\.tsx?$/.test(e.name)) yield full;
  }
}

const found = new Map();   // файл → [{ line, sign, text }]
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = file.split(path.sep).join('/');
    const lines = withoutComments(fs.readFileSync(file, 'utf8')).split('\n');
    const hits = [];
    lines.forEach((line, i) => {
      for (const [name, re] of SIGNS) {
        re.lastIndex = 0;
        const n = (line.match(re) || []).length;
        for (let k = 0; k < n; k += 1) hits.push({ line: i + 1, sign: name, text: line.trim().slice(0, 100) });
      }
    });
    if (hits.length) found.set(rel, hits);
  }
}

// ── Друга вісь: код валюти як ЦІЛЬ або МІРА в логіці, не на екрані ─────────
//
// Перша вісь дивиться на ЗНАК валюти в екранах — `Kč` поруч із числом. Її
// сліпе місце назвав живий прохід (INC-028, ланка 4): у ядрі обліку стояло
// `WHERE from_currency = ? AND to_currency = 'CZK'`, тобто крона була ЦІЛЬОВОЮ
// валютою конверсії, і готель на євро не міг провести готівкову оплату
// взагалі — відмова «Немає курсу EUR→CZK» приходила на кожну. Знака на екрані
// при цьому не було ніде, тож перша вісь мовчала за побудовою.
//
// Тому друга вісь шукає КОД валюти (три великі літери зі списку) там, де він
// вирішує, а не показує: праворуч від `to_currency`/`from_currency`, у
// порівнянні `currency === '…'`, у запасному `?? '…'`. І дивиться вона в
// ЯДРО й МОДУЛІ, а не в екрани — саме там крона колись стала валютою світу.
//
// Чого тут НЕМАЄ навмисно: рядки самого списку валют (`core/currency.ts` веде
// довідник — там коди й мусять бути) і тести з фікстурами. Стеля кожного
// файла зафіксована так само, як у першій осі.
const CODE_ROOTS = ['src/core', 'src/modules', 'src/app/api'];
const CODE_AXIS = [
  ['ціль конверсії', /to_currency\s*=\s*'[A-Z]{3}'/g],
  ['джерело конверсії', /from_currency\s*=\s*'[A-Z]{3}'/g],
  ['порівняння валюти', /\bcurrency\s*===?\s*'[A-Z]{3}'/g],
  ['запасна валюта', /\bcurrency[^\n]{0,40}(\?\?|\|\|)\s*'[A-Z]{3}'/g],
];
const CODE_SKIP = ['src/core/currency.ts', 'src/core/currency.check.ts'];

const codeFound = new Map();
for (const root of CODE_ROOTS) {
  for (const file of walk(root)) {
    const rel = file.split(path.sep).join('/');
    if (CODE_SKIP.includes(rel) || /\.check\.ts$/.test(rel)) continue;
    const lines = withoutComments(fs.readFileSync(file, 'utf8')).split('\n');
    const hits = [];
    lines.forEach((line, i) => {
      for (const [name, re] of CODE_AXIS) {
        re.lastIndex = 0;
        const n = (line.match(re) || []).length;
        for (let k = 0; k < n; k += 1) hits.push({ line: i + 1, sign: name, text: line.trim().slice(0, 100) });
      }
    });
    if (hits.length) codeFound.set(rel, hits);
  }
}
for (const [file, hits] of codeFound) {
  found.set(file, [...(found.get(file) || []), ...hits]);
}

const counts = Object.fromEntries([...found].map(([f, h]) => [f, h.length]).sort());
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (!STRICT) {
  console.log(`знак валюти в коді екрана: ${total} у ${found.size} файлах\n`);
  for (const [file, hits] of [...found].sort()) {
    console.log(`  ${file} — ${hits.length}`);
    for (const h of hits.slice(0, 4)) console.log(`      :${h.line} ${h.sign}  ${h.text}`);
    if (hits.length > 4) console.log(`      …ще ${hits.length - 4}`);
  }
  console.log('\n  валюта береться з готелю: useHotelCurrency() (екран) або поле рядка (дані).');
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { files: {} };
const ceiling = baseline.files || {};

const grew = [];
const shrank = [];
for (const [file, n] of Object.entries(counts)) {
  const max = ceiling[file] ?? 0;
  if (n > max) grew.push(`${file}: ${n} (стеля ${max})`);
  else if (n < max) shrank.push(`${file}: ${n} (стеля ${max})`);
}
for (const [file, max] of Object.entries(ceiling)) {
  if (!(file in counts) && max > 0) shrank.push(`${file}: 0 (стеля ${max})`);
}

console.log(`currency-literals: ${total} місць у ${found.size} файлах — знак на екрані і код у логіці (стеля: ${Object.values(ceiling).reduce((a, b) => a + b, 0)} у ${Object.keys(ceiling).length})`);

if (grew.length) {
  console.error('\n  ✗ валюта зашита в код. На екрані — беріть `useHotelCurrency()`;'
    + ' у логіці — валюту організації (`organizationCurrency`), не літерал:');
  for (const l of grew) console.error(`      ${l}`);
  for (const l of grew) {
    const file = l.split(':')[0];
    for (const h of (found.get(file) || []).slice(0, 3)) console.error(`        ${file}:${h.line}  ${h.sign}  ${h.text}`);
  }
  process.exit(1);
}
if (shrank.length) {
  console.error(`\n  ✗ ${shrank.length} файл(ів) стали ЧИСТІШИМИ за стелю — опустіть стелю в ${BASELINE}, щоб прогрес не відкотився мовчки:`);
  for (const l of shrank) console.error(`      ${l}`);
  process.exit(1);
}
console.log('  чисто — ні екран, ні логіка не вигадали валюти понад стелю');
