/**
 * Which tables and columns does nothing read?
 *
 *   node scripts/audit-dead-data.mjs            # summary
 *   node scripts/audit-dead-data.mjs <table>    # one table's columns
 *
 * Read from the LIVE database, not from the migration code: db.ts creates a
 * table and rebuilds it further down, so a parser sees the shape from before
 * the migrations.
 *
 * Two separate questions, and the second is the interesting one:
 *
 *   мертва таблиця   nothing outside db.ts names it. It exists because a
 *                    migration made it and the feature never landed, or the
 *                    feature was cut and the table stayed.
 *   мертва колонка   the table is alive, the column is never named. This is
 *                    the expensive kind: it survives every "is this table
 *                    used?" check, and it is where half-built features hide.
 *
 * A hit is a CANDIDATE, not a verdict. Dynamic SQL, `SELECT *` and column
 * names that are also ordinary words all produce false negatives — the tool
 * finds what to look at, a human decides. Verify a candidate before dropping
 * it: `git log -S<name>` says when it arrived and whether it ever worked.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB = process.env.DB_PATH || 'data/alisio.db';
const only = process.argv[2];

const db = new Database(DB, { readonly: true });

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((r) => r.name)
  .sort();

// Everything the app is made of, minus the schema file: db.ts names every
// table and column by definition, so counting it would make everything look
// alive. Migrations are how a column is born, not evidence anybody uses it.
// Anything that mirrors the schema rather than uses it. db/postgres/*.sql is
// generated FROM this database, so leaving it in made every column look alive
// and the first run of this script report a confident, meaningless zero.
const SCHEMA_MIRRORS = [
  /^src\/lib\/db\.ts$/,
  /^db\//,
  /^scripts\/(pg-schema|audit-tenant|audit-dead-data)\.mjs$/,
];
const sources = [];
for (const root of ['src', 'scripts', 'db']) {
  if (!fs.existsSync(root)) continue;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.next', '.git'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx|mjs|sql)$/.test(e.name)) continue;
      const rel = p.replace(/\\/g, '/');
      if (SCHEMA_MIRRORS.some((re) => re.test(rel))) continue;
      sources.push([rel, fs.readFileSync(p, 'utf8')]);
    }
  })(root);
}
const HAYSTACK = sources.map(([, t]) => t).join('\n');

/** Where a name appears outside the schema file, as file paths. */
function usedIn(name) {
  const re = new RegExp(`\\b${name}\\b`);
  return sources.filter(([, text]) => re.test(text)).map(([f]) => f);
}

const deadTables = [];
const liveTables = [];
for (const t of tables) {
  if (usedIn(t).length === 0) deadTables.push(t);
  else liveTables.push(t);
}

/**
 * Columns are checked only on live tables — a dead table's columns are all
 * dead and would drown the signal.
 *
 * `SELECT *` means a table's columns can reach the UI without ever being
 * named in the query, so a table read that way is reported separately rather
 * than having its columns declared dead.
 */
const HOUSEKEEPING = new Set(['id', 'created_at', 'updated_at', 'organization_id', 'property_id']);

function columnsOf(t) {
  return db.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map((c) => c.name);
}

const starRead = new Set();
for (const t of liveTables) {
  if (new RegExp(`SELECT\\s+\\*\\s+FROM\\s+["'\`]?${t}\\b`, 'i').test(HAYSTACK)) starRead.add(t);
  else if (new RegExp(`\\b\\w+\\.\\*[\\s,][^;]{0,200}FROM\\s+["'\`]?${t}\\b`, 'is').test(HAYSTACK)) starRead.add(t);
}

/**
 * A column can be read without ever being written down.
 *
 *   const colKey = `${field}_${lang}`;   // name_pl, unit_label_fr, …
 *   if (obj[colKey]) return obj[colKey];
 *
 * Thirteen translation columns looked stone dead by a literal search and were
 * one edit away from being dropped. So: a column named <base>_<suffix> whose
 * <base> IS referenced counts as used, because that is exactly the shape these
 * lookups build. Better a false "alive" than deleting a guest-facing column.
 */
const buildsColumnNames = /`\$\{\w+\}_\$\{\w+\}`|`\w+_\$\{\w+\}`/.test(HAYSTACK);

// Only a language suffix counts. A first pass took any two- or three-letter
// tail, which quietly resurrected matched_at, actual_net and source_url —
// their bases happen to be words the code uses. The languages are the ones
// the guest-facing Lang union declares.
const LANG_SUFFIX = new Set(['en', 'de', 'cs', 'uk', 'pl', 'nl', 'fr']);

function referenced(name) {
  // A short or word-like name matches prose; require it next to SQL or a
  // property access to count as a real reference.
  const re = name.length <= 4
    ? new RegExp(`[.'"\`\\s(]${name}[.'"\`\\s,)=]`)
    : new RegExp(`\\b${name}\\b`);
  return re.test(HAYSTACK);
}

const dynamicColumns = new Map(); // table -> [column] reached only by a template
const deadColumns = new Map();    // table -> [column]
for (const t of liveTables) {
  const cols = columnsOf(t).filter((c) => !HOUSEKEEPING.has(c));
  const dead = [];
  const dynamic = [];
  for (const c of cols) {
    if (referenced(c)) continue;
    const suffix = c.match(/_([a-z]{2})$/)?.[1];
    const base = suffix ? c.slice(0, -3) : c;
    if (buildsColumnNames && suffix && LANG_SUFFIX.has(suffix) && referenced(base)) dynamic.push(c);
    else dead.push(c);
  }
  if (dead.length) deadColumns.set(t, dead);
  if (dynamic.length) dynamicColumns.set(t, dynamic);
}

const line = '═'.repeat(78);

if (only) {
  const cols = columnsOf(only);
  const dead = new Set(deadColumns.get(only) || []);
  console.log(line);
  console.log(`ТАБЛИЦЯ ${only} — ${cols.length} колонок`);
  console.log(line);
  console.log();
  if (starRead.has(only)) {
    console.log('  ⚠ читається через SELECT * — колонка може дійти до UI, не згадана в коді');
    console.log();
  }
  const dyn = new Set(dynamicColumns.get(only) || []);
  for (const c of cols) {
    const mark = dead.has(c) ? '  ✗ ніде'
      : dyn.has(c) ? '  ~ через шаблон імені'
      : HOUSEKEEPING.has(c) ? '  · службова' : '  ✓';
    console.log(`  ${c.padEnd(34)}${mark}`);
  }
  process.exit(0);
}

console.log(line);
console.log('МЕРТВІ ДАНІ — таблиці й колонки, яких не називає жоден рядок коду');
console.log(line);
console.log();
console.log(`  таблиць у базі: ${tables.length}   живих: ${liveTables.length}   мертвих: ${deadTables.length}`);
console.log();

if (deadTables.length) {
  console.log(`Таблиці, яких не згадує ніхто, крім db.ts (${deadTables.length}):`);
  for (const t of deadTables) {
    const rows = db.prepare(`SELECT COUNT(*) c FROM ${JSON.stringify(t)}`).get().c;
    console.log(`  ${t.padEnd(38)} ${String(rows).padStart(6)} рядків`);
  }
  console.log();
}

const byCount = [...deadColumns].sort((a, b) => b[1].length - a[1].length);
if (byCount.length) {
  const total = byCount.reduce((s, [, c]) => s + c.length, 0);
  console.log(`Живі таблиці з колонками, яких не називає ніхто (${total} колонок у ${byCount.length} таблицях):`);
  for (const [t, cols] of byCount.slice(0, 20)) {
    const star = starRead.has(t) ? ' *' : '';
    console.log(`  ${(t + star).padEnd(38)} ${String(cols.length).padStart(3)}  ${cols.slice(0, 4).join(', ')}${cols.length > 4 ? ' …' : ''}`);
  }
  if (byCount.length > 20) console.log(`  … ще ${byCount.length - 20} таблиць`);
  console.log();
  console.log('  * таблиця читається через SELECT * — перевіряйте UI, а не лише запити');
}

const dynTotal = [...dynamicColumns.values()].reduce((s2, c) => s2 + c.length, 0);
if (dynTotal) {
  console.log();
  console.log(`Ще ${dynTotal} колонок беруться через шаблон імені (\`\${field}_\${lang}\`) — живі:`);
  for (const [t, cols] of dynamicColumns) {
    console.log(`  ${t.padEnd(38)} ${String(cols.length).padStart(3)}  ${cols.slice(0, 4).join(', ')}${cols.length > 4 ? ' …' : ''}`);
  }
}

console.log();
console.log('Деталі по таблиці:  node scripts/audit-dead-data.mjs <таблиця>');
console.log('Перед видаленням:   git log -S<ім\'я> -- src/  (коли з\'явилось і чи працювало)');

db.close();
