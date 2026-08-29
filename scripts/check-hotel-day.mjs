/**
 * «Today» is asked of the hotel, not of the server clock.
 *
 *   node scripts/check-hotel-day.mjs [--strict]
 *
 * `new Date().toISOString()` is UTC. `organizations.timezone` exists, defaults
 * to Europe/Prague, and until this gate nothing read it — so every list that
 * meant «today» was wrong for the first one to three hours of each local day:
 * arrivals, departures, occupancy, the housekeeping sheet, and the no-show
 * auto-archive, which writes.
 *
 * What this checks: `new Date().toISOString()` sliced or split into a date, in
 * a handler that serves one organization. The replacement is `todayFor(orgId)`
 * from `@core/hotel-day`.
 *
 * Where it does NOT apply, and why the walk is narrow:
 *
 *   - `scripts/` and `*.check.ts` — a maintenance script and a test have no
 *     tenant to ask, and pinning a moment is how a test is written;
 *   - `src/lib/db.ts` — schema bootstrap;
 *   - a full timestamp (`toISOString()` with no date slicing) is a moment in
 *     time, which is exactly what UTC is for. Only a DATE derived from it is
 *     a claim about what day it is somewhere.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
// fileURLToPath, не .pathname: на Windows .pathname дає '/D:/…%20…' — жодна
// тека SCOPES не existsSync, walk нічого не сканує, гейт зелений на будь-чому.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `new Date().toISOString()` cut down to a date: .slice(0, 10), .split('T')[0],
// .substring(0, 7) and friends.
const UTC_DAY = /new Date\(\)\s*\.toISOString\(\)\s*\.(?:slice|substring|substr)\(\s*0\s*,\s*(?:7|10)\s*\)|new Date\(\)\s*\.toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/g;

// Handlers that answer for one organization. A cron or a public route resolves
// its own tenant per row and is checked by the isolation probes instead.
const SCOPES = [
  'src/modules/dashboard',
  'src/modules/reports',
  'src/modules/bookings/api',
  'src/modules/guests/api',
  'src/modules/finance/api',
  'src/modules/properties/api',
];

const offenders = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx)$/.test(e.name) || e.name.endsWith('.check.ts')) continue;

    const rel = path.relative(ROOT, p).replaceAll(path.sep, '/');
    const text = fs.readFileSync(p, 'utf8');
    UTC_DAY.lastIndex = 0;
    let m;
    while ((m = UTC_DAY.exec(text))) {
      offenders.push(`${rel}:${text.slice(0, m.index).split('\n').length}`);
    }
  }
}

for (const s of SCOPES) walk(path.join(ROOT, s));

const BAR = '═'.repeat(78);
console.log(`\n${BAR}`);
console.log('«СЬОГОДНІ» ЗА ГОДИННИКОМ СЕРВЕРА, А НЕ ГОТЕЛЮ — має бути нуль');
console.log(BAR);

if (!offenders.length) {
  console.log('\n  чисто — жоден операторський список не рахує день у UTC');
  console.log('  правильно: await todayFor(actor.organizationId)  — @core/hotel-day\n');
  process.exit(0);
}

console.log('');
for (const o of offenders) console.log(`  ✗ ${o}`);
console.log(`\n  ${offenders.length} — замініть на todayFor(organizationId) з @core/hotel-day.`);
console.log('  У Празі це перша година доби, у Києві — до трьох: список заїздів,');
console.log('  виїздів і завантаження показує вчорашній день щоночі.\n');
process.exit(strict ? 1 : 0);
