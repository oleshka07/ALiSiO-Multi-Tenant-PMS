/**
 * Is anybody's business written into the source?
 *
 *   node scripts/check-no-tenant-names.mjs
 *
 * The first customer's name, domain, company and category vocabulary were
 * spread across 188 places: payment routing keyed on two literal site ids,
 * CORS allowlists naming one staging host, invoices printing one company's
 * IČO and bank account, guests welcomed to a Czech campsite by every hotel.
 *
 * Each one is invisible until a second customer hits it, and by then it is
 * their invoice or their guest's card statement. So it is a build check, not
 * a code review item. A name that has to stay (a legal document, a historical
 * comment) goes in ALLOWED with the reason.
 */
import fs from 'node:fs';
import path from 'node:path';

// Names, domains and vocabulary belonging to one customer rather than the product.
const FORBIDDEN = [
  /kemp[\s-]?carlsbad/i,
  /kempcarlsbad/i,
  /kemptimebot/i,
  /qa[\s-]glamping/i,
  /quiet\s+anomaly/i,
  /onrender\.com/i,
];

// Path → why the name is allowed to remain there.
const ALLOWED = new Map([
  ['src/modules/widget/data/site.repo.ts', 'documents the hardcodes it replaced'],
  ['src/app/privacy/page.tsx', 'legal text — needs a lawyer, not a sed'],
  ['scripts/check-no-tenant-names.mjs', 'this file lists them on purpose'],
  ['docs/SECURITY-FINDINGS.md', 'the findings record'],
]);

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', 'data'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx|mjs|json)$/.test(e.name)) continue;
    files.push(p.replace(/\\/g, '/'));
  }
})('src');
for (const extra of ['scripts', 'db']) {
  if (fs.existsSync(extra)) (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|mjs|sql)$/.test(e.name)) continue;
      files.push(p.replace(/\\/g, '/'));
    }
  })(extra);
}

const hits = [];
for (const f of files) {
  if (ALLOWED.has(f)) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const re of FORBIDDEN) {
      if (re.test(line)) { hits.push({ f, n: i + 1, line: line.trim().slice(0, 100) }); break; }
    }
  });
}

console.log('═'.repeat(78));
console.log("ІМЕНА ОДНОГО КЛІЄНТА В КОДІ — має бути нуль");
console.log('═'.repeat(78));
console.log();

if (hits.length === 0) {
  console.log(`  чисто — ${files.length} файлів перевірено`);
  console.log();
  console.log('  Дозволені винятки:');
  for (const [f, why] of ALLOWED) console.log(`    ${f} — ${why}`);
  process.exit(0);
}

for (const h of hits) console.log(`  ${h.f}:${h.n}\n    ${h.line}`);
console.log();
console.log(`  ${hits.length} згадок. Дані клієнта живуть у базі, не у файлах.`);
process.exit(1);
