/**
 * Ретенція знає ПРО ВСІ таблиці, які тримають дані гостя (INC-305).
 *
 *   node scripts/check-retention-tables.mjs [--strict]
 *
 * ── Що ловить ───────────────────────────────────────────────────────────
 *
 * Знеособлення перелічує таблиці поіменно, тож нова таблиця з даними гостя
 * лишається поза ним МОВЧКИ: нічого не падає, персональні дані просто
 * переживають термін зберігання. Саме так туди не потрапили `guest_consents`
 * і `consent_texts` — вони новіші за ретенцію.
 *
 * ── Стереже ВЛАСТИВІСТЬ (§3.2.1) ────────────────────────────────────────
 *
 * Твердження: **множина таблиць, що посилаються на гостя, дорівнює об'єднанню
 * трьох кошиків реєстру** — знеособлюються, видаляються, свідомо лишаються
 * (кожна з ПРИЧИНОЮ). Гейт не має списку «підозрілих» імен і не шукає
 * візерунків у SQL: він порівнює дві множини, тож будь-яка нова таблиця
 * зобов'язує автора сказати вголос, що з нею робить ретенція.
 *
 * Червоніє й на трьох тихіших випадках: таблиця названа, а в схемі її вже
 * немає; «лишаємо» без причини; і таблиця, названа у двох кошиках одразу —
 * тобто ретенція нібито і стирає її, і лишає.
 */
import fs from 'node:fs';

const STRICT = process.argv.includes('--strict');
const SCHEMA = 'db/postgres/schema.sql';
const REGISTRY = 'src/modules/guests/domain/retention-tables.ts';

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

// ── Хто в схемі тримає дані гостя ───────────────────────────────────────────
//
// `guests` — сама по собі; решта — через `guest_id`.
const holdsGuest = new Set(['guests']);
{
  let table = null;
  for (const line of fs.readFileSync(SCHEMA, 'utf8').split(/\r?\n/)) {
    const open = line.match(/^CREATE TABLE "([^"]+)" \($/);
    if (open) { table = open[1]; continue; }
    if (!table) continue;
    if (line.startsWith(')')) { table = null; continue; }
    if (/^\s+"guest_id"\s/.test(line)) holdsGuest.add(table);
  }
}

const src = strip(fs.readFileSync(REGISTRY, 'utf8'));
const listOf = (name) => {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
  return new Set(m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []);
};
const anonymised = listOf('RETENTION_ANONYMISED');
const deleted = listOf('RETENTION_DELETED');
const kept = new Map();
{
  const m = src.match(/RETENTION_KEPT[^=]*=\s*\{([\s\S]*?)\n\}/);
  if (m) for (const e of m[1].matchAll(/(\w+)\s*:\s*((?:'[^']*'\s*\+?\s*)+)/g)) {
    kept.set(e[1], [...e[2].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('').trim());
  }
}

const problems = [];
if (!anonymised.size) problems.push(`${REGISTRY}: не знайдено RETENTION_ANONYMISED`);
if (!deleted.size) problems.push(`${REGISTRY}: не знайдено RETENTION_DELETED`);

const named = new Set([...anonymised, ...deleted, ...kept.keys()]);

for (const table of [...holdsGuest].sort()) {
  if (!named.has(table)) {
    problems.push(`${table}: тримає дані гостя, але ретенція про неї не знає — `
      + 'внесіть у RETENTION_ANONYMISED / RETENTION_DELETED або назвіть у RETENTION_KEPT із причиною');
  }
}
for (const table of [...named].sort()) {
  if (!holdsGuest.has(table)) {
    problems.push(`${table}: названа в реєстрі ретенції, але в схемі не тримає даних гостя — рядок застарів`);
  }
}
for (const [table, why] of [...kept].sort()) {
  if (!why) problems.push(`${table}: «лишаємо» БЕЗ причини — це схованка, а не рішення`);
}
for (const table of [...anonymised]) {
  if (deleted.has(table) || kept.has(table)) {
    problems.push(`${table}: названа у двох кошиках одразу — ретенція нібито і стирає її, і лишає`);
  }
}
for (const table of [...deleted]) {
  if (kept.has(table)) problems.push(`${table}: і видаляється, і лишається — оберіть одне`);
}

if (problems.length) {
  console.error('\ncheck-retention-tables: ретенція знає не про всі таблиці з даними гостя\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n  у схемі тримають гостя: ${[...holdsGuest].sort().join(', ')}`);
  console.error(`  знеособлюються: ${[...anonymised].sort().join(', ') || '—'}`);
  console.error(`  видаляються:    ${[...deleted].sort().join(', ') || '—'}`);
  console.error(`  свідомо лишаються: ${[...kept.keys()].sort().join(', ') || '—'}\n`);
  process.exit(STRICT ? 1 : 0);
}
console.log(`check-retention-tables: ${holdsGuest.size} таблиць із даними гостя — `
  + `${anonymised.size} знеособлюються, ${deleted.size} видаляються, ${kept.size} лишаються (з причиною)`);
