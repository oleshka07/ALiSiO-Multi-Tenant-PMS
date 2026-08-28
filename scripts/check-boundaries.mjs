/**
 * How isolated is each module, as a number rather than an opinion?
 *
 *   node scripts/check-boundaries.mjs
 *   node scripts/check-boundaries.mjs bookings   # what holds one module in place
 *
 * A module is isolated when deleting its directory breaks the build in exactly
 * zero places outside it. Until that is true, "we could pull this out later" is
 * a guess. This counts the places, names them, and separates the two kinds:
 *
 *   через фасад   an import from '@crm' — the module's front door. Fine by
 *                 design, and cheap to cut: it is one import line.
 *   ПРОБІЙ        an import that reaches past the front door into data/,
 *                 domain/ or events/, or a raw SQL query against a table the
 *                 module owns. This is what makes removal expensive, and it is
 *                 what the tsconfig aliases exist to prevent.
 *
 * A module has TWO front doors, not one. '@mod' carries server code and pulls
 * in better-sqlite3, so a 'use client' component can never import it; React
 * components therefore come from 'modules/mod/ui/…' directly, and that path
 * counts as the front door rather than a breach.
 *
 * Read the second number. The first is the size of the seam; the second is
 * whether there is a seam at all.
 *
 * --strict is a RATCHET, not a target. The BASELINE below is how many
 * breaches each module had the day the gate started blocking (2026-08-27) —
 * a ceiling, not a goal. One more breach fails the build and names the file;
 * one less fails too, asking to lower the ceiling, so progress locks in and
 * cannot silently slide back. Zero is unreachable today and that is fine;
 * what must stay unreachable is growth. A module absent from the list has a
 * ceiling of zero: a new module is born isolated.
 *
 * The numbers in ARCHITECTURE §8 drifted within two weeks of being written —
 * dashboard and channels each grew a breach, guests grew two, and nothing
 * said so. That drift is why this is a gate now and not a report.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASELINE = {
  auth: 0,
  bookings: 3,
  channels: 1,
  dashboard: 1,
  events: 1,
  // 15 → 4: фактурування виїхало в @invoicing, і разом із ним 11 місць, де
  // маршрути документів лізли в нутрощі обліку. Те, що лишилось, — облік і є.
  finance: 4,
  // Стартова стеля нового модуля. Обидва пробої — SQL до таблиць
  // фактурування ззовні: PDF-маршрут читає fin_folios сам, а аркуші дня
  // рахують ПДВ прямо з fin_invoice_tax_totals. Обидва старші за розділення
  // й обидва лікуються запитом до фасаду, а не переїздом файлу.
  invoicing: 2,
  guests: 8,
  pricing: 6,
  // 9 → 7: групові броні видалено, і разом із ними два екрани, які лізли в
  // modules/properties повз фасад (GroupBookingModal, GroupViewModal).
  properties: 7,
  reports: 0,
  tasks: 1,
  widget: 6,
};

const MODULES = fs.readdirSync('src/modules', { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name);

const args = process.argv.slice(2);
const strict = args.includes('--strict');
// In strict mode every module is compared against its ceiling; a single-module
// run would make the absent ones look like stale baseline entries.
const only = strict ? undefined : args.find((a) => !a.startsWith('--'));

const FILES = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx|mjs)$/.test(e.name)) continue;
    FILES.push([p.replace(/\\/g, '/').replace(/^\.\//, ''), fs.readFileSync(p, 'utf8')]);
  }
})('.');

/**
 * A module owns a table when it is the ONLY module that writes to it.
 *
 * Merely writing to it is not ownership: finance updates
 * reservations.payment_status, which would make reservations finance's property
 * and turn every screen showing a booking into a boundary breach. A shared
 * table is shared vocabulary, and reading one is not reaching into a module.
 */
/** Prose is not SQL: `// Update tentative → confirmed` named a table for a while. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const WRITERS = new Map(); // table -> Set<module>, or the marker 'ЗЗОВНІ'
for (const [f, text] of FILES) {
  const m = f.match(/^src\/modules\/([^/]+)\//);
  // A write from a route file, a page or a script belongs to no module — and a
  // table written from there is not any module's private property, however it
  // looks from inside one.
  const owner = m ? m[1] : 'ЗЗОВНІ';
  for (const w of stripComments(text).matchAll(/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE)\s+["'`]?([a-z_0-9]+)/gi)) {
    const t = w[1].toLowerCase();
    // `UPDATE a SET …` is an alias inside a longer statement, not a table.
    if (t.length <= 2) continue;
    if (!WRITERS.has(t)) WRITERS.set(t, new Set());
    WRITERS.get(t).add(owner);
  }
}

function tablesOf(mod) {
  return new Set(
    [...WRITERS].filter(([, mods]) => mods.size === 1 && mods.has(mod)).map(([t]) => t),
  );
}

const report = [];

for (const mod of MODULES) {
  if (only && mod !== only) continue;

  const owned = tablesOf(mod);
  const viaFacade = [];
  const breaches = [];

  for (const [f, text] of FILES) {
    if (f.startsWith(`src/modules/${mod}/`)) continue;
    // The schema file names every table by definition; that is its job, not a
    // reach into anyone. It is the one place a table exists before a module.
    if (f === 'src/lib/db.ts') continue;

    // Front door: '@mod' for server code, 'modules/mod/ui/…' for React.
    const front = new RegExp(`['"](?:@${mod}(?:/[^'"]*)?|[^'"]*modules/${mod}/ui/[^'"]*)['"]`);
    if (front.test(text)) viaFacade.push(f);

    // Past the front door. `import(…)` counts as much as `from …` — a
    // dynamic() import of a module's internals is the same reach, just later.
    const deep = new RegExp(`(?:from|import\\()\\s*['"][^'"]*modules/${mod}/(data|domain|events)/`);
    if (deep.test(text)) breaches.push(`${f} — імпорт нутрощів`);

    // Someone else's SQL against a table this module owns.
    for (const t of owned) {
      const sql = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+["'\`]?${t}\\b`, 'i');
      if (sql.test(text)) { breaches.push(`${f} — SQL до ${t}`); break; }
    }
  }

  report.push({ mod, facade: viaFacade.length, breaches, files: viaFacade });
}

report.sort((a, b) => (a.breaches.length - b.breaches.length) || (a.facade - b.facade));

console.log('═'.repeat(78));
console.log('МЕЖІ МОДУЛІВ — скільки місць поза модулем зламається при видаленні');
console.log('═'.repeat(78));
console.log();
console.log('  модуль          через фасад   пробоїв');
for (const r of report) {
  const flag = r.breaches.length === 0 ? (r.facade === 0 ? '  ізольований' : '') : '  ← тримає';
  console.log(`  ${r.mod.padEnd(16)}${String(r.facade).padStart(6)}${String(r.breaches.length).padStart(10)}${flag}`);
}
console.log();

if (only) {
  const r = report[0];
  if (r.files.length) {
    console.log(`Через фасад '@${only}' (${r.files.length}):`);
    for (const f of r.files) console.log(`  ${f}`);
    console.log();
  }
  if (r.breaches.length) {
    console.log(`Пробої (${r.breaches.length}):`);
    for (const b of r.breaches) console.log(`  ${b}`);
  }
} else {
  console.log('Деталі по одному модулю:  node scripts/check-boundaries.mjs <модуль>');
}

if (strict) {
  const problems = [];

  for (const r of report) {
    const ceiling = BASELINE[r.mod] ?? 0;
    const now = r.breaches.length;
    if (now > ceiling) {
      problems.push(
        `  ${r.mod}: пробоїв ${now}, стеля ${ceiling} — НОВИЙ ПРОБІЙ. Модуль відкривають лише його фасади` +
        ` ('@${r.mod}' і modules/${r.mod}/ui/); знайдіть свій серед:`,
      );
      for (const b of r.breaches) problems.push(`      ${b}`);
    } else if (now < ceiling) {
      problems.push(
        `  ${r.mod}: пробоїв ${now}, стеля ${ceiling} — стало КРАЩЕ. Опустіть стелю: у BASELINE` +
        ` (scripts/check-boundaries.mjs) поставте ${r.mod}: ${now}, щоб прогрес не відкотився мовчки.`,
      );
    }
  }

  for (const mod of Object.keys(BASELINE)) {
    if (!MODULES.includes(mod)) {
      problems.push(`  ${mod}: є в BASELINE, але src/modules/${mod} не існує — приберіть застарілий запис.`);
    }
  }

  console.log();
  if (problems.length) {
    console.log('ХРАПОВИК МЕЖ — збірка зупинена:');
    for (const p of problems) console.log(p);
    console.log();
    console.log('  Пробій — це імпорт modules/<x>/(data|domain|events) ззовні або SQL до таблиці,');
    console.log('  якою володіє лише той модуль. Правильні двері — фасад @<x> або modules/<x>/ui/.');
    process.exit(1);
  }
  const total = report.reduce((n, r) => n + r.breaches.length, 0);
  console.log(`  храповик меж: пробої не зросли (${total} по ${report.length} модулях, у межах стелі)`);
}
