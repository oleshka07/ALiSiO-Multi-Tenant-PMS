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
 *   1. **Власні статичні імпорти скрипта** ніколи не аліаси — навіть якщо
 *      резолвер у ньому є. Статичний імпорт node резолвить ДО того, як
 *      виконається перший рядок тіла, тобто до `registerHooks`.
 *   2. Скрипт БЕЗ власного `registerHooks` тягне за собою граф файлів — і в
 *      жодному з них немає жодного аліаса з `tsconfig.paths`.
 *   3. Скрипт, який вантажить `../src/modules/…`, зобовʼязаний мати власний
 *      резолвер. Модулі користуються аліасами всюди, і сподіватись, що
 *      конкретна гілка графа їх не має, — це чекати наступного `55df209`.
 *      Сьогодні такі скрипти два: `apply-hotel.mjs` і `seed-demo-stays.mjs`.
 *
 * ── Чому розбір, а не регулярки (рецензія раунду 6, п. 3.3) ───────────────
 *
 * Перша редакція шукала імпорти регулярками і мала три дірки, кожну з яких
 * рецензія відкрила однією правкою:
 *
 *   — `import … from '@properties'` ПЕРШИМ РЯДКОМ самого скрипта: гейт
 *     дивився лише на файли, до яких скрипт дотягується, а не на нього;
 *   — `const late = await import('@properties')` на верхньому рівні файла
 *     графа: виконується при завантаженні точнісінько як статичний, а
 *     «динамічні не рахуємо» відкидало його разом із лінивими;
 *   — `fs.readdirSync('scripts')` без рекурсії.
 *
 * Відрізнити «динамічний імпорт верхнього рівня» від «динамічного всередині
 * функції» регуляркою не можна: для цього треба знати, чи він у тілі функції,
 * а це синтаксис, а не текст. Тому файли розбирає TypeScript — той самий, що
 * вже стоїть у репозиторії і бігає в CI. Ліниве ребро (`() => import(…)`,
 * фонові такти `db.ts`) лишається незарахованим свідомо: воно виконується,
 * лише коли гілку викликали, і рахувати його означало б доповісти про
 * 78 «падінь» у коді, який працює щодня.
 *
 * Стеля нульова від початку: сьогодні порушень нуль, тож будь-яке нове —
 * червоне. Це не храповик, бо тут немає чого списувати: скрипт або
 * запускається на сервері, або ні.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const problems = [];

// ── аліаси з tsconfig ───────────────────────────────────────────────────────
const rawTsconfig = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const ALIASES = Object.keys(JSON.parse(rawTsconfig).compilerOptions?.paths ?? {});
const isAlias = (spec) => ALIASES.some((a) => (a.endsWith('/*') ? spec.startsWith(a.slice(0, -1)) : spec === a));

const isFunctionLike = (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
  || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
  || ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isConstructorDeclaration(node);

/**
 * Імпорти файла: статичні, динамічні верхнього рівня і ліниві.
 *
 * `eager` — те, що node виконає, просто завантаживши файл: статичні імпорти,
 * `export … from`, `require()` і `await import()` поза будь-якою функцією.
 * `lazy` — динамічні всередині функції: вони можуть не виконатись ніколи.
 */
function imports(file) {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : undefined);
  const eagerStatic = [];
  const eagerDynamic = [];
  const lazy = [];

  const literal = (node) => (node && ts.isStringLiteralLike(node) ? node.text : null);

  const walk = (node, insideFunction) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const spec = literal(node.moduleSpecifier);
      if (spec) eagerStatic.push(spec);
    } else if (node.kind === ts.SyntaxKind.CallExpression
      && (node.expression?.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const spec = literal(node.arguments?.[0]);
      if (spec) (insideFunction ? lazy : eagerDynamic).push(spec);
    }
    const nowInside = insideFunction || isFunctionLike(node);
    ts.forEachChild(node, (child) => walk(child, nowInside));
  };
  ts.forEachChild(source, (child) => walk(child, false));

  return { eagerStatic, eagerDynamic, lazy, eager: [...eagerStatic, ...eagerDynamic],
    all: [...eagerStatic, ...eagerDynamic, ...lazy], text };
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
//
// Рекурсивно: `scripts/lib/` теж скрипти, і завтра там може зʼявитись вхід.
function allScripts(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allScripts(full));
    else if (/\.(mjs|js|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const scripts = allScripts(path.join(ROOT, 'scripts')).sort();
const inventory = [];

for (const file of scripts) {
  const own = imports(file);
  const appImports = own.all.filter((s) => /(^|\/)\.\.\/src\//.test(s) || s.startsWith('../src/'));
  const ownAliases = own.eagerStatic.filter(isAlias);
  if (appImports.length === 0 && ownAliases.length === 0) continue;

  const hasHooks = /\bregisterHooks\s*\(/.test(own.text);
  const touchesModules = appImports.some((s) => s.startsWith('../src/modules/'));
  inventory.push({ file: rel(file), hasHooks, touchesModules, entries: appImports.length });

  // Правило 1: власні СТАТИЧНІ імпорти — ніколи не аліас.
  //
  // Резолвер тут не рятує за побудовою: `registerHooks` — це рядок у тілі
  // файла, а статичні імпорти node резолвить до того, як тіло почалось.
  for (const spec of ownAliases) {
    problems.push(`${rel(file)}: власний статичний імпорт "${spec}" — аліас; node резолвить його ДО registerHooks, тож скрипт не стартує`);
  }

  // Правило 3: модулі — лише з власним резолвером.
  if (touchesModules && !hasHooks) {
    problems.push(`${rel(file)}: вантажить ../src/modules/… без власного registerHooks — на сервері це впаде на першому ж аліасі`);
    continue;
  }
  if (hasHooks) continue;

  // Правило 2: граф голого скрипта не містить аліасів.
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
    // Ребра, які node пройде, просто завантаживши файл: статичні і динамічні
    // ВЕРХНЬОГО РІВНЯ. Ліниві (`() => import(…)`) не рахуються.
    for (const spec of imports(current).eager) {
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
