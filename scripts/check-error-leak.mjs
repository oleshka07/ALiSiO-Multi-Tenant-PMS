/**
 * An exception's text does not reach the caller.
 *
 *   node scripts/check-error-leak.mjs [--strict]
 *
 * AGENTS.md §6: a 500 says that something broke, not what. 143 handlers said
 * what — `{ error: error.message }` — which is the database talking to the
 * browser. «duplicate key value violates unique constraint
 * "fin_operations_source_ref_key"» names a table, a column and a rule.
 * «no such column: r.organization_id» draws the schema one failed request at a
 * time. A driver error can carry a connection string. None of it is useful to
 * the person who clicked a button, and all of it is useful to somebody mapping
 * the system.
 *
 * The replacement is `serverError(scope, err)` from `@core/http/errors`: the
 * detail goes to the log with a scope saying where, the caller gets a sentence.
 * Both halves in one call, so «sanitise the response» cannot be done by
 * throwing the diagnostic away — which is what most of these handlers would
 * have done, because most of them had no console.error at all.
 *
 * What this checks: `error: <e|err|error>.message` inside a response whose
 * status is 500. Deliberately narrow:
 *
 *   - a 4xx keeps its message. «Виїзд раніше за заїзд» in a 400 is the message
 *     doing its job, and replacing it with «Внутрішня помилка» would be a
 *     downgrade wearing a security fix's clothes;
 *   - `propertyErrorStatus(e)` chooses 400/403/404 from a domain error written
 *     to be read by a person — same reasoning;
 *   - `console.error(err.message)` is a log line and is the point, not the bug.
 *
 * ── Друга вісь: глухий `catch` над записом у базу ────────────────────────
 *
 * «4xx keeps its message» вище істинне рівно доти, доки в тому `catch`
 * ловиться НАША відмова. Глухий `catch (e) { return { error: e.message },
 * 400 }`, що накриває шматок із записом у базу, ловить обидва роди помилок
 * одним рукавом: і «amount must be a positive number», і текст CHECK зі
 * списком дозволених значень і назвою колонки. Рецензія 07.09 раунд 3 знайшла
 * саме це у фінансах: клієнт отримував опис констрейнта, відповідь була 400,
 * тож поломка не виглядала поломкою — 500 із логом хтось би побачив.
 *
 * Тому другий пошук: `catch`, який віддає `e.message` зі статусом 4xx, а в
 * його `try` є звертання до бази (`sql.run`, `sql.row`, `sql.rows`, `.tx(`).
 * Вузький `catch` навколо самого валідатора лишається дозволеним — там ловити
 * нема чого, крім власного тексту.
 *
 * ── Дві сліпі плями, знайдені рецензією раунду 8 (Р8.1) ──────────────────
 *
 * 1. ВКЛАДЕНИЙ `try`. Пара «try — catch» шукалась як «найближче слово `try`
 *    ліворуч від `catch`». Для ЗОВНІШНЬОГО `catch` таким словом виявляється
 *    внутрішній `try`, і зовнішній обробник судився за тілом внутрішнього:
 *
 *        try {                         // тут await, база, вендор
 *          …
 *          try { JSON.parse(raw) }     // синхронно
 *          catch { … }
 *        } catch (e) {                 // ← сюди прилітає помилка драйвера,
 *          return { error: e.message }, 400   //   а гейт бачив «синхронний try»
 *        }
 *
 *    Тепер пари будуються за БАЛАНСОМ ДУЖОК: від `try {` до його закриття,
 *    далі `catch (…) {` — і вкладеність перестає бути дірою.
 *
 * 2. ОБЧИСЛЕНИЙ статус. Шукався літерал `status: 4xx`. `status: code`,
 *    `status: err.status ?? 400`, `{ status }` — усе це проходило повз, хоч
 *    саме так і пишуть обробники, які хочуть «віддати статус із помилки».
 *    Тепер підозрілим є будь-який `status`, який НЕ є літеральним 5xx: 5xx
 *    ловить перша вісь, а решта — літеральна 4xx або обчислена — друга.
 *
 * Правильно: `refuse('…')` для названої відмови і `handleError(scope, err)`
 * з `@core/http/errors` у `catch` — названа відмова їде 400 зі своїм текстом,
 * решта йде в лог і віддає 500 загальним реченням.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const strict = process.argv.includes('--strict');
// fileURLToPath, не URL.pathname: на Windows pathname лишає %20 і слеш перед
// літерою диска, і readdir шукав 'D:\D:\…' — гейт падав, не перевіривши нічого.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LEAK = /error:\s*(?:e|err|error)\??\.message[^}]*\}\s*,\s*\{\s*status:\s*5\d\d/g;

// Що вважається «тут відбувається щось, чиїх повідомлень ми не писали».
//
// Спершу тут стояв літеральний `sql.run|row|rows|tx`, і цього виявилось мало:
// `properties/api/currency.handlers.ts:45` віддавав `e?.message` з 409, а
// читання бази було сховане за викликом репозиторію (`organizationCurrency`
// → `core/currency.ts:70`). Гейт мовчав саме там, де мав говорити (рецензія
// 07.09 раунд 7, П3).
//
// Тому ознака ширша й простіша: у тілі `try` є `await`. Усе, чого ми чекаємо,
// може бути введенням-виведенням — база, вендор, файл, — і текст його помилки
// написали не ми. Вузький `catch` навколо СИНХРОННОГО валідатора під цю
// ознаку не підпадає, і це правильно: там ловити нема чого, крім власного
// рядка (`counterparties`, `auto-rules` — обидва без `await`).
const DB_CALL = /\bawait\b|\bsql\s*\.\s*(?:run|rows|row|tx)\b|\.\s*tx\s*\(/;

const offenders = [];
const blind = [];

/**
 * Кінець блока, що починається на `{` за індексом `open` — індекс його `}`.
 * `-1`, якщо дужки не збалансовані (обрізаний файл).
 */
function blockEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Тіло блока, що починається на `{` за індексом `open`. */
function blockAt(text, open) {
  const end = blockEnd(text, open);
  return end < 0 ? text.slice(open) : text.slice(open, end + 1);
}

/**
 * Усі пари «тіло try — тіло catch» у файлі, з урахуванням ВКЛАДЕНОСТІ.
 *
 * Раніше пара шукалась як «найближче слово `try` ліворуч від `catch`», і на
 * вкладеності це давало хибно-зелене: зовнішній `catch` судився за тілом
 * ВНУТРІШНЬОГО `try` (Р8.1). Тут навпаки — від `try` уперед, за балансом
 * дужок: кожен `try` знаходить СВІЙ `catch`, скільки б їх не було всередині.
 */
function tryCatchPairs(text) {
  const pairs = [];
  for (const m of text.matchAll(/\btry\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const end = blockEnd(text, open);
    if (end < 0) continue;
    // Після тіла `try` може стояти `catch (…) {` або одразу `finally`.
    const after = text.slice(end + 1, end + 1 + 200);
    const c = after.match(/^\s*catch\s*(?:\(([^)]*)\))?\s*\{/);
    if (!c) continue;
    const catchOpen = end + 1 + c[0].length - 1;
    pairs.push({
      tryBody: text.slice(open, end + 1),
      catchBody: blockAt(text, catchOpen),
      catchIndex: end + 1 + c[0].indexOf('catch'),
    });
  }
  return pairs;
}

/**
 * Статус, яким `catch` відповідає: `'5xx'`, `'4xx'` або `'computed'`.
 *
 * Обчислений статус — не екзотика, а звичайний спосіб «віддати статус із
 * помилки» (`status: err.status ?? 400`, `{ status }`). Доти гейт шукав
 * літерал і такий обробник не бачив узагалі.
 */
function statusKind(catchBody) {
  // Лише ВІДПОВІДЬ. `ical-sync.handlers.ts` повертає з `catch` звичайний
  // обʼєкт `{ status: 'error', error: e.message }` — це поле звіту синка, яке
  // йде в журнал, а не HTTP-статус клієнтові; перша версія цієї перевірки
  // назвала його порушенням, і це було б неправдою.
  if (!/(?:NextResponse|Response)\s*\.\s*json\s*\(/.test(catchBody)) return null;
  const literal = [...catchBody.matchAll(/status:\s*(\d{3})\b/g)].map((m) => Number(m[1]));
  if (literal.length) return literal.some((n) => n >= 500) ? '5xx' : '4xx';
  // Рядковий `status: 'error'` теж не HTTP-статус.
  const computed = /status\s*:\s*(?!['"`])/.test(catchBody) || /\{[^}]*\bstatus\b[^}:]*\}/.test(catchBody);
  return computed ? 'computed' : null;
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p);
      continue;
    }
    if (!/\.(ts|tsx|mts)$/.test(e.name)) continue;

    const rel = path.relative(ROOT, p).replaceAll(path.sep, '/');
    const text = fs.readFileSync(p, 'utf8');
    LEAK.lastIndex = 0;
    let m;
    while ((m = LEAK.exec(text))) {
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push(`${rel}:${line}`);
    }

    for (const pair of tryCatchPairs(text)) {
      if (!/error:\s*(?:e|err|error)\??\.message/.test(pair.catchBody)) continue;
      const kind = statusKind(pair.catchBody);
      // 5xx уже названо першою віссю — тут решта: літеральна 4xx і обчислена.
      if (kind !== '4xx' && kind !== 'computed') continue;
      if (!DB_CALL.test(pair.tryBody)) continue;
      const line = text.slice(0, pair.catchIndex).split('\n').length;
      blind.push(`${rel}:${line}${kind === 'computed' ? '  (статус обчислений)' : ''}`);
    }
  }
}

walk(path.join(ROOT, 'src'));

const BAR = '═'.repeat(78);
console.log(`\n${BAR}`);
console.log('ТЕКСТ ВИНЯТКУ В 500-ВІДПОВІДІ — має бути нуль');
console.log(BAR);

if (offenders.length) {
  console.log('');
  for (const o of offenders) console.log(`  ✗ ${o}`);
  console.log(`\n  ${offenders.length} — замініть на serverError('<де>', err) з @core/http/errors:`);
  console.log('  деталь піде в лог із міткою місця, клієнт дістане речення.');
} else {
  console.log('\n  чисто — жодна 500 не переказує клієнту текст помилки');
  console.log('  правильно: return serverError(\'<де>\', err)  — @core/http/errors');
}

console.log(`\n${BAR}`);
console.log('ГЛУХИЙ CATCH НАД ЗАПИСОМ У БАЗУ, ЩО ВІДДАЄ e.message З 4xx — теж нуль');
console.log(BAR);

if (blind.length) {
  console.log('');
  for (const b of blind) console.log(`  ✗ ${b}`);
  console.log(`\n  ${blind.length} — цей catch ловить і нашу відмову, і помилку драйвера.`);
  console.log('  Клієнт дістає текст CHECK зі списком значень і назвою колонки, і то зі');
  console.log('  статусом 400 — тобто поломка навіть не виглядає поломкою.');
  console.log("  правильно: refuse('…') для названої відмови, handleError('<де>', err) у catch.\n");
} else {
  console.log('\n  чисто — жоден catch над записом у базу не переказує тексту винятку\n');
}

process.exit(strict && (offenders.length || blind.length) ? 1 : 0);
