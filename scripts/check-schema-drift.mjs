/**
 * Чи описує schema.sql ту саму базу, яку дають міграції.
 *
 *   PGHOST=127.0.0.1 PGUSER=alisio node scripts/check-schema-drift.mjs
 *
 * Дві бази, один Postgres:
 *
 *   НОВА    тільки db/postgres/schema.sql — те, що дістає новий клієнт
 *   СТАРА   schema.sql, а зверху всі db/postgres/migrations/*.sql — те, що
 *           має середовище, яке живе давно
 *
 * Потім вони порівнюються по колонках, типах, обовʼязковості й індексах.
 * Мають збігтися до рядка. Розбіжність означає одне з двох, і обидва погані:
 * або міграція додала щось, чого немає в schema.sql (новий клієнт заводиться
 * без цього), або schema.sql має щось, чого міграція не приносить (старе
 * середовище лишається без цього назавжди).
 *
 * Навіщо це саме зараз. `schema.sql` досі ГЕНЕРУЄТЬСЯ з живої бази SQLite
 * (scripts/pg-schema.mjs), тобто джерелом істини для схеми прода є база, якої
 * на проді немає. Поки так, «схема правильна» означає «хтось не забув
 * перегенерувати». Ця перевірка ставить питання по-інакшому — до самого
 * Postgres — і саме вона має тримати схему, коли SQLite піде.
 *
 * Бета показала, у що це коштує, коли не питати: вона піднялася з 92 таблиць
 * проти 102, і жодна перевірка про це не сказала.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOST = process.env.PGHOST || '127.0.0.1';
const PORT = process.env.PGPORT || '5432';
const USER = process.env.PGUSER || 'alisio';

const psql = (db, args) => execFileSync('psql', [
  '-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-tA', ...args,
], { encoding: 'utf8', env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });

const admin = (sql) => psql('postgres', ['-c', sql]);

/** Кожну базу описуємо однаково, щоб різниця була різницею, а не форматуванням. */
const DESCRIBE = `
SELECT 'column|'||table_name||'|'||column_name||'|'||data_type||'|'||is_nullable
       ||'|'||COALESCE(column_default, '-')
  FROM information_schema.columns WHERE table_schema='public'
UNION ALL
SELECT 'index|'||tablename||'|'||indexname||'|'||regexp_replace(indexdef, '.*USING ', '')
  FROM pg_indexes WHERE schemaname='public'
UNION ALL
SELECT 'table|'||table_name FROM information_schema.tables WHERE table_schema='public'
UNION ALL
-- Обмеження порівнюються теж, і не для повноти.
--
-- Перша ж колонка, додана після появи цієї перевірки, дала ДВА однакові CHECK
-- на новій базі: у schema.sql він був безіменний, тож Postgres назвав його
-- сам, а міграція не впізнала свого імені й додала другий. Функціонально це
-- нешкідливо і саме тому лишилось би назавжди — поки хтось не прибрав би
-- один, вирішивши, що правило зникло.
SELECT 'constraint|'||conrelid::regclass::text||'|'||conname||'|'||pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE connamespace = 'public'::regnamespace AND contype IN ('c','u','f')
ORDER BY 1
`;

function build(db, withMigrations) {
  admin(`DROP DATABASE IF EXISTS ${db}`);
  admin(`CREATE DATABASE ${db}`);
  psql(db, ['-q', '-f', 'db/postgres/schema.sql']);
  if (withMigrations) {
    const dir = 'db/postgres/migrations';
    for (const m of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      psql(db, ['-q', '-f', path.join(dir, m)]);
    }
  }
  return psql(db, ['-c', DESCRIBE]).split('\n').filter(Boolean);
}

// ── Третя вісь: що САМІ МІГРАЦІЇ кажуть про типи своїх таблиць ─────────────
//
// Дві бази вище обидві починаються зі `schema.sql`, і саме тому вони не бачать
// цілого класу: якщо таблицю створює І `schema.sql`, І міграція, то на другій
// базі `CREATE TABLE IF NOT EXISTS` мовчки НІЧОГО не робить — і типи, які
// оголосила міграція, не порівнюються НІКОЛИ. Той самий обхід за іменем, що з
// констрейнтами й частковими індексами (AGENTS §4), тільки поверхом вище — на
// самій таблиці.
//
// Ціна цього класу виміряна 10.09.2026: `fin_payment_methods.settles_to_debtor`
// оголошений `BOOLEAN` у міграції 0141 і `BIGINT` у `schema.sql` (генератор
// вгадує тип за ІМЕНЕМ колонки, а це імʼя ні на що не схоже). Обидві бази вище
// збігались, гейт друкував нуль розбіжностей — а `check:pg` падав на живому
// Postgres: `invalid input syntax for type bigint: "false"`. Готель, заведений
// з нинішнього `schema.sql`, не може додати спосіб оплати взагалі.
//
// Питання, яке ставить ця вісь: ХТО ПЕРШИЙ створив таблицю, залежить від
// історії середовища — отже обидва оголошення мусять збігатися БЕЗУМОВНО.
// Розбіжність тут не «стара міграція», а дві різні бази в одного продукту.
//
// Як міряється: не розбором типів очима, а самим Postgres. Оголошення міграції
// виконується у схемі `mig` тієї ж бази, де `public` уже має `schema.sql`, і
// далі порівнюються відповіді `information_schema` з обох боків.

/** Коментарі геть — інакше дужка з коментаря зіпсує рахунок дужок. */
const stripComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

/** `CREATE TABLE …( … );` цілком — за БАЛАНСОМ ДУЖОК, не за жадібним регексом. */
function createTables(sql) {
  const out = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    const semi = sql.indexOf(';', i);
    out.push({ table: m[1], stmt: sql.slice(m.index, (semi < 0 ? i : semi) + 1) });
  }
  return out;
}

/** `ALTER TABLE … ADD COLUMN …` — разом з іменами колонок, які він додає. */
function addColumns(sql) {
  const out = [];
  const re = /ALTER\s+TABLE\s+(?:ONLY\s+)?"?([A-Za-z0-9_]+)"?\s+([^;]*ADD\s+COLUMN[^;]*);/gi;
  let m;
  while ((m = re.exec(sql))) {
    const cols = [...m[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi)]
      .map((c) => c[1]);
    if (cols.length) out.push({ table: m[1], cols, stmt: m[0] });
  }
  return out;
}

/**
 * Стеля відомих розбіжностей на 10.09.2026 — храповик, як у
 * `check-boundaries` і `audit-by-id-scope`. Нова розбіжність валить збірку;
 * виправлена ВИМАГАЄ прибрати рядок звідси, інакше гейт червоніє теж — інакше
 * список тихо застарів би і стеля перестала б бути стелею.
 *
 * Чому ці дванадцять лишились, а десять поруч виправлено міграцією 0304: там
 * оголошення міграції очевидно чинне, а вгадане ламало писача або точність
 * грошей. Тут зміна типу міняє ПОВЕДІНКУ запитів — `date` проти `text`
 * (порівняння й `substr`), `jsonb` проти `text` (оператори), обовʼязковість
 * `organizations.language` — і це рішення, а не вирівнювання.
 */
const DECLARED_KNOWN = {
  'cm_events|payload': 'міграція каже text|-|-|NO, schema.sql каже jsonb|-|-|NO',
  'cm_inbound_bookings|payload': 'міграція каже text|-|-|NO, schema.sql каже jsonb|-|-|NO',
  'cm_mappings|occupancy': 'міграція каже integer|32|0|NO, schema.sql каже bigint|64|0|NO',
  'cm_outbox|attempts': 'міграція каже integer|32|0|NO, schema.sql каже bigint|64|0|NO',
  'cm_outbox|field_mask': 'міграція каже integer|32|0|YES, schema.sql каже bigint|64|0|YES',
  'cm_sends|response_status': 'міграція каже integer|32|0|YES, schema.sql каже bigint|64|0|YES',
  'cm_sends|rows_count': 'міграція каже integer|32|0|NO, schema.sql каже bigint|64|0|NO',
  'fin_recurring_templates|failed_runs': 'міграція каже integer|32|0|NO, schema.sql каже bigint|64|0|NO',
  'organizations|language': 'міграція каже text|-|-|YES, schema.sql каже text|-|-|NO',
  'seasons|date_from': 'міграція каже date|-|-|NO, schema.sql каже text|-|-|NO',
  'seasons|date_to': 'міграція каже date|-|-|NO, schema.sql каже text|-|-|NO',
  'seasons|sort_order': 'міграція каже integer|32|0|NO, schema.sql каже bigint|64|0|NO',
};

const TYPE = `
SELECT table_schema||'|'||table_name||'|'||column_name||'|'||data_type
       ||'|'||COALESCE(numeric_precision::text,'-')||'|'||COALESCE(numeric_scale::text,'-')
       ||'|'||is_nullable
  FROM information_schema.columns WHERE table_schema IN ('public','mig')
`;

/**
 * Повертає { diffs, declared, skipped }. `skipped` друкується ЗАВЖДИ: гейт,
 * який мовчки нічого не порівняв, доповідав би «чисто» — рівно та смерть, яку
 * AGENTS §3.2.1 показує на `check-bare-node`.
 */
function declaredTypes(db) {
  psql(db, ['-c', 'CREATE SCHEMA IF NOT EXISTS mig']);
  const dir = 'db/postgres/migrations';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const declared = new Set();
  const skipped = [];
  const made = new Set();

  for (const f of files) {
    const text = stripComments(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const { table, stmt } of createTables(text)) {
      try {
        psql(db, ['-c', `SET search_path = mig, public; ${stmt}`]);
        made.add(table);
        declared.add(table);
      } catch (e) {
        skipped.push(`${f}: CREATE ${table} — ${String(e.stderr || e.message).split('\n')[0].slice(0, 90)}`);
      }
    }
    for (const { table, cols, stmt } of addColumns(text)) {
      if (!made.has(table)) {
        // Таблиця родом зі `schema.sql` — копіюємо ФОРМУ і знімаємо колонки,
        // які додає міграція, щоб її власне оголошення справді виконалось.
        try {
          // `INCLUDING ALL` — не для повноти: без ПЕРВИННОГО КЛЮЧА копії
          // `organizations` кожен `REFERENCES organizations(id)` у схемі `mig`
          // відмовляє, і 37 таблиць випадали з порівняння МОВЧКИ. Серед них —
          // рівно та, заради якої вісь заведена.
          psql(db, ['-c', `CREATE TABLE IF NOT EXISTS mig."${table}" (LIKE public."${table}" INCLUDING ALL)`]);
          made.add(table);
        } catch (e) {
          skipped.push(`${f}: ALTER ${table} — ${String(e.stderr || e.message).split('\n')[0].slice(0, 90)}`);
          continue;
        }
      }
      try {
        // CASCADE — бо це КОПІЯ у чернетковій схемі, а не жива таблиця: на
        // `reservations.is_pool_unit` висить обмеження проти подвійного
        // бронювання, і без CASCADE колонка не знімалась, тобто її оголошення
        // не порівнювалось узагалі.
        const drops = cols.map((c) => `ALTER TABLE mig."${table}" DROP COLUMN IF EXISTS "${c}" CASCADE;`).join(' ');
        psql(db, ['-c', `SET search_path = mig, public; ${drops} ${stmt}`]);
        declared.add(table);
      } catch (e) {
        skipped.push(`${f}: ADD COLUMN ${table}.${cols.join(',')} — ${String(e.stderr || e.message).split('\n')[0].slice(0, 90)}`);
      }
    }
  }

  const rows = psql(db, ['-c', TYPE]).split('\n').filter(Boolean);
  const byKey = new Map();
  for (const r of rows) {
    const [schema, table, column, ...rest] = r.split('|');
    byKey.set(`${schema}|${table}|${column}`, rest.join('|'));
  }
  const fresh = [];
  const known = [];
  const seen = new Set();
  for (const [key, mine] of byKey) {
    if (!key.startsWith('mig|')) continue;
    const bare = key.slice(4);
    const theirs = byKey.get(`public|${bare}`);
    if (theirs === undefined) continue;      // колонки немає у schema.sql — це вже ловить вісь вище
    if (theirs === mine) continue;
    const detail = `міграція каже ${mine}, schema.sql каже ${theirs}`;
    seen.add(bare);
    if (DECLARED_KNOWN[bare] === detail) known.push(`${bare}: ${detail}`);
    else fresh.push(`${bare}: ${detail}`);
  }
  // Виправлена розбіжність, яку не прибрали зі стелі, — теж червоне: інакше
  // список застаріває, і стеля перестає щось означати.
  const stale = Object.keys(DECLARED_KNOWN).filter((k) => !seen.has(k));
  return { diffs: fresh.sort(), known: known.sort(), stale, declared: declared.size, skipped };
}

let fresh;
let migrated;
try {
  fresh = build('drift_fresh', false);
  migrated = build('drift_migrated', true);
} catch (e) {
  console.error('не вдалося зібрати бази для порівняння:');
  console.error(String(e.stderr || e.message).split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

const onlyIn = (a, b) => a.filter((line) => !b.includes(line));
const missingFromSchema = onlyIn(migrated, fresh);   // міграція дала, schema.sql — ні
const missingFromMigrations = onlyIn(fresh, migrated); // schema.sql має, міграція не принесе

// Заголовок називає ПИТАННЯ, а не відповідь. Тут стояло «SCHEMA.SQL І
// МІГРАЦІЇ РОЗІЙШЛИСЯ» — і друкувалось до порівняння, тобто на зеленому
// прогоні гейт повідомляв про розбіжність, якої не було, а через рядок сам
// себе спростовував. Той самий клас, що Р11.1: текст стверджує не те, що
// сталося, і читач вірить тексту.
console.log('═'.repeat(78));
console.log('SCHEMA.SQL ПРОТИ МІГРАЦІЙ — розбіжностей має бути нуль');
console.log('═'.repeat(78));
console.log();

// Третю вісь рахуємо ЗАВЖДИ — і друкуємо її покриття теж завжди, зеленим і
// червоним однаково: «порівняно 0 таблиць» мусить бути видно, а не ховатись за
// словом «збігаються».
let decl;
try {
  decl = declaredTypes('drift_fresh');
} catch (e) {
  console.error('не вдалося порівняти оголошення міграцій:');
  console.error(String(e.stderr || e.message).split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

console.log(`  оголошення міграцій звірено на ${decl.declared} таблицях;`,
  `відомих розбіжностей ${decl.known.length} зі стелі ${Object.keys(DECLARED_KNOWN).length}`);
if (decl.skipped.length) {
  console.log(`  НЕ звірено — ${decl.skipped.length} (це втрата покриття, а не дрібниця):`);
  for (const l of decl.skipped.slice(0, 20)) console.log(`    ${l}`);
  if (decl.skipped.length > 20) console.log(`    … ще ${decl.skipped.length - 20}`);
}
console.log();

if (!missingFromSchema.length && !missingFromMigrations.length
    && !decl.diffs.length && !decl.stale.length) {
  console.log(`  збігаються — ${fresh.filter((l) => l.startsWith('table|')).length} таблиць,`,
    `${fresh.filter((l) => l.startsWith('column|')).length} колонок,`,
    `${fresh.filter((l) => l.startsWith('index|')).length} індексів,`,
    `${fresh.filter((l) => l.startsWith('constraint|')).length} обмежень`);
  process.exit(0);
}

console.log('  РОЗІЙШЛИСЯ.');
console.log();

if (missingFromSchema.length) {
  console.log('  Міграція це створює, а schema.sql — ні.');
  console.log('  Новий клієнт заведеться БЕЗ цього:');
  for (const l of missingFromSchema.slice(0, 40)) console.log(`    ${l}`);
  if (missingFromSchema.length > 40) console.log(`    … ще ${missingFromSchema.length - 40}`);
  console.log();
}
if (missingFromMigrations.length) {
  console.log('  schema.sql це має, а міграції не приносять.');
  console.log('  Середовище, яке живе давно, лишиться БЕЗ цього:');
  for (const l of missingFromMigrations.slice(0, 40)) console.log(`    ${l}`);
  if (missingFromMigrations.length > 40) console.log(`    … ще ${missingFromMigrations.length - 40}`);
  console.log();
}

if (decl.stale.length) {
  console.log('  Ці розбіжності ВИПРАВЛЕНО, а зі стелі не прибрано.');
  console.log('  Приберіть рядки з DECLARED_KNOWN — стеля мусить опускатись:');
  for (const l of decl.stale) console.log(`    ${l}`);
  console.log();
}
if (decl.diffs.length) {
  console.log('  Міграція і schema.sql оголошують РІЗНІ типи для тієї самої колонки.');
  console.log('  Яке з двох оголошень чинне — залежить від того, що в базі було');
  console.log('  раніше. Тобто це дві різні бази в одного продукту:');
  for (const l of decl.diffs.slice(0, 40)) console.log(`    ${l}`);
  if (decl.diffs.length > 40) console.log(`    … ще ${decl.diffs.length - 40}`);
  console.log();
}

console.log(`  разом розбіжностей: ${missingFromSchema.length + missingFromMigrations.length + decl.diffs.length + decl.stale.length}`);
process.exit(1);
