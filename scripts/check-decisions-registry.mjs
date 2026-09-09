/**
 * Номер у журналі рішень означає ОДНЕ рішення.
 *
 *   node scripts/check-decisions-registry.mjs [--strict]
 *
 * Дефект, після якого це написано (Р13.3): 08.09.2026 дві сесії дописали в
 * `docs/DECISIONS.md` по два рядки за одну добу, і номери зіткнулися — «Д28»
 * стояв двічі (засів осей плану рахунків / засів живе тільки в
 * `provisionOrganization`) і «Д29» двічі (належність посилань / заборона
 * `organizations LIMIT 1`). Півдоби реєстр мав два різні рішення під одним
 * іменем.
 *
 * Чому це не косметика. Номер — те, на що посилаються КОМІТИ і коментарі в
 * коді: «Д29» у коментарі `requireOwnedReferences` мусить вести рівно в один
 * рядок. Реєстр, у якому номер неоднозначний, гірший за відсутній рівно так
 * само, як неточна документація (AGENTS §2): за ним ухвалюють рішення.
 *
 * Чому саме гейт, а не уважність. Обидві сесії читали файл перед записом і
 * обидві взяли «наступний вільний номер» — просто в різних копіях гілки, і
 * зіткнення зʼявилось при злитті, де його ніхто вже не читав. Уважність не
 * масштабується на паралельну роботу; лічильник масштабується.
 *
 * Гейт стверджує ВЛАСТИВІСТЬ («номер веде в один рядок»), не форму таблиці:
 * префікс будь-який (Д, Ц, В, Ч…), номер будь-який, порядок рядків не
 * важливий. Червоне — рівно одне: два рядки з тим самим іменем.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'docs', 'DECISIONS.md');

const text = fs.readFileSync(FILE, 'utf8');

// Рядок реєстру: `| Д28 | …` або `| Д20 (Ч7) | …`. Уточнення в дужках —
// частина назви джерела, а не номера, тож у ключ воно не входить: саме воно
// відрізняє «Д20 (Ч7)» від можливого «Д20» і зробило б зіткнення невидимим.
const ROW = /^\|\s*([А-ЯҐЄІЇA-Z]{1,2})(\d{1,4})\s*(?:\([^)]*\))?\s*\|/;

const seen = new Map();
const clashes = [];
let rows = 0;

text.split('\n').forEach((line, i) => {
  const m = ROW.exec(line);
  if (!m) return;
  rows += 1;
  const key = `${m[1]}${m[2]}`;
  const where = i + 1;
  if (seen.has(key)) clashes.push({ key, first: seen.get(key), second: where });
  else seen.set(key, where);
});

if (rows === 0) {
  // Порожній розбір — це зламаний гейт, а не чистий реєстр (AGENTS §3.2).
  console.log('check-decisions-registry: ЧЕРВОНЕ — у docs/DECISIONS.md не розібрано жодного рядка реєстру');
  process.exit(1);
}

if (clashes.length > 0) {
  console.log(`check-decisions-registry: ЧЕРВОНЕ — ${clashes.length} номер(ів) означають більше ніж одне рішення\n`);
  for (const c of clashes) {
    console.log(`  ${c.key}: docs/DECISIONS.md:${c.first} і :${c.second}`);
  }
  console.log('\n  Розвести: ПІЗНІШИЙ за часом рядок дістає новий номер, старший лишається на місці.');
  console.log('  Нічого не видаляти — на номер посилаються коміти (інваріант реєстру).\n');
  if (strict) process.exit(1);
} else {
  console.log(`check-decisions-registry: ${rows} рішень, кожен номер веде рівно в один рядок`);
}
