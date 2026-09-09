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
import ts from 'typescript';
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

/**
 * Коментарі забілюються, а не вирізаються: номери рядків мають лишитись.
 *
 * Забілюються ТРИ роди, і третій — причина, чому тут розбір, а не регекс.
 *
 *  1. `/* … *\/` і `// …` — коментарі JS;
 *  2. `-- …` УСЕРЕДИНІ ШАБЛОННОГО РЯДКА — коментар SQL. Запити тут пишуться
 *     у backtick-рядках, і пояснення до запиту живе коментарем SQL поруч із
 *     ним. Гейт цього не знав і бачив у поясненні код валюти;
 *  3. `--` поза шаблонним рядком НЕ чіпається: у JS це декремент (`i--`), і
 *     забілити його означало б зʼїсти код.
 *
 * ── Чому саме так, а не «ще один регекс» ────────────────────────────────
 *
 * 08.09.2026 цей гейт спрацював на КОМЕНТАРІ в `modules/bookings`, і
 * найдешевшим здалося переписати коментар так, щоб гейт його не бачив. Це
 * неправильна відповідь двічі: гейт і далі не вміє того, чого не вміє, а в
 * чужому файлі лишається слід, який наступний читач прийме за норму
 * (AGENTS §3.2.1, сьомий випадок: **хибно-червоний гейт лагодиться в гейті**).
 *
 * Розбір бере `ts.createSourceFile` — той самий `typescript`, яким уже
 * користуються `check-bare-node`, `check-i18n-leak` і `check-unwrapped`.
 * Межі коментарів і шаблонних рядків він знає точно, тож питання «це код чи
 * пояснення» більше не вгадується візерунком. Саме на вгадуванні візерунка
 * вмер стрипер `check-bare-node`, який відкрив «блоковий коментар» на рядку
 * `'/*'` і зʼїв 60 рядків.
 */
const withoutComments = (src) => {
  const out = src.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };

  // Один розбір на обидва проходи. Саме РОЗБІР, не сканер: сканер сам по собі
  // не знає, чи `/` — це ділення, чи початок регулярного виразу, тож на
  // першому ж діленні він читає решту файла як один літерал і мовчки
  // зупиняється. Так і сталося при написанні: у `payment-bridge.ts` він
  // знаходив 10 коментарів із 256 і не бачив саме того, через який усе
  // затівалось.
  const file = ts.createSourceFile('x.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const isTemplate = (node) =>
    node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    || node.kind === ts.SyntaxKind.TemplateHead
    || node.kind === ts.SyntaxKind.TemplateMiddle
    || node.kind === ts.SyntaxKind.TemplateTail;

  const visit = (node) => {
    // 1–2. Коментарі JS — це trivia перед вузлом і після нього; розбір знає
    // їхні межі точно, і питання «код це чи пояснення» не вгадується.
    for (const r of ts.getLeadingCommentRanges(src, node.getFullStart()) || []) blank(r.pos, r.end);
    for (const r of ts.getTrailingCommentRanges(src, node.getEnd()) || []) blank(r.pos, r.end);

    // 3. Коментар SQL — лише всередині шаблонного рядка.
    if (isTemplate(node)) {
      const start = node.getStart(file);
      const text = src.slice(start, node.getEnd());
      for (const m of text.matchAll(/--[^\n]*/g)) {
        blank(start + m.index, start + m.index + m[0].length);
      }
    }

    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);

  return out.join('');
};

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
const CODE_ROOTS = [
  'src/modules/finance',
  // Р12.5: гроші рахує не лише модуль фінансів. Фактура, котирування і
  // рахунок гостя називають валюту так само часто — і корінь із одного модуля
  // означав, що вісь стереже чверть поверхні, звучачи як «не буває взагалі».
  'src/modules/invoicing',
  'src/modules/pricing',
  'src/modules/bookings',
];
// Коди — ISO 4217 тих валют, які продукт бачить сьогодні або побачить у
// Європі й Україні. Список не повний і не мусить бути: гейт ловить НАЗВУ
// валюти як явище, а не всі 180 можливих.
//
// Лапки БУДЬ-ЯКІ (Р12.5). Перша редакція цієї осі знала лише одинарні — і
// мовчала на `"CZK"` та на зворотних лапках, тобто мала припущення про ФОРМУ
// всередині твердження про ВЛАСТИВІСТЬ. Виміряно: дописаний у модуль фінансів
// рядок `{ a: "CZK", b: \`EUR\` }` гейт не побачив і доповів «чисто».
//
// Чого вісь НЕ покриває, і це названо прямо, а не мається на увазі:
//   - код усередині ДОВШОГО рядка — `'CZK,EUR'`, `'Ціна в CZK'`,
//     `\`${n} CZK\``: збіг вимагає, щоб лапки обіймали рівно три літери коду;
//   - код, зібраний із частин (`'CZ' + 'K'`) або взятий із мапи за ключем;
//   - усе поза чотирма коренями вище — `src/app`, `src/core`, `src/modules/*`
//     решта. Перша вісь (знак валюти) дивиться на екрани й має свої корені.
const CURRENCY_CODE = /(['"`])(?:CZK|EUR|UAH|USD|PLN|GBP|CHF|HUF|RON|SEK|NOK|DKK|BGN|RSD|TRY|JPY|CAD|AUD)\1/g;

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
