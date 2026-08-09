/**
 * Is this database ready to hold a customer?
 *
 *   DATABASE_URL=postgres://… node scripts/check-deployed-db.mjs
 *
 * Every migration in db/postgres/migrations/ leaves a fingerprint — a column, a
 * default, a policy. This asks the live database for those fingerprints, so
 * "did anyone apply 0007?" becomes a command instead of a memory.
 *
 * It exists because the failures it looks for are all silent. A missing 0005
 * does not error on deploy; it makes fourteen INSERTs fail later, one of them
 * the booking handshake. A missing 0007 does not error either; it makes the
 * whole guest portal answer 404. Nothing in the application says which
 * migration it is missing — it just behaves as if a feature was never built.
 *
 * Run it against beta first and against prod before onboarding anyone.
 */
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — point it at the database to check');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const results = [];
const check = async (label, sql, ok, hint) => {
  const { rows } = await client.query(sql);
  const passed = ok(rows);
  results.push({ label, passed, hint });
  console.log(`  ${passed ? 'ok  ' : 'НІ  '} ${label}`);
  if (!passed && hint) console.log(`         ${hint}`);
};

console.log(`\nперевірка бази: ${url.replace(/:[^:@/]*@/, ':***@')}\n`);

// ── 0001: login can find a person before the organization is known ──────────
await check(
  'app_users читається до орендаря (0001)',
  `SELECT pg_get_expr(polqual, polrelid) AS q FROM pg_policy WHERE polrelid = 'app_users'::regclass`,
  // Postgres normalises the expression it stores — `'app.organization_id'::text`,
  // `''::text` — so the pattern is written against what it gives back, not
  // against what the schema file says.
  (r) => r.some((x) => /current_setting\('app\.organization_id'(::text)?\)\s*=\s*''/.test(x.q)),
  'без цього логін не знаходить нікого — 0001',
);

// ── 0004: the widget's site names its own hotel ─────────────────────────────
await check(
  'booking_sites має власний organization_id (0004)',
  `SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_sites' AND column_name = 'organization_id'`,
  (r) => r.length === 1,
  'без цього публічні маршрути віджета не знаходять готель — 0004',
);

// ── 0005: an inserted row takes the tenant of the statement ─────────────────
await check(
  'organization_id дефолтиться від контексту (0005)',
  `SELECT count(*)::int AS n
     FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE a.attname = 'organization_id'
      AND pg_get_expr(d.adbin, d.adrelid) LIKE '%app.organization_id%'`,
  (r) => r[0].n >= 40,
  'без цього INSERT без organization_id відхиляє політика — 0005',
);

// ── 0006: a hotel always has a base language ────────────────────────────────
await check(
  'organizations.language NOT NULL (0006)',
  `SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'language'`,
  (r) => r[0]?.is_nullable === 'NO',
  'розходження між schema.sql і міграціями — 0006',
);

// ── 0007: the guest portal can find the booking its link names ──────────────
await check(
  'reservations має organization_id (0007)',
  `SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reservations' AND column_name = 'organization_id'`,
  (r) => r.length === 1,
  'без цього гостьовий портал не має звідки взяти готель — 0007',
);
await check(
  'політика reservations впізнає токен гостя (0007)',
  `SELECT pg_get_expr(polqual, polrelid) AS q FROM pg_policy WHERE polrelid = 'reservations'::regclass`,
  (r) => r.some((x) => /app\.guest_token/.test(x.q)),
  'без цього ВЕСЬ гостьовий портал відповідає 404 — 0007',
);

// ── the standing invariants, not tied to one migration ──────────────────────
await check(
  'кожна таблиця з organization_id має RLS і FORCE',
  `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id'
    WHERE c.relkind = 'r'`,
  (r) => r.every((x) => x.relrowsecurity && x.relforcerowsecurity),
  'таблиця без FORCE читається власником поза політикою',
);
await check(
  'застосунок підключається роллю, яка нічим не володіє',
  `SELECT count(*)::int AS n FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r' AND pg_get_userbyid(c.relowner) = current_user`,
  (r) => r[0].n === 0 || process.env.ALLOW_OWNER === '1',
  'ця роль володіє таблицями — політики до неї не застосовуються без FORCE',
);

await client.end();

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} пройшло`);
if (failed.length) {
  console.log('\nБАЗА НЕ ГОТОВА. Накотіть міграції з db/postgres/migrations/ і повторіть.\n');
  process.exit(1);
}
console.log('база готова приймати клієнта\n');
