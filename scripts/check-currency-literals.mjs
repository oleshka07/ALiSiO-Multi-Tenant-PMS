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

console.log(`currency-literals: ${total} знаків валюти у ${found.size} файлах екранів (стеля: ${Object.values(ceiling).reduce((a, b) => a + b, 0)} у ${Object.keys(ceiling).length})`);

if (grew.length) {
  console.error('\n  ✗ знак валюти зашито в екран — візьміть валюту готелю (useHotelCurrency), не клавіатуру:');
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
console.log('  чисто — жоден екран не вигадав валюти понад стелю');
