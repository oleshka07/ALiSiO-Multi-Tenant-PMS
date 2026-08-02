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
 *                 domain/ or ui/, or a raw SQL query against a table the module
 *                 owns. This is what makes removal expensive, and it is what
 *                 the tsconfig aliases exist to prevent.
 *
 * Read the second number. The first is the size of the seam; the second is
 * whether there is a seam at all.
 */
import fs from 'node:fs';
import path from 'node:path';

const MODULES = fs.readdirSync('src/modules', { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name);

const only = process.argv[2];

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
const WRITERS = new Map(); // table -> Set<module>
for (const [f, text] of FILES) {
  const m = f.match(/^src\/modules\/([^/]+)\//);
  if (!m) continue;
  for (const w of text.matchAll(/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE)\s+["'`]?([a-z_0-9]+)/gi)) {
    const t = w[1].toLowerCase();
    if (!WRITERS.has(t)) WRITERS.set(t, new Set());
    WRITERS.get(t).add(m[1]);
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

    // Front door: import ... from '@mod' or '@mod/...'
    if (new RegExp(`from\\s+['"]@${mod}(?:/[^'"]*)?['"]`).test(text)) viaFacade.push(f);

    // Past the front door: a relative or aliased path into the module's guts.
    const deep = new RegExp(`from\\s+['"][^'"]*modules/${mod}/(data|domain|ui|events)/`);
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
