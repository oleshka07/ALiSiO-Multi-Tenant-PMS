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
  'src/modules/finance/api/operations.handlers.ts': 7,
  'src/modules/widget/api/widget-reserve.handlers.ts': 8,
  // Свій профіль: id приходить із сесії того, хто питає. Найімовірніші
  // кандидати на «списати зі стелі» після прочитання очима.
  'src/modules/auth/api/user.handlers.ts': 5,
  'src/modules/finance/api/exchange-rates.handlers.ts': 4,
  'src/modules/bookings/api/reservation-registrations.handlers.ts': 3,
  // `src/app/api/payments/[id]/route.ts` мав тут 2 — обидва пішли 07.09
  // (Р8.7): маршрут більше не має власного SQL, він кличе
  // `deletePaymentOperation`, а там орендар у WHERE обох запитів.
  'src/modules/bookings/api/sub-bookings.handlers.ts': 2,
  'src/modules/channels/api/ical-channel.handlers.ts': 2,
  'src/modules/finance/api/attachments.handlers.ts': 2,
  'src/app/api/gift-cards/[id]/activate/route.ts': 1,
  'src/app/api/gift-cards/[id]/route.ts': 1,
  'src/modules/finance/api/recurring.handlers.ts': 1,
  'src/modules/invoicing/api/invoices.handlers.ts': 1,
  'src/modules/widget/api/site-analytics.handlers.ts': 1,
};

// ── Друга вісь: ПИСАЧ без орендаря, звідки б id не прийшов ──────────────────
//
// Вісь вище питає лише про `params: { id }` — id з URL. Але id приходить і з
// ТІЛА запиту, і тоді файл не має жодного `params`, і гейт його не бачить
// взагалі. Саме так пройшов `payment-status.repo.ts` (Р8.8): він бере
// `reservationId` аргументом — а аргумент приходить із тіла PATCH-у, — і писав
// `UPDATE reservations SET payment_status = ? WHERE id = ?`. На Postgres
// рятувала політика; на SQLite, тобто під `npm run dev` і в CI-задачі, що
// піднімає застосунок, чужий ідентифікатор правив ЧУЖУ бронь.
//
// Тому друга вісь дивиться на все `src/` і лише на ЗАПИСИ: `UPDATE`/`DELETE`
// до таблиці з орендарем із `WHERE id = ?` без `organization_id`. Читання сюди
// свідомо не входить — їх на порядок більше, і храповик, який ніхто не подужає,
// вчить ігнорувати збірку (те саме міркування, що про `npm run lint` у CI).
// Ціна помилки теж різна: читання без орендаря віддає чуже, запис — псує.
//
// Ключ не лише `id = ?`, а БУДЬ-ЯКИЙ `<щось>_id = ?`. Перша редакція вимагала
// межі слова перед `id`, тож `WHERE reservation_id = ?` не бачила взагалі — а
// це той самий клас: чужий ідентифікатор броні у писачі без орендаря псує
// чужий рядок так само, як чужий `id`. Знайшлося рецензією на власному коміті
// (Р10.10), не гейтом.
//
// Стеля кожного файла на 2026-09-07, день увімкнення другої осі; 45 → 55 після
// розширення ключа того ж дня.
const WRITE_BASELINE = {
  'src/modules/auth/api/user.handlers.ts': 5,
  'src/lib/db.ts': 5,                                          // міграції: орендаря ще немає
  'src/modules/channels/data/inbound-bookings.repo.ts': 4,
  'src/modules/widget/api/widget-reserve.handlers.ts': 4,
  'src/modules/finance/api/categories.handlers.ts': 3,
  'src/modules/finance/api/operations.handlers.ts': 1,
  'src/modules/finance/data/recurring-engine.ts': 1,
  'src/modules/auth/api/language.handlers.ts': 2,
  'src/modules/finance/api/projects.handlers.ts': 2,
  'src/modules/finance/api/exchange-rates.handlers.ts': 2,
  'src/modules/finance/api/counterparties.handlers.ts': 2,
  'src/modules/channels/api/ical-sync.handlers.ts': 2,
  'src/modules/channels/api/ical-channel.handlers.ts': 2,
  'src/modules/reports/data/partner-report.repo.ts': 2,
  'src/modules/bookings/api/reservation-registrations.handlers.ts': 2,
  'src/modules/bookings/api/reservation.handlers.ts': 2,
  'src/modules/guests/data/registration.repo.ts': 2,
  'src/modules/auth/api/login.handlers.ts': 1,
  'src/modules/finance/api/attachments.handlers.ts': 1,
  'src/modules/invoicing/data/reservation-invoice.repo.ts': 1,
  'src/modules/bookings/api/sub-bookings.handlers.ts': 1,
  'src/modules/pricing/data/rate-plans.repo.ts': 1,
  'src/modules/pricing/data/seasons.repo.ts': 1,
  'src/modules/guests/data/guest-portal.repo.ts': 1,
  'src/core/i18n/resolve.ts': 1,
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
const writeHits = [];
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  // Вісь 1 — лише те, що бере id З URL: саме він приходить від того, хто питає.
  const fromUrl = /params\s*:\s*(Promise<)?\{[^}]*\bid\b/.test(raw);

  // Коментарі вирізаються, інакше аудит рахує власну документацію і
  // приклади вже виправленого (AGENTS §4, остання теза).
  const src = raw.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  for (const m of src.matchAll(/(SELECT[\s\S]{0,400}?FROM|UPDATE|DELETE\s+FROM)\s+"?(\w+)"?\b([\s\S]{0,300}?)(?=`|'|")/g)) {
    const table = m[2];
    if (!scoped.has(table)) continue;
    const tail = m[3];
    if (!/WHERE/i.test(tail)) continue;
    if (/organization_id/i.test(m[0])) continue;
    // Дві осі — два ключі, і це навмисно. Перша (id з URL) лишається на
    // `id = ?`: її стеля читається очима вже другий тиждень, і розширювати
    // ключ там означало б перевідкрити 60 місць. Друга (писач) бере будь-який
    // `<щось>_id = ?` — чужий ідентифікатор броні псує чужий рядок так само.
    const byBareId = /\bid\s*=\s*\?/.test(tail);
    const byAnyId = /(?:\b|_)id\s*=\s*\?/.test(tail);
    if (!byAnyId) continue;
    const hit = {
      file: rel,
      line: src.slice(0, m.index).split(/\r?\n/).length,
      table,
      sql: m[0].replace(/\s+/g, ' ').slice(0, 90),
    };
    if (fromUrl && byBareId) hits.push(hit);
    // Вісь 2 — ПИСАЧ, звідки б id не прийшов: тіло запиту дає точно такий
    // самий чужий ідентифікатор, а `params` у файлі при цьому немає взагалі.
    if (/^(UPDATE|DELETE)/i.test(m[1])) writeHits.push(hit);
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ count: hits.length, hits, writes: { count: writeHits.length, hits: writeHits } }, null, 2));
  process.exit(0);
}

const byFile = new Map();
for (const h of hits) (byFile.get(h.file) ?? byFile.set(h.file, []).get(h.file)).push(h);
const byWriteFile = new Map();
for (const h of writeHits) (byWriteFile.get(h.file) ?? byWriteFile.set(h.file, []).get(h.file)).push(h);

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
  // Друга вісь — той самий храповик, свій список стель.
  for (const [file, rows] of byWriteFile) {
    const ceiling = WRITE_BASELINE[file] ?? 0;
    if (rows.length > ceiling) grown.push({ file, now: rows.length, ceiling, rows, axis: 'писач' });
  }
  for (const [file, ceiling] of Object.entries(WRITE_BASELINE)) {
    const now = byWriteFile.get(file)?.length ?? 0;
    if (now < ceiling) shrunk.push({ file, now, ceiling, axis: 'писач', list: 'WRITE_BASELINE' });
  }

  if (grown.length === 0 && shrunk.length === 0) {
    console.log('by-id-scope');
    console.log(`  чисто — id з URL: ${hits.length} місць у ${byFile.size} файлах;`);
    console.log(`         писачі по id: ${writeHits.length} у ${byWriteFile.size} файлах — усі в межах стелі`);
    console.log('');
    process.exit(0);
  }

  console.log('ЗАПИТ ПО id БЕЗ ОРЕНДАРЯ — храповик зрушився');
  console.log('');
  for (const g of grown) {
    console.log(`  ${g.file}: ${g.now}, стеля ${g.ceiling} — НОВЕ ПОРУШЕННЯ${g.axis ? ` (вісь «${g.axis}»)` : ''}.`);
    console.log('    Додайте `AND organization_id = ?` (значення з actor.organizationId)');
    console.log('    або перевірку власності поруч. Шукайте своє серед:');
    for (const r of g.rows) console.log(`      :${r.line}  [${r.table}] ${r.sql}`);
  }
  for (const s of shrunk) {
    console.log(`  ${s.file}: було ${s.ceiling}, стало ${s.now} — ОПУСТІТЬ СТЕЛЮ`);
    console.log(`    у ${s.list ?? 'BASELINE'} цього файла: ${s.now === 0 ? 'приберіть рядок' : `${s.now},`}`);
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
