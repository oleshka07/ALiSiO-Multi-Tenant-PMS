/**
 * Екран, який ПИШЕ і не читає відповідь.
 *
 *   node scripts/check-unread-write-response.mjs           # звіт
 *   node scripts/check-unread-write-response.mjs --strict   # храповик у npm run check
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 * Властивість одна: **відповідь на запис читається**. `await fetch(…, {method:
 * 'POST'|'PUT'|'PATCH'|'DELETE'})`, результат якого нікуди не звʼязано, — це
 * екран, який не може знати, чи відбувся запис. Він однаково показує успіх на
 * 200 і на 400.
 *
 * Це не стилістика. Названа відмова писача (`refuse`) існує рівно для того,
 * щоб її ПРОЧИТАЛА людина; викинута відповідь робить усю цю роботу невидимою,
 * і зверху екран ще й бреше підтвердженням.
 *
 * ── Звідки правило ──────────────────────────────────────────────────────
 *
 * `settings/properties/page.tsx` зберігав правку обʼєкта голим `await fetch`
 * без `res.ok` і показував «Обʼєкт оновлено!» на 400 — тобто на будь-якій
 * названій відмові: рід житла поза переліком, слово поза словником політики
 * виселення. Оператор бачив підтвердження там, де не збереглося нічого.
 * Створення в тому самому файлі, за пʼятнадцять рядків нижче, робило це
 * правильно з самого початку (рецензія раунду 20, П1).
 *
 * ── Чому храповик, а не «нуль» ──────────────────────────────────────────
 *
 * На день заведення таких місць **59** у 26 файлах — це не 59 однакових вад:
 * частина з них дійсно «вистрелив і забув» (лічильник переглядів, аналітика),
 * частина — справжня брехня екрана. Розібрати їх можна лише очима й по одному,
 * а межу тримає машина: стеля кожного файла зафіксована, нове порушення валить
 * збірку, виправлене вимагає ОПУСТИТИ стелю, новий файл народжується зі
 * стелею нуль. Той самий механізм, що `audit-by-id-scope` і `check-ui-tokens`.
 *
 * ── Чого гейт НЕ бачить, і це названо ───────────────────────────────────
 *
 * Він бачить «результат звʼязано», а не «результат осмислено прочитано»:
 * `const res = await fetch(…)` без жодного `res.ok` нижче гейт пропустить.
 * Це свідома межа першої редакції — вона тримає рівно той клас, який стався,
 * і не вдає, ніби тримає ширший.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const BASELINE = 'scripts/check-unread-write-response.baseline.json';
const ROOTS = ['src/app', 'src/components', 'src/modules'];

/** Виклик `fetch(` цілком — за балансом дужок, а не за першою закривною. */
function callBody(source, openParen) {
  let depth = 0;
  for (let j = openParen; j < source.length; j += 1) {
    if (source[j] === '(') depth += 1;
    else if (source[j] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParen, j + 1);
    }
  }
  return source.slice(openParen);
}

const MUTATING = /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/;
// `x = await fetch(`, `const x = await fetch(`, `return await fetch(`,
// `(await fetch(…)).json()` — усе це читання результату.
const BOUND = /(?:=|return|\(|,|\?\?|\|\||&&|:)\s*$/;

function scan() {
  const perFile = new Map();
  const places = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf8');
      const re = /await\s+fetch\s*\(/g;
      let m;
      while ((m = re.exec(source))) {
        const call = callBody(source, m.index + m[0].length - 1);
        if (!MUTATING.test(call)) continue;
        const before = source.slice(Math.max(0, m.index - 40), m.index);
        if (BOUND.test(before)) continue;
        const line = source.slice(0, m.index).split('\n').length;
        const rel = full.split(path.sep).join('/');
        perFile.set(rel, (perFile.get(rel) ?? 0) + 1);
        places.push(`${rel}:${line}`);
      }
    }
  };
  for (const root of ROOTS) if (fs.existsSync(root)) walk(root);
  return { perFile, places };
}

const { perFile, places } = scan();
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};

console.log('═'.repeat(78));
console.log('ЗАПИС, ЧИЮ ВІДПОВІДЬ НЕ ЧИТАЮТЬ — екран однаково показує успіх на 200 і на 400');
console.log('═'.repeat(78));
console.log();

if (!STRICT) {
  for (const p of places) console.log(`  ${p}`);
  console.log(`\n  ${places.length} місць у ${perFile.size} файлах`);
  console.log('  Стеля кожного файла — у ' + BASELINE);
  process.exit(0);
}

const problems = [];
for (const [file, count] of [...perFile].sort()) {
  const ceiling = baseline[file] ?? 0;
  if (count > ceiling) {
    problems.push(`${file}: ${count} проти стелі ${ceiling} — новий запис, чию відповідь не читають`);
  } else if (count < ceiling) {
    problems.push(`${file}: ${count} проти стелі ${ceiling} — полагоджено, але стелю не опущено. `
      + `Впишіть ${count} у ${BASELINE}: інакше наступне порушення пройде під старою стелею`);
  }
}
for (const file of Object.keys(baseline)) {
  if (!perFile.has(file) && baseline[file] > 0) {
    problems.push(`${file}: порушень немає, а стеля ${baseline[file]} — приберіть рядок із ${BASELINE}`);
  }
}

if (problems.length === 0) {
  console.log(`  у межах стелі — ${places.length} місць у ${perFile.size} файлах`);
  process.exit(0);
}
for (const p of problems) console.log(`  ${p}`);
console.log(`\n  ${problems.length} — храповик тримає межу, а список читається очима поступово.`);
process.exit(1);
