/**
 * Hit every POST / PUT / PATCH route with a plausible body and report the 5xx.
 *
 *   npm run build:win && npm run start
 *   SMOKE_SESSION=<session_id> node scripts/smoke-writes.mjs [POST|PUT|PATCH]
 *
 * The write counterpart to smoke-routes.mjs. That one proved a whole class of
 * bug the compiler cannot see — SQL is a string, so a query naming a column
 * that does not exist builds cleanly and answers 500 on every call. Reads were
 * covered; writes were not, and writes are where the move to Postgres actually
 * hurt: invoice numbering, period locking, budgets, the booking handshake and
 * the entire guest portal were each broken in a way no read would reveal.
 *
 * The hard part is getting past the handler's own validation. Sending `{}`
 * everywhere stops 90 of 98 routes before they reach SQL, which proves nothing.
 * So the body is built from the handler's own code — whatever it destructures
 * out of the request — and each field is filled from what its NAME means:
 *
 *   unitId     → a real unit id, read from the database
 *   checkIn    → a date
 *   price      → a number
 *   status     → a value the CHECK constraint actually allows
 *
 * That last one matters more than it sounds. Guessing at enum-ish fields is how
 * a sweep spends its time being refused by constraints instead of testing
 * anything, so the allowed values are read out of pg_constraint.
 *
 * WHAT THIS CANNOT DO, and do not read the output as if it could: it will not
 * get every route past validation, and a route it cannot reach is reported as
 * refused, never as passing. Cross-field rules, ids that must exist and belong
 * together, multipart uploads — those stay out of reach and need a person.
 *
 * Reading the result:
 *
 *   пройшли    reached the database and came back — the useful signal
 *   відмовили  the handler said no. Its own validation, a permission, a 404 —
 *              expected, and not evidence of anything either way
 *   5xx        look at each one. Most will be this script's synthetic input
 *              hitting a type or a constraint ('sweep' into a bigint), which is
 *              the database being right. What is left is yours.
 *
 * It writes: rows land in whatever database it points at. Never production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getSql } from '../src/core/db/async.ts';
import { runWithOrganization } from '../src/core/auth/tenant-context.ts';

const METHOD = (process.argv[2] || 'POST').toUpperCase();
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const SESSION = process.env.SMOKE_SESSION;
if (!SESSION) {
  console.error('SMOKE_SESSION is not set — log in once and pass the session_id cookie');
  process.exit(2);
}

const sql = getSql();

// ── Values the database itself says are allowed ─────────────────────────────
//
// The bodies are keyed by field name, and a field name does not say which table
// it will end up in — so for a name like `status`, whose CHECK differs per
// table, the value has to be one that as many of them as possible accept.
// Taking simply the first constraint found sent `draft` (from booking_drafts)
// into a reservation and produced a 500 that looked like a defect and was not.
//
// So: collect every allowed value per column name, and pick the one the most
// tables agree on. Where no value is common, some route will still refuse —
// which is the honest outcome, and shows up as a refusal.
const allowed = {};
for (const row of await sql.rows(`
  SELECT a.attname AS col, pg_get_constraintdef(co.oid) AS def
    FROM pg_constraint co
    JOIN pg_class c ON c.oid = co.conrelid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(co.conkey)
   WHERE co.contype = 'c' AND pg_get_constraintdef(co.oid) LIKE '%ANY (ARRAY%'
`)) {
  const values = [...String(row.def).matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
  if (!values.length) continue;
  (allowed[row.col] ??= []).push(values);
}

const ENUMS = {};
for (const [col, sets] of Object.entries(allowed)) {
  const votes = new Map();
  for (const set of sets) for (const v of set) votes.set(v, (votes.get(v) ?? 0) + 1);
  ENUMS[col] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ── Ids that exist, so a write lands on real rows ───────────────────────────
//
// Read AS an organization. Every table below is tenant-scoped, so on Postgres a
// lookup with no organization set returns nothing and every id comes back null
// — the bodies then carry nulls and the sweep tests the validation branch of
// each handler instead of its query. Which is the same mistake this script
// exists to find, made by the script.
const ORG = (await sql.row('SELECT id FROM organizations ORDER BY created_at LIMIT 1'))?.id;
if (!ORG) { console.error('no organization in this database — provision one first'); process.exit(2); }

const one = async (q) => (await runWithOrganization(ORG, () => sql.row(q)))?.id ?? null;
const ids = {
  property:  await one('SELECT id FROM properties ORDER BY created_at LIMIT 1'),
  unitType:  await one('SELECT id FROM unit_types LIMIT 1'),
  unit:      await one('SELECT id FROM units LIMIT 1'),
  category:  await one('SELECT id FROM categories LIMIT 1'),
  guest:     await one('SELECT id FROM guests LIMIT 1'),
  account:   await one('SELECT id FROM finance_accounts LIMIT 1'),
  site:      await one('SELECT id FROM booking_sites LIMIT 1'),
  reservation: await one('SELECT id FROM reservations LIMIT 1'),
};

const BY_NAME = [
  [/^(unit_?type_?id|unitTypeId)$/i, () => ids.unitType],
  [/^(property_?id|propertyId)$/i, () => ids.property],
  [/^(category_?id|categoryId)$/i, () => ids.category],
  [/^(unit_?id|unitId)$/i, () => ids.unit],
  [/^(reservation_?id|reservationId|booking_?id|bookingId)$/i, () => ids.reservation],
  [/^(guest_?id|guestId)$/i, () => ids.guest],
  [/^(site_?id|siteId)$/i, () => ids.site],
  [/^(account_?id|accountId)$/i, () => ids.account],
  [/(check_?in|date_?from|valid_?from|period_?from)/i, () => '2030-09-10'],
  [/(check_?out|date_?to|valid_?until|period_?to)/i, () => '2030-09-12'],
  [/date/i, () => '2030-09-10'],
  [/^year$/i, () => 2030],
  [/month/i, () => '2030-09'],
  [/email/i, () => 'smoke@example.invalid'],
  [/phone/i, () => '+420000000000'],
  [/(first_?name|firstName)/i, () => 'Smoke'],
  [/(last_?name|lastName)/i, () => 'Test'],
  [/(nights|adults)/i, () => 2],
  [/(children|infants)/i, () => 0],
  [/(count|quantity|qty|max_uses|redemption_limit)/i, () => 1],
  [/(price|amount|total|cost|fee|revenue|balance|offer)/i, () => 1000],
  [/percent/i, () => 10],
  [/currency/i, () => 'CZK'],
  [/(^|_)(code|slug)($|_)/i, () => `smoke-${Date.now().toString(36)}`],
  [/(name|title|label|description|comment|note|message|reason|address|city)/i, () => 'Smoke test'],
  [/^(is_|has_|can_)|(enabled|active|primary|shared|included)$/i, () => true],
  [/(sort_?order|priority|floor|beds|capacity)/i, () => 1],
  [/lang/i, () => 'uk'],
];

const valueFor = (name) => {
  const snake = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  if (ENUMS[name]) return ENUMS[name];
  if (ENUMS[snake]) return ENUMS[snake];
  for (const [re, make] of BY_NAME) if (re.test(name)) { const v = make(); if (v != null) return v; }
  return 'smoke';
};

/** Follow the route's export to the file that implements it. */
function handlerSource(routeFile, method) {
  const src = fs.readFileSync(routeFile, 'utf8');
  if (new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(src)) return src;
  const assigned = src.match(new RegExp(`export\\s+const\\s+${method}\\s*=\\s*([^\\n;]+)`));
  if (!assigned) return src;
  const name = (assigned[1].match(/(\w+)/) || [])[1];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!m[1].split(',').some((n) => n.trim().split(/\s+as\s+/).pop().trim() === name)) continue;
    const spec = m[2];
    const bases = spec.startsWith('.')
      ? [path.resolve(path.dirname(routeFile), spec)]
      : [`src/modules/${spec.replace(/^@/, '')}/api`, `src/${spec.replace(/^@\//, '')}`];
    for (const b of bases) {
      for (const c of [`${b}.ts`, path.join(b, 'index.ts'), b]) {
        if (!fs.existsSync(c) || !fs.statSync(c).isFile()) continue;
        const barrel = fs.readFileSync(c, 'utf8');
        const from = barrel.match(new RegExp(`(?:import|export)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'([^']+)'`));
        if (from) {
          const t = `${path.resolve(path.dirname(c), from[1])}.ts`;
          if (fs.existsSync(t)) return fs.readFileSync(t, 'utf8');
        }
        return barrel;
      }
    }
  }
  return src;
}

/** The names the handler pulls out of the request body. */
function bodyFields(src) {
  const names = new Set();
  for (const m of src.matchAll(/const\s*\{([^}]{0,600})\}\s*=\s*(?:await\s+)?(?:body|json|req\.json\(\)|request\.json\(\))/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.split(':')[0].split('=')[0].trim();
      if (/^\w+$/.test(n)) names.add(n);
    }
  }
  for (const m of src.matchAll(/body\.(\w+)/g)) names.add(m[1]);
  return [...names];
}

const routes = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'route.ts') routes.push(p);
  }
})('src/app/api');

const MISSING = 'smoke_missing_id';
const toUrl = (f) => f.replace(/^src\/app/, '').replace(/\/route\.ts$/, '')
  .replace(/\[\.\.\.[^\]]+\]/g, MISSING)
  .replace(/\[(\w+)\]/g, (_, k) => ({
    id: ids.reservation, unitTypeId: ids.unitType, token: MISSING,
  }[k] || MISSING));

const out = [];
for (const file of routes) {
  const src = fs.readFileSync(file, 'utf8');
  if (!new RegExp(`export\\s+(?:async\\s+function|const)\\s+${METHOD}\\b`).test(src)) continue;
  // The session endpoints would log this sweep out and turn every later route
  // into a 401 — which reads exactly like the whole API being broken.
  if (file.includes('/api/auth/')) continue;

  const body = Object.fromEntries(bodyFields(handlerSource(file, METHOD)).map((n) => [n, valueFor(n)]));
  let status = 0; let text = '';
  try {
    const res = await fetch(BASE + toUrl(file), {
      method: METHOD,
      headers: { cookie: `session_id=${SESSION}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    status = res.status;
    text = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
  } catch (e) {
    status = -1; text = e.message;
  }
  out.push({ url: toUrl(file), status, body: text });
  process.stderr.write(status === -1 ? '?' : status >= 500 ? 'X' : status < 300 ? 'o' : '.');
}
process.stderr.write('\n');

const dropped = out.filter((r) => r.status === -1);
const broke = out.filter((r) => r.status >= 500);
const passed = out.filter((r) => r.status > 0 && r.status < 300);

console.log(`\n${METHOD}: ${out.length} — ${passed.length} пройшли, `
  + `${out.length - passed.length - broke.length - dropped.length} відмовили, ${broke.length} × 5xx`
  + (dropped.length ? `, ${dropped.length} без відповіді` : ''));

if (dropped.length) {
  // Reported apart from failures on purpose: a dropped connection is the server
  // being unable to answer, and counting it as a broken route sends someone
  // hunting for a bug that is not there.
  console.log(`\nбез відповіді (сервер не встиг — не результат роуту):`);
  for (const r of dropped) console.log(`  ${r.url}`);
}
if (broke.length) {
  console.log('\n5xx — перевірити кожен:');
  for (const r of broke) console.log(`  ${r.status}  ${r.url}\n      ${r.body}`);
}
process.exit(broke.length ? 1 : 0);
