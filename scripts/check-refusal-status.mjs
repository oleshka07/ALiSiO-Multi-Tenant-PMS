/**
 * Названа відмова — це 4xx. Не 5xx, і не «як вийде».
 *
 *   node scripts/check-refusal-status.mjs --strict
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 * Жоден виклик `refuse(…)` у дереві не має статусу поза 4xx.
 *
 * ── Чому це не стилістика ───────────────────────────────────────────────
 *
 * `handleError` віддає названу відмову ДОСЛІВНО — її текст і її статус
 * (`core/http/errors.ts`). Це і є весь сенс `refuse`: речення, яке ми
 * написали самі, доїжджає до людини замість «Внутрішня помилка сервера».
 *
 * Рівно тому `refuse(…, 500)` — не «відмова зі статусом 500», а **обхід
 * маскування помилок**: текст, який ніхто не писав для клієнта, їде клієнту
 * зі статусом, за яким видно, що це поломка. Шапка `errors.ts` каже про це
 * прямо: для не-4xx названа відмова не застосовується.
 *
 * Знайдений випадок: `core/hotel-day.ts` кидав
 * `refuse('organization <id> has no timezone …', 500)` — англійське речення
 * з ІДЕНТИФІКАТОРОМ ОРЕНДАРЯ назовні, при тому що обидва випадки, у яких
 * туди можна потрапити, це поломка сервера, а не те, що оператор може
 * виправити (рецензія раунду 20, П2). Правильних відповідей дві: 4xx із
 * текстом для людини, або звичайний виняток, який `serverError` замаскує і
 * покладе в лог з місцем.
 *
 * ── Чому це ВЛАСТИВІСТЬ, а не візерунок (§3.2.1) ────────────────────────
 *
 * Гейт не шукає рядок `, 500)`. Він знаходить КОЖЕН виклик `refuse(` за
 * балансом дужок, бере його ДРУГИЙ аргумент і судить про число. Тому
 * `refuse(msg, 503)`, `refuse(msg, 500 )` і багаторядковий виклик із
 * шаблонним рядком у першому аргументі ловляться однаково.
 *
 * Статус-не-літерал (`refuse(msg, status)`) теж червоний, і це навмисно:
 * гейт не вміє довести, що змінна не буде 5xx, а мовчазний пропуск був би
 * рівно тією дірою, від якої §3.2.1 попереджає. Сьогодні таких немає.
 *
 * ── Чого гейт НЕ рахує ──────────────────────────────────────────────────
 *
 * Локальних однойменних помічників (`function refuse(e: unknown)` у
 * `events.handlers`, `folio.handlers`, `cash-closings.handlers`,
 * `companies.handlers`): це інша функція — вона розбирає вже кинуту
 * відмову, а не кидає нову. Файл, який оголошує власний `refuse`,
 * пропускається цілком, і сам факт пропуску друкується.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOTS = ['src', 'scripts'];

/**
 * Коментарі — геть, ДОВЖИНА — та сама.
 *
 * Перша редакція цього гейта не вирізала коментарів і одразу почервоніла на
 * власному поясненні: рядок «Звичайний виняток, а НЕ `refuse(…, 500)`» у
 * `hotel-day.ts` — це текст, а не виклик. Правило AGENTS §4 про це і каже, а
 * §3.2.1 (випадок 7) додає головне: хибно-червоний гейт лагодиться в ГЕЙТІ, а
 * не переписуванням чужого коментаря так, щоб гейт його не бачив.
 *
 * Вирізане замінюється пробілами, а переводи рядків зберігаються — інакше
 * зсунулися б номери рядків, і гейт називав би не те місце. `check-bare-node`
 * уже мав стрипер, який зʼїв 60 рядків разом із кодом і доповів «чисто».
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  let inString = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 2; continue; }
      if (c === inString) inString = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inString = c; out += c; i += 1; continue; }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (c === '/' && next === '*') {
      out += '  '; i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  '; i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Вміст рядкових літералів — теж ГЕТЬ, лапки й довжина лишаються.
 *
 * Друга редакція гейта, зі стрипером коментарів, одразу почервоніла вдруге —
 * і знову на собі: у власному тексті відмови стоїть `refuse(…, ${code})`, і
 * це рядок, а не виклик. Той самий клас, що коментар, тільки з іншого боку,
 * і полагоджений так само — у гейті.
 *
 * Загальне правило, з якого обидві правки випливають: **гейт читає КОД**.
 * Коментар і вміст рядка — це текст, і в тексті може стояти що завгодно,
 * зокрема приклад того, що гейт ловить. Саме на цьому `check-currency-literals`
 * побачив код валюти у власному поясненні (Р14.2), а `invoicing.check` —
 * свій же список таблиць.
 *
 * Довжина зберігається символ у символ, тож номери рядків і зміщення
 * лишаються тими самими, а `argsOf` бачить `refuse('     ', 500)` — статусу
 * це не міняє.
 */
function blankStrings(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      i += 1;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') { out += '  '; i += 2; continue; }
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < source.length) { out += c; i += 1; }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Аргументи виклику `refuse(` — за балансом дужок, не за комою. */
function argsOf(source, openParen) {
  let depth = 0;
  let inString = null;
  for (let i = openParen; i < source.length; i += 1) {
    const c = source[i];
    if (inString) {
      if (c === '\\') { i += 1; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inString = c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return null;
}

/** Аргументи верхнього рівня: кома поза дужками, дужками-масивами і рядками. */
function splitTop(args) {
  const parts = [];
  let depth = 0;
  let inString = null;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (inString) {
      if (c === '\\') { i += 1; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inString = c; continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) { parts.push(args.slice(start, i)); start = i + 1; }
  }
  parts.push(args.slice(start));
  return parts.map((s) => s.trim()).filter((s) => s !== '');
}

const problems = [];
const skipped = [];
let calls = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue;
    const rel = full.split(path.sep).join('/');
    const raw = fs.readFileSync(full, 'utf8');
    if (!raw.includes('refuse(')) continue;
    const source = blankStrings(stripComments(raw));

    // Файл із власним однойменним помічником — інша функція, не наша.
    if (/function\s+refuse\s*\(/.test(source)) {
      // `refusal.ts` оголошує САМЕ ту, про яку йдеться, — її визначення не
      // є викликом і рахувати там нічого.
      if (!rel.endsWith('core/http/refusal.ts')) skipped.push(rel);
      continue;
    }

    const re = /\brefuse\s*\(/g;
    let m;
    while ((m = re.exec(source))) {
      const args = argsOf(source, m.index + m[0].length - 1);
      if (args === null) continue;
      calls += 1;
      const parts = splitTop(args);
      const line = source.slice(0, m.index).split('\n').length;
      if (parts.length < 2) continue;            // дефолт — 400, він у `refuse`
      const status = parts[1];
      if (/^\d+$/.test(status)) {
        const code = Number(status);
        if (code < 400 || code > 499) {
          problems.push(`${rel}:${line} — refuse(…, ${code}): названа відмова їде ДОСЛІВНО, `
            + 'а поза 4xx це обхід маскування помилок (інваріант 6). '
            + 'Або 4xx із текстом для оператора, або звичайний виняток');
        }
      } else {
        problems.push(`${rel}:${line} — refuse(…, ${status}): статус не літерал, `
          + 'тобто гейт не може довести, що він 4xx. Назвіть число');
      }
    }
  }
}

for (const root of ROOTS) if (fs.existsSync(root)) walk(root);

console.log('═'.repeat(78));
console.log('НАЗВАНА ВІДМОВА ПОЗА 4xx — має бути нуль');
console.log('═'.repeat(78));
console.log();

if (problems.length === 0) {
  console.log(`  чисто — ${calls} виклик(ів) refuse(), кожен у межах 4xx`);
  if (skipped.length) {
    console.log(`  пропущено файлів із власним однойменним helper'ом: ${skipped.length}`);
    for (const s of skipped) console.log(`    ${s}`);
  }
  process.exit(0);
}
for (const p of problems) console.log(`  ${p}`);
console.log(`\n  ${problems.length} — текст, якого ми не писали для клієнта, не має їхати клієнту.`);
process.exit(STRICT ? 1 : 0);
