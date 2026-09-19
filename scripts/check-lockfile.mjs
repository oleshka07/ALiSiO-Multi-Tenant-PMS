/**
 * package.json і package-lock.json кажуть одне — інакше CI не встановиться.
 *
 *   node scripts/check-lockfile.mjs --strict
 *
 * ── Чому цей гейт існує ─────────────────────────────────────────────────
 *
 * 18.09.2026 гілка стала червоною ЦІЛКОМ — усі три задачі, за 37 секунд,
 * на кроці встановлення:
 *
 *     npm error `npm ci` can only install packages when your package.json
 *     and package-lock.json are in sync.
 *     npm error Missing: jsqr@1.4.0 from lock file
 *
 * `jsqr` додався в `package.json` під новий гейт (він РОЗКОДОВУЄ QR назад),
 * а локфайл не перегенерувався. У себе це не видно взагалі: `npm install`
 * уже поклав пакет у `node_modules`, тож `tsc`, `npm run check` і живий
 * прогін усі зелені. Видно лише там, де встановлюють з нуля, — тобто в CI
 * і на сервері.
 *
 * Це рід «виміряно точно, але не те» (AGENTS §7): ми міряли машину, у якій
 * пакет уже є, і робили висновок про машину, у якій його немає.
 *
 * ── Що саме стверджується ───────────────────────────────────────────────
 *
 * Не «локфайл свіжий» — свіжість `npm` рахує сам, і питати його означало б
 * похід у реєстр із мережі. Стверджується ВЛАСТИВІСТЬ, через яку падає
 * `npm ci`: множини залежностей у двох файлах збігаються, і діапазони в них
 * однакові.
 *
 * Локфайл 3-ї версії веде в `packages[""]` дзеркало кореневого
 * `package.json`, і саме його `npm ci` звіряє першим. Плюс окремо: кожна
 * названа залежність мусить мати СВІЙ вузол `node_modules/<імʼя>` — без
 * нього встановлювати нема чого, хоч дзеркало й збігається.
 *
 * ── І ще одне, суміжне ──────────────────────────────────────────────────
 *
 * Пакет, який код імпортує НАПРЯМУ, мусить бути названий у `package.json`,
 * а не діставатись транзитивно. `pngjs` лежав у локфайлі лише тому, що його
 * тягне `pdfkit`; гейт аркуша імпортував його прямо і працював — доти, доки
 * `pdfkit` не змінить свою залежність. Тоді зламається не `pdfkit`, а наш
 * гейт, і причина буде не там, де наслідок.
 *
 * Тут перевіряються імпорти скриптів і `.check.ts` — того, що запускає
 * голий node; за прод-збірку відповідає `check-entry-imports`.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

const problems = [];
const say = (what) => problems.push(what);

// ── 1. Дзеркало кореня ──────────────────────────────────────────────────
const rootNode = lock.packages?.[''];
if (!rootNode) {
  say('у package-lock.json немає кореневого вузла packages[""] — це не локфайл 3-ї версії');
} else {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const inPkg = pkg[field] ?? {};
    const inLock = rootNode[field] ?? {};
    for (const [name, range] of Object.entries(inPkg)) {
      if (!(name in inLock)) {
        say(`${field}: «${name}» є в package.json і НЕМАЄ в локфайлі — `
          + '`npm ci` відмовиться встановлювати (запустіть `npm install`)');
      } else if (inLock[name] !== range) {
        say(`${field}: «${name}» — package.json каже ${range}, локфайл ${inLock[name]}`);
      }
    }
    for (const name of Object.keys(inLock)) {
      if (!(name in inPkg)) {
        say(`${field}: «${name}» є в локфайлі і НЕМАЄ в package.json — `
          + 'локфайл відстав від видалення');
      }
    }
  }
}

// ── 2. Вузол установки ──────────────────────────────────────────────────
//
// Дзеркало може збігатись, а самого вузла не бути — тоді `npm ci` теж
// нічого не встановить. Питається окремо, бо це ІНШЕ твердження.
for (const field of ['dependencies', 'devDependencies']) {
  for (const name of Object.keys(pkg[field] ?? {})) {
    if (!lock.packages?.[`node_modules/${name}`]) {
      say(`${field}: «${name}» названо, але вузла node_modules/${name} у локфайлі немає`);
    }
  }
}

// ── 3. Прямий імпорт — названа залежність ───────────────────────────────
//
// Транзитивний пакет працює рівно доти, доки його батько його тягне.
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(mjs|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
};

/** Коментарі геть: гейт читає код, а не текст про код. */
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

const files = [
  ...walk(path.join(ROOT, 'scripts')),
  ...walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.check.ts')),
];

const BUILTIN = /^(node:|assert$|fs$|path$|url$|crypto$|os$|util$|child_process$|module$|http$|https$|zlib$|stream$|events$|buffer$|worker_threads$|readline$|net$|tls$|timers$|perf_hooks$)/;

let scanned = 0;
for (const file of files) {
  const code = stripComments(fs.readFileSync(file, 'utf8'));
  scanned += 1;
  const specs = [
    ...code.matchAll(/(?:^|[^.\w])import\s+[^;]*?from\s+['"]([^'"]+)['"]/g),
    ...code.matchAll(/(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...code.matchAll(/(?:^|[^.\w])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]);

  for (const spec of specs) {
    // Свої шляхи й аліаси проєкту — не пакети.
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) continue;
    if (spec.startsWith('@core/') || spec.startsWith('@properties') || spec.startsWith('@')
        && !spec.includes('/') === false && declared.has(spec.split('/').slice(0, 2).join('/')) === false
        && !spec.startsWith('@types/')) {
      // Область (`@scope/name`) — беремо перші два сегменти; решта аліаси.
    }
    if (BUILTIN.test(spec)) continue;
    const name = spec.startsWith('@')
      ? spec.split('/').slice(0, 2).join('/')
      : spec.split('/')[0];
    if (declared.has(name)) continue;
    // Аліас `tsconfig.paths` — не пакет. Їх стереже `check-bare-node`.
    if (!lock.packages?.[`node_modules/${name}`]) continue;
    say(`${path.relative(ROOT, file)} імпортує «${name}» НАПРЯМУ, а в package.json його немає — `
      + 'він там транзитивно, і зникне разом зі своїм батьком');
  }
}

console.log('');
console.log('═'.repeat(78));
console.log('PACKAGE.JSON ПРОТИ ЛОКФАЙЛА — розбіжностей має бути нуль');
console.log('═'.repeat(78));
console.log('');

if (problems.length === 0) {
  const named = Object.keys(pkg.dependencies ?? {}).length
    + Object.keys(pkg.devDependencies ?? {}).length;
  console.log(`  чисто — ${named} названих залежностей, ${scanned} файлів голого node`);
  console.log('');
} else {
  for (const p of problems) console.log(`    ✗ ${p}`);
  console.log('');
  console.log(`  разом: ${problems.length}`);
  console.log('');
  console.log('  `npm ci` у CI встановлює з НУЛЯ і звіряє ці два файли першим кроком.');
  console.log('  Локально пакет уже лежить у node_modules, тож усе зелене — і саме');
  console.log('  тому це видно лише там (AGENTS §7: виміряно точно, але не те).');
  console.log('');
  if (STRICT) process.exit(1);
}
