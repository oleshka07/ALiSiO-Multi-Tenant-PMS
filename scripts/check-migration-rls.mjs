/**
 * Таблиця з віссю орендаря, заведена МІГРАЦІЄЮ, має в тій же міграції пояс.
 *
 *   node scripts/check-migration-rls.mjs
 *   node scripts/check-migration-rls.mjs --strict     # у npm run check і в CI
 *
 * ── Що сталося, двічі за дві доби ───────────────────────────────────────
 *
 * У нас дві бази, і вони народжуються по-різному:
 *
 *   СВІЖА (новий клієнт) — `db/postgres/schema.sql`, який ГЕНЕРУЄТЬСЯ, і
 *     генератор ставить `ENABLE`/`FORCE`/політику сам, механічно, кожній
 *     таблиці з `organization_id`;
 *   МІГРОВАНА (бета, прод) — послідовність `db/postgres/migrations/*.sql`,
 *     які пише людина.
 *
 * Тобто пояс на свіжій базі зʼявляється САМ, а на мігрованій — лише якщо про
 * нього згадали. Забути можна рівно в один бік, і забули двічі:
 *
 *   `platform_memberships` (0134, INC-101) — 10.09.2026;
 *   `company_rate_plans`  (0200, INC-206) — 11.09.2026.
 *
 * Обидва рази розбіжність знайшла репетиція злиття
 * (`deploy/rehearse-merge.sh`) словами `tables without row-level security`, і
 * обидва рази вона тримала `beta → main`.
 *
 * ── Чому цього не бачить жодна сцена ────────────────────────────────────
 *
 * Бо політика — ДРУГИЙ пояс. Код, який несе `organization_id` у кожному
 * запиті явно, тримає вісь сам, і сцена на базі без політики зелена — так і
 * має бути. Другий пояс існує для писача, який ЗАВТРА забуде орендаря в
 * підзапиті: на свіжій базі його зловить політика, на мігрованій — ніщо.
 *
 * Властивість, яку не видно, поки тримає інша, гейтом на поведінці не
 * доводиться. Зате вона доводиться на ТЕКСТІ: у міграції, що заводить
 * таблицю з `organization_id`, мусить бути рядок про RLS на цю ж таблицю.
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 * ВЛАСТИВІСТЬ, не візерунок: для КОЖНОЇ `CREATE TABLE`, у чиєму тілі є
 * колонка `organization_id`, у ТОМУ Ж файлі є `ENABLE ROW LEVEL SECURITY` на
 * ту саму таблицю. Не «чи схоже це на вчорашню помилку», а «чи виконується
 * твердження» — тож нова таблиця під новим іменем ловиться так само.
 *
 * Гейт навмисно НЕ розуміє SQL. Він не парсер: він не пускає таблицю з віссю
 * орендаря без пояса. Хибно-червоне лікується рядком у `EXCEPTIONS` із
 * причиною — так само, як виняток у `rls-check.sql`.
 *
 * Коментарі вирізаються перед пошуком (AGENTS §4): інакше гейт рахував би
 * власну документацію і прозу міграцій, де ці слова згадуються.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'db/postgres/migrations');

/** SQL без коментарів: `--` до кінця рядка і блокові `/* … *\/`. */
const stripSql = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

/**
 * Таблиці, які мають `organization_id` і свідомо живуть БЕЗ політики.
 *
 * Список НЕ дублюється тут: він читається з `db/postgres/rls-check.sql` —
 * того самого місця, куди дивиться репетиція злиття. Дві копії одного списку
 * розійдуться, і тоді гейт або пропустить те, що ловить репетиція, або
 * червонітиме на тому, що вона вже визнала винятком.
 *
 * Причина кожного винятку написана там же, поруч із іменем, і читається при
 * наступному розборі.
 */
function namedExceptions() {
  const src = fs.readFileSync(path.join(ROOT, 'db/postgres/rls-check.sql'), 'utf8');
  const start = src.indexOf("c.relname NOT IN (");
  if (start < 0) return null;
  const end = src.indexOf(');', start);
  if (end < 0) return null;
  const block = stripSql(src.slice(start, end));
  return new Set([...block.matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map((m) => m[1]));
}
const EXCEPTIONS = namedExceptions();
if (!EXCEPTIONS) {
  console.error('check-migration-rls: не вдалося прочитати список винятків із rls-check.sql');
  process.exit(strict ? 1 : 0);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

const offenders = [];
let created = 0;
let scoped = 0;
let excused = 0;

for (const file of files) {
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  const sql = stripSql(raw);

  // `CREATE TABLE [IF NOT EXISTS] name (…)` — імʼя з лапками або без.
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi;
  for (const m of sql.matchAll(re)) {
    created++;
    const name = m[1];

    // Тіло таблиці — до дужки, що закриває відкриту в `m`. Балансом, а не
    // «до першої `)`»: усередині бувають REFERENCES(…) і CHECK(…).
    let depth = 0, i = m.index + m[0].length - 1, end = -1;
    for (; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = end > 0 ? sql.slice(m.index, end) : sql.slice(m.index, m.index + 4000);
    if (!/\borganization_id\b/.test(body)) continue;
    scoped++;

    if (EXCEPTIONS.has(name)) { excused++; continue; }

    // Дві форми, і обидві законні. ПРЯМА: `ALTER TABLE "t" ENABLE …`.
    // ДИНАМІЧНА: `EXECUTE format('ALTER TABLE %I ENABLE …', tbl)` у циклі по
    // масиву імен — так написані 0013, 0015, 0024, 0027, і вони НЕ порушення.
    // Перша редакція гейта знала лише пряму й почервоніла на одинадцятьох
    // старих міграціях. Це хибно-червоне, і лікується воно в гейті (§3.2.1,
    // випадок 7), а не правкою одинадцяти чужих міграцій і не глушником.
    const direct = new RegExp(
      `ALTER\\s+TABLE\\s+"?${name}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(sql);
    const dynamic = /EXECUTE\s+format\(\s*'ALTER TABLE %I ENABLE ROW LEVEL SECURITY'/i.test(sql)
      && new RegExp(`'${name}'`).test(sql);
    if (!direct && !dynamic) offenders.push({ file, name });
  }
}

console.log('═'.repeat(78));
console.log('ПОЯС ОРЕНДАРЯ В МІГРАЦІЇ — таблиця з organization_id без RLS');
console.log('═'.repeat(78));
console.log();
console.log(`  міграцій:                 ${files.length}`);
console.log(`  CREATE TABLE усього:      ${created}`);
console.log(`  з них з organization_id:  ${scoped}`);
console.log(`  оголошено винятком:       ${excused}`);
console.log(`  без пояса:                ${offenders.length}`);

if (offenders.length) {
  console.log();
  for (const o of offenders) console.log(`  ${o.file}\n      ${o.name} — немає ENABLE ROW LEVEL SECURITY`);
}

console.log();

if (!offenders.length) {
  console.log(`check-migration-rls: ${scoped} тенантних таблиць у міграціях, кожна з поясом`);
  process.exit(0);
}

if (strict) {
  console.log('ЗБІРКА ЗУПИНЕНА:');
  console.log('  Свіжа база дістане політику від генератора, мігрована — ні, і дві');
  console.log('  бази розійдуться. Репетиція злиття впаде словами');
  console.log('  `tables without row-level security`, а до того захисту не буде');
  console.log('  саме там, де живі дані.');
  console.log();
  console.log('  Полагодження — дописати в ТУ Ж міграцію, формою з генератора:');
  console.log('    ALTER TABLE "<t>" ENABLE ROW LEVEL SECURITY;');
  console.log('    ALTER TABLE "<t>" FORCE ROW LEVEL SECURITY;');
  console.log('    DROP POLICY IF EXISTS "<t>_tenant" ON "<t>";');
  console.log('    CREATE POLICY "<t>_tenant" ON "<t>"');
  console.log("      USING (\"organization_id\" = current_setting('app.organization_id'))");
  console.log("      WITH CHECK (\"organization_id\" = current_setting('app.organization_id'));");
  console.log();
  console.log('  Якщо пояса немає СВІДОМО — рядок у EXCEPTIONS цього гейта з причиною.');
  console.log();
  process.exit(1);
}

process.exit(0);
