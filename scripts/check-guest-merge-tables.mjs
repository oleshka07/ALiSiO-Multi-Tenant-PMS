/**
 * Злиття гостей знає ПРО ВСІ таблиці, які на гостя посилаються (INC-300).
 *
 *   node scripts/check-guest-merge-tables.mjs [--strict]
 *
 * ── Що ловить ───────────────────────────────────────────────────────────
 *
 * `mergeGuests` переносить рядки за списком таблиць. Список — дані, і саме
 * тому його можна забути поповнити: наступна таблиця з `guest_id` мовчки
 * лишиться позаду, злиття «спрацює», а рядки в ній і далі вказуватимуть на
 * людину, якої більше не показують у списках. Дізнаються про це тоді, коли
 * туди заглянуть, — тобто у виданому документі.
 *
 * ── Стереже ВЛАСТИВІСТЬ, а не візерунок (§3.2.1) ────────────────────────
 *
 * Твердження: **множина таблиць зі стовпцем `guest_id` у `schema.sql`
 * дорівнює об'єднанню двох списків у `guest-merge.repo.ts`** — тих, що
 * переносяться, і тих, що свідомо НЕ переносяться разом із причиною.
 *
 * Тобто гейт не шукає знайомих імен і не має списку «підозрілих» таблиць.
 * Він порівнює дві множини, і будь-яка нова таблиця з посиланням на гостя
 * зобов'язує автора сказати вголос, що з нею робити. Сказати «не переносимо»
 * дозволено — промовчати не можна.
 *
 * Червоніє у трьох випадках, і третій найтихіший:
 *
 *   1. таблиця з `guest_id` не названа в жодному зі списків;
 *   2. у списках названа таблиця, у якої `guest_id` уже немає (список гниє,
 *      і `UPDATE` по неї впав би на першому ж злитті);
 *   3. таблиця названа «не переносимо» без причини — порожній рядок замість
 *      довода перетворює свідоме рішення на схованку.
 */
import fs from 'node:fs';

const STRICT = process.argv.includes('--strict');
const SCHEMA = 'db/postgres/schema.sql';
const REPO = 'src/modules/guests/data/guest-merge.repo.ts';

/** Вирізати коментарі — інакше гейт рахує власну документацію. */
const stripJs = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');

// ── Хто в схемі носить посилання на гостя ───────────────────────────────────
const withGuestId = new Set();
{
  let table = null;
  for (const line of fs.readFileSync(SCHEMA, 'utf8').split(/\r?\n/)) {
    const open = line.match(/^CREATE TABLE "([^"]+)" \($/);
    if (open) { table = open[1]; continue; }
    if (!table) continue;
    if (line.startsWith(')')) { table = null; continue; }
    if (/^\s+"guest_id"\s/.test(line)) withGuestId.add(table);
  }
}

// ── Що про них знає злиття ──────────────────────────────────────────────────
const repo = stripJs(fs.readFileSync(REPO, 'utf8'));

const movedBlock = repo.match(/MOVED_TO_KEPT_GUEST[^=]*=\s*\[([\s\S]*?)\]/);
const notMovedBlock = repo.match(/NOT_MOVED[^=]*=\s*\{([\s\S]*?)\n\}/);

const problems = [];
if (!movedBlock) problems.push(`${REPO}: не знайдено списку MOVED_TO_KEPT_GUEST`);
if (!notMovedBlock) problems.push(`${REPO}: не знайдено списку NOT_MOVED`);

const moved = new Set(
  movedBlock ? [...movedBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []);

/** Ім'я → причина. Порожня причина — це не причина. */
const notMoved = new Map();
if (notMovedBlock) {
  for (const m of notMovedBlock[1].matchAll(/(\w+)\s*:\s*'([^']*)'/g)) {
    notMoved.set(m[1], m[2].trim());
  }
}

// ── Три твердження ──────────────────────────────────────────────────────────
for (const table of [...withGuestId].sort()) {
  if (!moved.has(table) && !notMoved.has(table)) {
    problems.push(`${table}: носить guest_id, але злиття про неї не знає — `
      + 'внесіть у MOVED_TO_KEPT_GUEST або назвіть у NOT_MOVED із причиною');
  }
}
for (const table of [...moved].sort()) {
  if (!withGuestId.has(table)) {
    problems.push(`${table}: у списку перенесення, але guest_id у схемі немає — `
      + 'UPDATE по неї впаде на першому ж злитті');
  }
}
for (const [table, why] of [...notMoved].sort()) {
  if (!withGuestId.has(table)) {
    problems.push(`${table}: названа «не переносимо», але guest_id у схемі немає — рядок застарів`);
  } else if (!why) {
    problems.push(`${table}: названа «не переносимо» БЕЗ причини — це схованка, а не рішення`);
  }
}

if (problems.length) {
  console.error('\ncheck-guest-merge-tables: злиття гостей знає не про всі таблиці\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n  у схемі з guest_id: ${[...withGuestId].sort().join(', ')}`);
  console.error(`  переносяться:       ${[...moved].sort().join(', ')}`);
  console.error(`  свідомо ні:         ${[...notMoved.keys()].sort().join(', ') || '—'}\n`);
  process.exit(STRICT ? 1 : 0);
}

console.log(`check-guest-merge-tables: ${withGuestId.size} таблиць із guest_id — `
  + `${moved.size} переносяться, ${notMoved.size} свідомо ні (з причиною)`);
