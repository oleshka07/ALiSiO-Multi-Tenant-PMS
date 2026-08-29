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
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const strict = process.argv.includes('--strict');
// fileURLToPath, не URL.pathname: на Windows pathname лишає %20 і слеш перед
// літерою диска, і readdir шукав 'D:\D:\…' — гейт падав, не перевіривши нічого.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LEAK = /error:\s*(?:e|err|error)\??\.message[^}]*\}\s*,\s*\{\s*status:\s*500/g;

const offenders = [];

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
  }
}

walk(path.join(ROOT, 'src'));

const BAR = '═'.repeat(78);
console.log(`\n${BAR}`);
console.log('ТЕКСТ ВИНЯТКУ В 500-ВІДПОВІДІ — має бути нуль');
console.log(BAR);

if (!offenders.length) {
  console.log('\n  чисто — жодна 500 не переказує клієнту текст помилки');
  console.log('  правильно: return serverError(\'<де>\', err)  — @core/http/errors\n');
  process.exit(0);
}

console.log('');
for (const o of offenders) console.log(`  ✗ ${o}`);
console.log(`\n  ${offenders.length} — замініть на serverError('<де>', err) з @core/http/errors:`);
console.log('  деталь піде в лог із міткою місця, клієнт дістане речення.\n');
process.exit(strict ? 1 : 0);
