/**
 * The price of a night is asked in one place, or the numbers stop matching.
 *
 *   node scripts/check-price-source.mjs [--strict]
 *
 * AGENTS.md §3 invariant 16: only `priceNights()` (modules/pricing) may answer
 * what a night costs. There used to be four hand-rolled day loops, each with
 * its own copy of the weekend rule and one with `let dayPrice = 2500` — one
 * customer's number, quietly billed to whoever booked next. The loops were
 * folded into `nightly-price.ts`, but nothing has been keeping new ones out —
 * and the survivors below are exactly why the same stay shows different
 * numbers on different screens today.
 *
 * What this checks: any SQL that touches the price tables
 * (`price_calendar`, `price_occupancy`, `price_los_tiers`) from outside
 * `src/modules/pricing/`. A file that queries them directly is one weekend
 * rule away from drifting — the query itself is the violation, whatever it
 * computes afterwards.
 *
 * Deliberately narrow: variable names (`hasPriceCalendar`), i18n keys and UI
 * copy do not trip it — only FROM/JOIN/INTO/UPDATE against a price table.
 *
 * The LEGACY list is the debt that existed when the gate was written. Each
 * entry says what diverges and what the fix is. New entries are not added —
 * new code goes through `@pricing`. An entry whose file no longer queries the
 * tables is stale and fails --strict, so the list can only shrink.
 */
import fs from 'node:fs';
import path from 'node:path';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'src');

// SQL that reads or writes a price table. INSERT INTO / DELETE FROM are
// covered by INTO / FROM; UPDATE stands on its own.
const QUERY = /\b(?:FROM|JOIN|INTO|UPDATE)\s+["'`]?price_(?:calendar|occupancy|los_tiers)\b/i;

// The debt as of 2026-08-24 — see docs/AUDIT.md §2 for the full stories.
const LEGACY = new Map([
  ['src/modules/channels/domain/booking-com/ari.ts',
    'pushes rates to Booking.com from price_calendar only, with its own copy ' +
    'of the weekend rule; ignores the occupancy matrix and LOS tiers, so an ' +
    'OTA guest is quoted numbers the widget and the operator never see. ' +
    'Fix: build ARI rates from priceNights()/cheapestByDay().'],
  ['src/app/api/booking-sites/[id]/listings/route.ts',
    'the admin "from" price is MIN(base_price) over price_calendar; the ' +
    'public month calendar answers from the matrix via cheapestByDay(), so ' +
    'the two screens disagree for any hotel that filled the matrix. ' +
    'Fix: ask cheapestByDay() here too.'],
  ['src/modules/widget/api/widget-calendar-public.handlers.ts',
    'merges the matrix with its own MIN() over price_calendar and re-decides ' +
    'weekend locally — a third copy of the weekend rule. ' +
    'Fix: extend cheapestByDay() to fall back to the day calendar and delete ' +
    'the local query.'],
]);

const offenders = [];   // new violations
const covered = new Set(); // legacy entries that still match

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p);
      continue;
    }
    if (!/\.(ts|tsx|mts)$/.test(e.name)) continue;

    const rel = path.relative(ROOT, p).replaceAll(path.sep, '/');
    // The module that owns the tables, and the schema that creates them.
    if (rel.startsWith('src/modules/pricing/')) continue;
    if (rel === 'src/lib/db.ts') continue;

    const text = fs.readFileSync(p, 'utf8');
    if (!QUERY.test(text)) continue;

    if (LEGACY.has(rel)) { covered.add(rel); continue; }

    const line = text.slice(0, text.search(QUERY)).split('\n').length;
    offenders.push({ rel, line });
  }
}

walk(SRC);

const stale = [...LEGACY.keys()].filter((f) => !covered.has(f) && fs.existsSync(path.join(ROOT, f)));
const gone = [...LEGACY.keys()].filter((f) => !fs.existsSync(path.join(ROOT, f)));

let failed = false;

if (offenders.length) {
  failed = true;
  console.error('\n✗ price tables queried outside modules/pricing — a second price source:\n');
  for (const o of offenders) {
    console.error(`  ${o.rel}:${o.line}`);
  }
  console.error('\n  Ask @pricing instead: priceNights() prices a stay, cheapestByDay()');
  console.error('  answers "from" figures. A direct query is how the four loops happened.');
}

if (stale.length || gone.length) {
  for (const f of [...stale, ...gone]) {
    console.error(`\n✗ LEGACY entry no longer matches: ${f}`);
    console.error('  The file stopped querying price tables (or was removed) — delete its');
    console.error('  entry from LEGACY in scripts/check-price-source.mjs. The list only shrinks.');
  }
  failed = true;
}

if (!failed) {
  const n = covered.size;
  console.log(`✓ price source: no new readers outside modules/pricing (${n} known legacy, see docs/AUDIT.md §2)`);
}

if (failed && strict) process.exit(1);
if (failed) console.error('\n(report mode — --strict would fail the build)');
