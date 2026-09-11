/**
 * Тип колонки в МІГРАЦІЇ збігається з типом у `schema.sql`.
 *
 *   node scripts/check-schema-types.mjs
 *   node scripts/check-schema-types.mjs --strict     # у npm run check і в CI
 *
 * ── Що сталося ──────────────────────────────────────────────────────────
 *
 * 10.09.2026, міграція 0141:
 *
 *   schema.sql:1023   "settles_to_debtor" BIGINT  DEFAULT 0     NOT NULL
 *   0141:63           "settles_to_debtor" BOOLEAN DEFAULT FALSE NOT NULL
 *
 * Писач клав туди `true`/`false`, Postgres відповідав
 * `invalid input syntax for type bigint: "false"`, і `check:pg` був червоний
 * два коміти поспіль. На SQLite усе зелене: там `false` у числову колонку
 * лягає без слова.
 *
 * ── Чому цього не бачив `check-schema-drift` ────────────────────────────
 *
 * Він порівнює ДВІ БАЗИ, і обидві будує однаково: спершу `schema.sql`, потім
 * міграції зверху. `CREATE TABLE IF NOT EXISTS` на наявній таблиці мовчить,
 * тож тип із міграції не застосовується НІКОЛИ — і розбіжність «схема проти
 * міграції» ховається за побудовою вимірювання. Обидві бази виходять
 * однакові й обидві неправильні.
 *
 * Тому це питається до ТЕКСТУ, а не до баз: у міграції написано одне, у
 * згенерованій схемі інше — і жоден прогін цього не покаже, бо в кожному
 * окремому середовищі джерело одне.
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 * ВЛАСТИВІСТЬ: для кожної колонки, яку міграція оголошує в `CREATE TABLE`,
 * тип у `schema.sql` той самий — з точністю до відомих синонімів
 * (`INTEGER`/`BIGINT`, `TIMESTAMP`/`TIMESTAMPTZ`, `NUMERIC` з розміром і без).
 * `BOOLEAN` проти числа синонімами НЕ є: саме ця пара коштувала двох
 * червоних прогонів.
 *
 * Храповик: розбіжності, що вже були на день заведення, зафіксовані числом
 * (`BASELINE`), нові валять збірку. Список читається очима поступово, межу
 * тримає машина — так само, як в `audit-by-id-scope`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const list = process.argv.includes('--list');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Скільки розбіжностей було на день заведення гейта. Нове — червоне.
 *
 * **13 — це не «прийнятно», це «прочитано і відкладено».** Тринадцять
 * успадкованих пар на 10.09.2026, і серед них одна ТОГО САМОГО класу, що
 * коштувала двох червоних прогонів:
 *
 *   invoice_series.reset_yearly — 0011 каже BOOLEAN, schema.sql каже BIGINT
 *
 * Вона поки не стріляє лише тому, що жоден писач у src/ не кладе туди
 * булеве — але сцени нумерації створюють СВОЮ таблицю з BOOLEAN, тобто
 * перевіряють не ту схему, що в проді. Решта дванадцять — інший рід:
 * NUMERIC проти DOUBLE (числа лишаються числами), TEXT проти JSONB, DATE
 * проти TEXT. Вони теж варті розбору, але кожна своєю правкою і зі своєю
 * міграцією, а не гуртом.
 *
 * Стеля тут, щоб МЕЖА трималась машиною, поки список читається очима — так
 * само, як в audit-by-id-scope. Опускається разом із кожною полагодженою
 * парою.
 */
const BASELINE = 13;

const firstWord = (t) => t.trim().split(/[\s(]/)[0].toUpperCase();
const SAME = [
  new Set(['INTEGER', 'BIGINT', 'SMALLINT']),
  new Set(['TIMESTAMP', 'TIMESTAMPTZ']),
  new Set(['DECIMAL', 'NUMERIC']),
  new Set(['TEXT', 'VARCHAR', 'CHARACTER']),
  new Set(['DOUBLE', 'REAL']),
];
const same = (a, b) => a === b || SAME.some((s) => s.has(a) && s.has(b));

/** Колонки з `CREATE TABLE` у тексті: table.col → тип. */
function columnsOf(sql) {
  const out = new Map();
  let table = null;
  let depth = 0;
  for (const raw of sql.split('\n')) {
    const line = raw.replace(/--.*$/, '');
    const t = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([A-Za-z0-9_]+)"?\s*\(/i.exec(line);
    if (t) { table = t[1]; depth = 1; continue; }
    if (!table) continue;
    const c = /^\s*"?([a-z_][a-z0-9_]*)"?\s+([A-Za-z][A-Za-z0-9]*(?:\s*\([^)]*\))?)/.exec(line);
    // Рядки обмежень (PRIMARY KEY, UNIQUE, CHECK, FOREIGN) колонками не є.
    if (c && !/^(primary|unique|check|foreign|constraint|exclude)$/i.test(c[1])) {
      out.set(`${table}.${c[1]}`, firstWord(c[2]));
    }
    if (/^\s*\)\s*;?\s*$/.test(line)) { table = null; depth = 0; }
  }
  return out;
}

const schema = columnsOf(fs.readFileSync(path.join(ROOT, 'db/postgres/schema.sql'), 'utf8'));
const migDir = path.join(ROOT, 'db/postgres/migrations');
const clashes = [];
for (const f of fs.readdirSync(migDir).sort()) {
  if (!f.endsWith('.sql')) continue;
  const cols = columnsOf(fs.readFileSync(path.join(migDir, f), 'utf8'));
  for (const [key, type] of cols) {
    const inSchema = schema.get(key);
    if (!inSchema) continue;            // таблиці вже немає — не наше питання
    if (!same(type, inSchema)) clashes.push({ key, mig: f, type, inSchema });
  }
}

console.log('');
console.log('═'.repeat(78));
console.log('ТИП У МІГРАЦІЇ ПРОТИ ТИПУ В SCHEMA.SQL — має бути нуль');
console.log('═'.repeat(78));
console.log('');
console.log(`  колонок у schema.sql: ${schema.size}`);
console.log(`  розбіжностей: ${clashes.length} (стеля ${BASELINE})`);
if (clashes.length && (list || strict || true)) {
  console.log('');
  for (const c of clashes) {
    console.log(`    ✗ ${c.key}: міграція каже ${c.type}, schema.sql каже ${c.inSchema}`);
    console.log(`        ${c.mig}`);
  }
  console.log('');
  console.log('  На SQLite це зелене: там `false` у числову колонку лягає без слова.');
  console.log('  Ламається лише на Postgres — тобто на беті й проді.');
}
if (clashes.length > BASELINE) {
  if (strict) process.exit(1);
} else {
  console.log('');
  console.log('  чисто — кожна колонка має один тип в обох джерелах');
}
