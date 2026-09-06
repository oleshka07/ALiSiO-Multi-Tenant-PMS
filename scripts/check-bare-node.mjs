/**
 * Скрипт оператора, який ламається об аліас — мовчки і повністю.
 *
 *   node scripts/check-bare-node.mjs [--strict]
 *
 * Чому це існує. `scripts/provision-org.mjs` — це заведення НОВОГО ГОТЕЛЯ, і
 * виконує його на сервері голий node: без Next, без webpack, без резолвера
 * `tsconfig.paths`. 06.09.2026 в `src/core/provisioning.ts` зʼявився один
 * рядок `import { seedAmenityCatalog } from '@properties'` — законний за
 * `check-boundaries` (це фасад!), зелений у `tsc`, зелений у `npm run check`
 * (усі перевірки ходять через резолвер аліасів `scripts/lib/module-aliases.mjs`)
 * і смертельний на сервері: `Invalid module "@properties" is not a valid
 * package name`. Тобто зламалось не «щось у зручностях», а заведення клієнта
 * цілком. Спіймав це лише живий крок CI.
 *
 * Гейт ставить межу там, де вона справді проходить, — не «в ядрі не буває
 * аліасів» (буває: `src/core/currency.ts` імпортує `@core/db/async`, і це
 * нормально, бо його вантажать лише скрипти з резолвером), а:
 *
 *   1. Скрипт, який імпортує `../src/…` БЕЗ власного `registerHooks`, тягне
 *      за собою граф файлів — і в жодному з них не має бути жодного аліаса з
 *      `tsconfig.paths`. Граф обходиться справді, по відносних імпортах:
 *      саме так `provisioning.ts` дістав `@properties` через два кроки від
 *      входу.
 *   2. Скрипт, який імпортує `../src/modules/…`, зобовʼязаний мати власний
 *      `registerHooks`. Модулі користуються аліасами всюди, і сподіватись, що
 *      конкретна гілка графа їх не має, — це чекати наступного `55df209`.
 *      Сьогодні такі скрипти два: `apply-hotel.mjs` і `seed-demo-stays.mjs`,
 *      і обидва резолвер мають.
 *
 * Стеля нульова від початку: сьогодні порушень нуль, тож будь-яке нове —
 * червоне. Це не храповик, бо тут немає чого списувати: скрипт або
 * запускається на сервері, або ні.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const problems = [];

// ── аліаси з tsconfig ───────────────────────────────────────────────────────
const rawTsconfig = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const ALIASES = Object.keys(JSON.parse(rawTsconfig).compilerOptions?.paths ?? {});
const isAlias = (spec) => ALIASES.some((a) => (a.endsWith('/*') ? spec.startsWith(a.slice(0, -1)) : spec === a));

/**
 * Коментарі вирізаються ДО пошуку — інакше перевірка рахує власні приклади й
 * чужі пояснення (AGENTS §4, три випадки за одну сесію).
 *
 * Порядково, як у `check-boundaries.mjs`, і з тієї ж причини — я наступила на
 * ту саму міну, поки писала цей файл. Регулярка `/\/\*[\s\S]*?\*\//` відкриває
 * «коментар» на РЯДКУ `'/*'` у `scripts/seed-demo-stays.mjs` (там
 * `pattern.endsWith('/*')`) і зʼїдає шістдесят рядків коду разом із
 * `registerHooks` та імпортами модулів. Перший прогін цього гейта показав
 * «7 скриптів, чисто» і не побачив восьмого взагалі — тобто мовчазно
 * пропустив рівно те, заради чого написаний.
 */
const stripComments = (src) => {
  const out = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      inBlock = false;
      out.push(line.slice(end + 2));
      continue;
    }
    const t = line.trimStart();
    if (t.startsWith('//')) continue;
    if (t.startsWith('/*')) {
      const end = t.indexOf('*/', 2);
      if (end === -1) { inBlock = true; continue; }
      out.push(t.slice(end + 2));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
};

/**
 * Специфікатори імпорту файла, з поділом на статичні й динамічні.
 *
 * Поділ тут не косметичний. Статичний `import … from '@core/x'` node
 * резолвить при завантаженні файла — тобто скрипт падає, ще нічого не
 * зробивши, і саме так упав `provision-org.mjs`. Динамічний
 * `() => import('…')` резолвиться, лише коли гілку справді викликали, і в
 * `src/lib/db.ts` таких кілька: фонові такти (`tick('Recurring', () =>
 * import('../modules/finance/…'))`) не виконуються за коротке життя скрипта
 * оператора. Обходити граф по динамічних ребрах означало б доповісти про
 * 78 «падінь» у коді, який працює щодня, — а гейт, який кричить на
 * робочому коді, вчить його ігнорувати.
 */
function imports(src) {
  const stat = [];
  const dyn = [];
  const code = stripComments(src);
  for (const [re, bucket] of [
    [/\bfrom\s+['"]([^'"]+)['"]/g, stat],
    [/(?:^|[\s;{])import\s+['"]([^'"]+)['"]/gm, stat],
    [/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, dyn],
    [/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, dyn],
  ]) {
    let m;
    while ((m = re.exec(code)) !== null) bucket.push(m[1]);
  }
  return { stat, dyn, all: [...stat, ...dyn] };
}

/** Відносний специфікатор → файл на диску (розширення node не добирає). */
function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`,
    path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// ── скрипти, які вантажать код застосунку ───────────────────────────────────
const scripts = fs.readdirSync(path.join(ROOT, 'scripts'))
  .filter((f) => /\.mjs$/.test(f))
  .map((f) => path.join(ROOT, 'scripts', f));

const inventory = [];

for (const file of scripts) {
  const src = fs.readFileSync(file, 'utf8');
  const code = stripComments(src);
  const appImports = imports(src).all.filter((s) => /^\.\.\/src\//.test(s));
  if (appImports.length === 0) continue;

  const hasHooks = /\bregisterHooks\s*\(/.test(code);
  const touchesModules = appImports.some((s) => s.startsWith('../src/modules/'));
  inventory.push({ file: rel(file), hasHooks, touchesModules, entries: appImports.length });

  // Правило 2: модулі — лише з власним резолвером.
  if (touchesModules && !hasHooks) {
    problems.push(`${rel(file)}: вантажить ../src/modules/… без власного registerHooks — на сервері це впаде на першому ж аліасі`);
    continue;
  }
  if (hasHooks) continue;

  // Правило 1: граф голого скрипта не містить аліасів.
  const seen = new Set();
  const queue = [];
  for (const spec of appImports) {
    const entry = resolveRelative(file, spec);
    if (entry) queue.push({ file: entry, chain: [rel(file)] });
    else problems.push(`${rel(file)}: імпорт "${spec}" не знайдено на диску`);
  }

  while (queue.length) {
    const { file: current, chain } = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const here = [...chain, rel(current)];
    // Лише статичні ребра: їх node резолвить, коли вантажить файл, тож вони
    // виконуються ЗАВЖДИ, а динамічні — лише якщо гілку викликали.
    for (const spec of imports(fs.readFileSync(current, 'utf8')).stat) {
      if (isAlias(spec)) {
        problems.push(`${here.join(' → ')}: аліас "${spec}" — резолвера в цьому ланцюжку немає, голий node на ньому впаде`);
        continue;
      }
      if (!spec.startsWith('.')) continue; // пакет із node_modules — node сам знайде
      const next = resolveRelative(current, spec);
      if (next) queue.push({ file: next, chain: here });
    }
  }
}

// ── звіт ────────────────────────────────────────────────────────────────────
console.log('check-bare-node');
for (const s of inventory.sort((a, b) => a.file.localeCompare(b.file))) {
  const how = s.hasHooks ? 'свій резолвер' : 'голий node';
  console.log(`  ${s.hasHooks ? '·' : '!'}  ${s.file} — ${how}, ${s.entries} вхід(ів)${s.touchesModules ? ', модулі' : ''}`);
}

if (problems.length === 0) {
  console.log(`  чисто — ${inventory.length} скриптів вантажать застосунок, жоден не спіткнеться об аліас`);
  process.exit(0);
}

console.log('');
for (const p of problems) console.log(`  ✗  ${p}`);
console.log(`\n  ${problems.length} порушень — стеля нульова`);
process.exit(STRICT ? 1 : 0);
