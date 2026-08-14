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
 *
 * `hotels/` is NOT walked, and that is deliberate rather than an oversight.
 * The rule is about CODE: a hotel's name reaching a second hotel's screen
 * because someone typed it into a component. `hotels/*.json` is the one place
 * where a customer's business is allowed to be a file — it is read at runtime
 * by scripts/apply-hotel.mjs and never imported, so nothing in the product can
 * depend on what is in it. Adding this directory to the walk would flag the
 * pilot's own room numbers as a violation and leave nowhere to put them.
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
  // A person's name in a letter the product sends. The booking confirmation
  // was signed "Oleg Stepeniev 🌿" and described "a hot tub under the stars" —
  // every hotel's guest received it, whoever they had actually booked with.
  // The hotel's own voice belongs in widget_config.email_confirmed_body.
  /Stepeniev/i,
  /Степен[ії]єв/i,
];

// Path → why the name is allowed to remain there.
const ALLOWED = new Map([
  ['src/modules/widget/data/site.repo.ts', 'documents the hardcodes it replaced'],
  ['scripts/check-no-tenant-names.mjs', 'this file lists them on purpose'],
  ['docs/SECURITY-FINDINGS.md', 'the findings record'],
]);

const files = [];
/**
 * `data` used to be in this skip list, to keep the local SQLite folder out.
 * The walk starts at `src`, where that folder does not exist — so all it
 * actually excluded was every module's own `data` folder: fifty-one files holding every
 * repository, every e-mail the product sends and every OTA payload. The
 * booking confirmation sat there signed with one person's name for months,
 * and this check reported "чисто" every time.
 *
 * A skip list matched on basename skips more than it was written for. The
 * local database is `/data` at the root and is unreachable from here.
 */
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(e.name)) continue;
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

/**
 * A row id from the seed, written into application code.
 *
 * The same failure as a name, with a quieter face. Two settings screens sent a
 * literal `prop_main_001` — the id of the FIRST customer's seed property — when
 * creating a room type or a room. For that hotel it worked. For every other
 * hotel the row does not exist, so the screen answered "Property not found",
 * and a new customer could not be set up without somebody editing code.
 *
 * Which property, which organization, which category — those are answers the
 * server derives from the session (`requirePropertyId`, `requireOrganizationId`),
 * never constants.
 *
 * Scoped to the application: db.ts and scripts/ legitimately write seed ids,
 * and are listed in SEED_OWNERS below.
 */
const SEED_ID = /['"`](?:prop|org|cat|ut|bldg|unit)_[a-z0-9]+_?\d{2,}['"`]/i;
const SEED_OWNERS = [/^src[\/\\]lib[\/\\]db\.ts$/, /^scripts[\/\\]/, /^db[\/\\]/];
const ownsSeedIds = (f) => SEED_OWNERS.some((re) => re.test(f));

const hits = [];
for (const f of files) {
  if (ALLOWED.has(f)) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const seedAllowed = ownsSeedIds(f);
  lines.forEach((line, i) => {
    // A comment explaining a removed hardcode is not the hardcode.
    const code = line.replace(/\/\/.*$/, '');
    for (const re of FORBIDDEN) {
      if (re.test(line)) { hits.push({ f, n: i + 1, line: line.trim().slice(0, 100) }); return; }
    }
    if (!seedAllowed && SEED_ID.test(code)) {
      hits.push({ f, n: i + 1, line: line.trim().slice(0, 100) });
    }
  });
}

console.log('═'.repeat(78));
console.log("БІЗНЕС ОДНОГО КЛІЄНТА В КОДІ (імена, домени, seed-id) — має бути нуль");
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
