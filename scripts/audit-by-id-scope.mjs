/**
 * Запит по чужому id: хто шукає рядок ЛИШЕ за ідентифікатором з URL.
 *
 *   node scripts/audit-by-id-scope.mjs            # звіт: число і список
 *   node scripts/audit-by-id-scope.mjs --strict   # ХРАПОВИК, бігає в npm run check
 *   node scripts/audit-by-id-scope.mjs --json
 *
 * Клас знайшовся на `/api/invoices/[id]/buyer` (INC-010): `SELECT … WHERE
 * id = ?` і `UPDATE … WHERE id = ?` по рахунку, ідентифікатор якого приходить
 * з URL. На Postgres маршрут рятувала політика RLS — орендар стоїть на
 * зʼєднанні, чужий рядок не збігається; на SQLite, тобто під `npm run dev`,
 * той самий код правив чужий рахунок.
 *
 * ── Чому ХРАПОВИК, а не «має бути нуль» ─────────────────────────────────
 *
 * Перший прогін знайшов 59 місць у 15 файлах. Вимагати нуля сьогодні
 * означало б червону збірку, яку ніхто не полагодить за вечір, — а таку
 * збірку всі вчаться ігнорувати (те саме міркування, через яке в CI немає
 * `npm run lint`). Тому BASELINE нижче — це СТЕЛЯ кожного файла на день
 * увімкнення, а не мета:
 *
 *   — на одне місце більше → збірка падає і називає файл: нове порушення
 *     не проходить ніколи, навіть у файлі, де вже є старі;
 *   — на одне менше → збірка теж падає і просить опустити стелю: полагоджене
 *     фіксується і не може тихо повернутись;
 *   — файла немає в списку → стеля нуль: новий маршрут народжується з
 *     орендарем у запиті.
 *
 * Той самий механізм, що в `check-boundaries.mjs`, і з тієї ж причини: числа
 * в документації дрейфують за два тижні, числа в гейті — ні.
 *
 * ── Що НЕ є знахідкою (тому 59 ≠ 59 дірок) ──────────────────────────────
 *   — власність доведена вище в тому ж хендлері (`ownedReservation` тощо),
 *     а запит нижче вже працює з доведеним рядком;
 *   — id приходить із сесії, а не з URL (свій профіль, свій пароль);
 *   — рядок щойно створено в цьому ж запиті і читається назад.
 * Гейт цього не розрізняє — він тримає межу і звужує 707 файлів до 15,
 * які читаються очима. Правильна відповідь на кожне — або
 * `AND organization_id = ?`, або видима перевірка власності поруч.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

// Стеля кожного файла на 2026-08-29 — день, коли гейт почав блокувати.
// Це НЕ мета: мета нуль. Змінювати вниз — разом із виправленням; угору —
// ніколи (саме це гейт і тримає).
const BASELINE = {
  'src/modules/bookings/api/reservation.handlers.ts': 13,
  'src/modules/finance/api/operations.handlers.ts': 13,
  'src/modules/widget/api/widget-reserve.handlers.ts': 8,
  // Свій профіль: id приходить із сесії того, хто питає. Найімовірніші
  // кандидати на «списати зі стелі» після прочитання очима.
  'src/modules/auth/api/user.handlers.ts': 5,
  'src/modules/finance/api/exchange-rates.handlers.ts': 4,
  'src/modules/bookings/api/reservation-registrations.handlers.ts': 3,
  'src/app/api/payments/[id]/route.ts': 2,
  'src/modules/bookings/api/sub-bookings.handlers.ts': 2,
  'src/modules/channels/api/ical-channel.handlers.ts': 2,
  'src/modules/finance/api/attachments.handlers.ts': 2,
  'src/app/api/gift-cards/[id]/activate/route.ts': 1,
  'src/app/api/gift-cards/[id]/route.ts': 1,
  'src/modules/finance/api/recurring.handlers.ts': 1,
  'src/modules/invoicing/api/invoices.handlers.ts': 1,
  'src/modules/widget/api/site-analytics.handlers.ts': 1,
};

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

const byFile = new Map();
for (const h of hits) (byFile.get(h.file) ?? byFile.set(h.file, []).get(h.file)).push(h);

// ── Храповик ────────────────────────────────────────────────────────────────
// Обидва боки навмисно: ріст — нове порушення, спад — привід зафіксувати
// перемогу. Стеля, яку не опустили після виправлення, через місяць знову
// дозволяє те, що вже полагодили.
if (STRICT) {
  const grown = [];
  const shrunk = [];
  for (const [file, rows] of byFile) {
    const ceiling = BASELINE[file] ?? 0;
    if (rows.length > ceiling) grown.push({ file, now: rows.length, ceiling, rows });
  }
  for (const [file, ceiling] of Object.entries(BASELINE)) {
    const now = byFile.get(file)?.length ?? 0;
    if (now < ceiling) shrunk.push({ file, now, ceiling });
  }

  if (grown.length === 0 && shrunk.length === 0) {
    console.log('by-id-scope');
    console.log(`  чисто — ${hits.length} місць у ${byFile.size} файлах, усі в межах стелі`);
    console.log('');
    process.exit(0);
  }

  console.log('ЗАПИТ ПО id З URL БЕЗ ОРЕНДАРЯ — храповик зрушився');
  console.log('');
  for (const g of grown) {
    console.log(`  ${g.file}: ${g.now}, стеля ${g.ceiling} — НОВЕ ПОРУШЕННЯ.`);
    console.log('    Додайте `AND organization_id = ?` (значення з actor.organizationId)');
    console.log('    або перевірку власності поруч. Шукайте своє серед:');
    for (const r of g.rows) console.log(`      :${r.line}  [${r.table}] ${r.sql}`);
  }
  for (const s of shrunk) {
    console.log(`  ${s.file}: було ${s.ceiling}, стало ${s.now} — ОПУСТІТЬ СТЕЛЮ`);
    console.log(`    у BASELINE цього файла: ${s.now === 0 ? 'приберіть рядок' : `${s.now},`}`);
  }
  console.log('');
  console.log('  Зразок правильного: src/app/api/invoices/[id]/route.ts (DELETE)');
  console.log('  і src/app/api/invoices/[id]/buyer/route.ts (PATCH) — INC-010.');
  process.exit(1);
}

console.log('═'.repeat(78));
console.log('ЗАПИТ ПО id З URL БЕЗ ОРЕНДАРЯ — читати очима, не тривога сама по собі');
console.log('═'.repeat(78));
console.log();
console.log(`  ${scoped.size} таблиць з organization_id, ${files.length} файлів у src/`);
console.log(`  знайдено: ${hits.length} у ${byFile.size} файлах; стелі тримає --strict`);
console.log();

for (const [file, rows] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  const ceiling = BASELINE[file] ?? 0;
  console.log(`  ${file}  (${rows.length}, стеля ${ceiling})`);
  for (const r of rows) console.log(`    :${r.line}  [${r.table}] ${r.sql}`);
}
console.log();
console.log('  Лікується або `AND organization_id = ?` у самому запиті, або');
console.log('  видимою перевіркою власності поруч. Приклад правильного —');
console.log('  src/app/api/invoices/[id]/route.ts (DELETE) і .../buyer (PATCH).');
process.exit(0);
