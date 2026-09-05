/**
 * Екран не вигадує власних кольорів — він бере токен (UI-LANGUAGE §2, П11, П18).
 *
 *   node scripts/check-ui-tokens.mjs            # звіт: скільки літералів кольору в кожному файлі
 *   node scripts/check-ui-tokens.mjs --strict   # храповик: ріст валить збірку
 *
 * ── Чим це ламається ────────────────────────────────────────────────────
 *
 * 05.09.2026 продукт отримав другу тему (світла за замовчуванням, темна
 * перемикачем — П18). Тема — це другий набір ЗНАЧЕНЬ тих самих токенів у
 * `globals.css`; екран, який написав `color: '#fff'` або
 * `background: 'rgba(52,211,153,0.15)'`, у другій темі лишається з кольором
 * першої: білий текст на білому тлі, темна плашка на світлій картці. Такого
 * коду на день появи теми було 1846 місць у 116 файлах екранів — і жоден
 * гейт про це не казав.
 *
 * ── Що рахується ────────────────────────────────────────────────────────
 *
 * Літерал кольору в коді екрана (`src/app/app/**`, `src/components/**`,
 * `src/ui/**`, `src/modules/*\/ui/**`): `#rgb`/`#rrggbb`/`#rrggbbaa`,
 * `rgb(`/`rgba(`, `hsl(`/`hsla(`. Коментарі вирізаються (AGENTS §4). CSS не
 * рахується — `globals.css` і є місцем, де кольори живуть, а віджет і гостьова
 * сторінка мають власні токени (`--bk-*`, `--gp-*`).
 *
 * ── Храповик, не мета ───────────────────────────────────────────────────
 *
 * BASELINE нижче — скільки літералів мав кожен файл у день, коли гейт став
 * блокувати. Це стеля: файл із більшим числом валить збірку і називається;
 * файл із меншим — теж, з проханням опустити стелю, щоб прогрес не відкотився
 * мовчки. Файл, якого в списку немає, народжується зі стелею нуль. Нуль усюди
 * недосяжний сьогодні — і це нормально; недосяжним має лишатися РІСТ.
 *
 * Червоним до появи BASELINE: з порожнім списком кожен файл був понад стелю
 * (116 файлів, 1846 місць) — саме так доведено, що гейт уміє червоніти.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOTS = ['src/app/app', 'src/components', 'src/ui'];
const MODULE_UI = fs.existsSync('src/modules')
  ? fs.readdirSync('src/modules').map((m) => `src/modules/${m}/ui`).filter((p) => fs.existsSync(p))
  : [];

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(e.name) && !/\.check\.tsx?$/.test(e.name)) yield p;
  }
}

/** Порядково: рядок, що починається з `//` або `/*`, — проза; хвостовий коментар лишається. */
function stripComments(s) {
  const out = [];
  let inBlock = false;
  for (const line of s.replace(/\r\n/g, '\n').split('\n')) {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      inBlock = false;
      out.push(line.slice(end + 2));
      continue;
    }
    const t = line.trimStart();
    if (t.startsWith('//')) continue;
    if (t.startsWith('/*') || t.startsWith('{/*')) {
      const end = t.indexOf('*/', 2);
      if (end === -1) { inBlock = true; continue; }
      out.push(t.slice(end + 2));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

const counts = new Map();
for (const root of [...ROOTS, ...MODULE_UI]) {
  if (!fs.existsSync(root)) continue;
  for (const f of walk(root)) {
    const n = (stripComments(fs.readFileSync(f, 'utf8')).match(COLOR) ?? []).length;
    if (n > 0) counts.set(f.split(path.sep).join('/'), n);
  }
}

// ── BASELINE — стелі на день, коли гейт став блокувати (05.09.2026) ────────
// Опускається, коли файл почистили; підвищується — ніколи (новий колір бере
// токен). Файл, якого тут немає, має стелю нуль.
const BASELINE_FILE = new URL('./check-ui-tokens.baseline.json', import.meta.url);
const BASELINE = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {};

const total = [...counts.values()].reduce((a, b) => a + b, 0);
const over = [];
const under = [];
for (const [f, n] of [...counts.entries()].sort()) {
  const ceiling = BASELINE[f] ?? 0;
  if (n > ceiling) over.push({ f, n, ceiling });
  else if (n < ceiling) under.push({ f, n, ceiling });
}
for (const f of Object.keys(BASELINE)) {
  if (!counts.has(f) && BASELINE[f] > 0) under.push({ f, n: fs.existsSync(f) ? 0 : -1, ceiling: BASELINE[f] });
}

console.log(`ui-tokens: ${total} літералів кольору у ${counts.size} файлах екранів (стеля: ${Object.values(BASELINE).reduce((a, b) => a + b, 0)} у ${Object.keys(BASELINE).length})`);
if (!STRICT) {
  for (const [f, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${f}`);
  process.exit(0);
}

if (over.length) {
  console.error(`\n  ✗ ${over.length} файл(ів) вигадали кольорів понад стелю — новий колір бере токен із globals.css (var(--…)), не літерал:`);
  for (const { f, n, ceiling } of over) console.error(`      ${f}: ${n} (стеля ${ceiling})`);
}
if (under.length) {
  console.error(`\n  ✗ ${under.length} файл(ів) стали ЧИСТІШИМИ за стелю — опустіть стелю в scripts/check-ui-tokens.baseline.json, щоб прогрес не відкотився мовчки:`);
  for (const { f, n, ceiling } of under) console.error(`      ${f}: ${n < 0 ? 'файла немає' : n} (стеля ${ceiling})`);
}
if (over.length || under.length) process.exit(1);
console.log(`  чисто — жоден екран не перевищив стелі (${counts.size} файлів)`);
