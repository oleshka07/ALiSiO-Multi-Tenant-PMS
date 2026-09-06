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

// `catch (…) { … error: <e>.message … status: 4xx … }` — тіло catch до його
// закриття (шукаємо по балансу дужок від `{` після `catch (…)`).
const CATCH = /catch\s*\(([^)]*)\)\s*\{/g;
const DB_CALL = /\bsql\s*\.\s*(?:run|rows|row|tx)\b|\.\s*tx\s*\(/;

const offenders = [];
const blind = [];

/** Тіло блока, що починається на `{` за індексом `open`. */
function blockAt(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  return text.slice(open);
}

/**
 * `try`, до якого належить цей `catch`: від `{` після `try` і до `catch`.
 * Шукаємо назад найближче слово `try` — вкладені блоки між ними не заважають,
 * бо нас цікавить лише те, чи є в цьому шматку звертання до бази.
 */
function tryBodyBefore(text, catchStart) {
  const head = text.slice(0, catchStart);
  const at = head.lastIndexOf('try');
  if (at < 0) return '';
  const open = head.indexOf('{', at);
  return open < 0 ? '' : head.slice(open);
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

    CATCH.lastIndex = 0;
    let c;
    while ((c = CATCH.exec(text))) {
      const body = blockAt(text, CATCH.lastIndex - 1);
      if (!/error:\s*(?:e|err|error)\??\.message/.test(body)) continue;
      if (!/status:\s*4\d\d/.test(body)) continue;
      if (!DB_CALL.test(tryBodyBefore(text, c.index))) continue;
      const line = text.slice(0, c.index).split('\n').length;
      blind.push(`${rel}:${line}`);
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
