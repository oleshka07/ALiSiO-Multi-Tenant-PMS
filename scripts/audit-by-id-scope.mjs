/**
 * Запит по чужому id: хто шукає рядок ЛИШЕ за ідентифікатором з URL.
 *
 *   node scripts/audit-by-id-scope.mjs [--json]
 *
 * Чому аудит, а не гейт. Клас знайшовся на `/api/invoices/[id]/buyer`
 * (INC-010): `SELECT … WHERE id = ?` і `UPDATE … WHERE id = ?` по рахунку,
 * ідентифікатор якого приходить з URL. На Postgres маршрут рятувала політика
 * RLS — орендар стоїть на зʼєднанні, чужий рядок не збігається; на SQLite,
 * тобто під `npm run dev`, той самий код правив чужий рахунок.
 *
 * Перший прогін знайшов 59 таких місць. Зробити з цього гейт означало б
 * червону збірку, яку ніхто не полагодить за один вечір, — а таку збірку
 * всі вчаться ігнорувати (AGENTS §4 про `npm run lint`). Тому це аудит:
 * він друкує число і список, ніколи не падає, і його читають перед тим, як
 * чіпати доступ до даних. Число може тільки меншати.
 *
 * Що НЕ є знахідкою і чому список не дорівнює списку дірок:
 *   — власність доведена вище в тому ж хендлері (`ownedReservation` тощо),
 *     а запит нижче вже працює з доведеним рядком;
 *   — id приходить із сесії, а не з URL (свій профіль, свій пароль);
 *   — рядок щойно створено в цьому ж запиті і читається назад.
 * Аудит цього не розрізняє — він звужує 707 файлів до кількох десятків
 * місць, які варто прочитати очима. Правильна відповідь на кожне —
 * або `AND organization_id = ?`, або видима перевірка власності поруч.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

// Таблиці з орендарем — зі згенерованої схеми, а не зі списку в голові.
// `\r?\n` і зріз `\r`: на Windows-копії схема лежить із CRLF, і якір `$`
// без цього не збігається жодного разу (INC-009 ч.2 — гейт, який мовчить).
const schema = fs.readFileSync(path.join(ROOT, 'db/postgres/schema.sql'), 'utf8');
const scoped = new Set();
for (const m of schema.matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\r?\n\);/g)) {
  if (/"organization_id"/.test(m[2])) scoped.add(m[1]);
}

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name) && !/\.check\.ts$/.test(entry.name)) files.push(full);
  }
})(path.join(ROOT, 'src'));

const hits = [];
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  // Лише те, що бере id З URL: саме він приходить від того, хто питає.
  if (!/params\s*:\s*(Promise<)?\{[^}]*\bid\b/.test(raw)) continue;

  // Коментарі вирізаються, інакше аудит рахує власну документацію і
  // приклади вже виправленого (AGENTS §4, остання теза).
  const src = raw.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  for (const m of src.matchAll(/(SELECT[\s\S]{0,400}?FROM|UPDATE|DELETE\s+FROM)\s+"?(\w+)"?\b([\s\S]{0,300}?)(?=`|'|")/g)) {
    const table = m[2];
    if (!scoped.has(table)) continue;
    const tail = m[3];
    if (!/WHERE/i.test(tail)) continue;
    if (/organization_id/i.test(m[0])) continue;
    if (!/\bid\s*=\s*\?/.test(tail)) continue;
    hits.push({
      file: path.relative(ROOT, file).split(path.sep).join('/'),
      line: src.slice(0, m.index).split(/\r?\n/).length,
      table,
      sql: m[0].replace(/\s+/g, ' ').slice(0, 90),
    });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ count: hits.length, hits }, null, 2));
  process.exit(0);
}

console.log('═'.repeat(78));
console.log('ЗАПИТ ПО id З URL БЕЗ ОРЕНДАРЯ — читати очима, не тривога сама по собі');
console.log('═'.repeat(78));
console.log();
console.log(`  ${scoped.size} таблиць з organization_id, ${files.length} файлів у src/`);
console.log(`  знайдено: ${hits.length} (базлайн 2026-08-29 — 59; більше = хтось додав нове)`);
console.log();

const byFile = new Map();
for (const h of hits) (byFile.get(h.file) ?? byFile.set(h.file, []).get(h.file)).push(h);
for (const [file, rows] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${file}  (${rows.length})`);
  for (const r of rows) console.log(`    :${r.line}  [${r.table}] ${r.sql}`);
}
console.log();
console.log('  Лікується або `AND organization_id = ?` у самому запиті, або');
console.log('  видимою перевіркою власності поруч. Приклад правильного —');
console.log('  src/app/api/invoices/[id]/route.ts (DELETE) і .../buyer (PATCH).');
process.exit(0);
