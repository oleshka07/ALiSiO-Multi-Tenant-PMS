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

// ── Друга вісь: НАЗВА ВАЛЮТИ в модулі фінансів. Властивість, не візерунок ──
//
// Перша вісь дивиться на ЗНАК валюти в екранах — `Kč` поруч із числом.
//
// Перша редакція другої осі була ВІЗЕРУНКОВА: список форм, у яких крона
// зустрічалась (`to_currency = '…'`, `currency === '…'`, запасне `?? '…'`). І
// вона мала діру рівно того класу, який стереже: у тому самому файлі, який
// вона нібито почистила, лишилось `newCurrency !== 'CZK'` — інше імʼя змінної
// (`\bcurrency` не збігається всередині `newCurrency`) і інший оператор
// (`===?` не збігається з `!==`). Гейт доповідав «чисто» на дванадцяти живих
// літералах у модулі фінансів, серед них тому, що писав `fx_rate = 1` готелю
// на євро при кожному редагуванні його ж операції.
//
// Тому вісь тепер про ВЛАСТИВІСТЬ: у `src/modules/finance` НЕ БУВАЄ назви
// валюти літералом. Не «не буває в таких-то формах» — не буває взагалі.
// Валюта приходить із організації (`organizationCurrency`) або з рядка даних.
// Візерунок треба вгадати; властивість — ні, і саме тому вона не має дірок.
//
// Виключено, і кожне з причиною:
//   - `.check.ts` — фікстура зобовʼязана називати валюту, інакше вона нічого
//     не розрізняє (інваріант 26);
//   - `core/currency.ts` — це САМ довідник валют, там коди й мусять бути.
//     Він поза `modules/finance`, тож під вісь не потрапляє й так.
const CODE_ROOTS = ['src/modules/finance'];
// Коди — ISO 4217 тих валют, які продукт бачить сьогодні або побачить у
// Європі й Україні. Список не повний і не мусить бути: гейт ловить НАЗВУ
// валюти як явище, а не всі 180 можливих.
const CURRENCY_CODE = /'(?:CZK|EUR|UAH|USD|PLN|GBP|CHF|HUF|RON|SEK|NOK|DKK|BGN|RSD|TRY|JPY|CAD|AUD)'/g;

const codeFound = new Map();
for (const root of CODE_ROOTS) {
  for (const file of walk(root)) {
    const rel = file.split(path.sep).join('/');
    if (/\.check\.ts$/.test(rel)) continue;
    const lines = withoutComments(fs.readFileSync(file, 'utf8')).split('\n');
    const hits = [];
    lines.forEach((line, i) => {
      CURRENCY_CODE.lastIndex = 0;
      const n = (line.match(CURRENCY_CODE) || []).length;
      for (let k = 0; k < n; k += 1) hits.push({ line: i + 1, sign: 'назва валюти', text: line.trim().slice(0, 100) });
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
