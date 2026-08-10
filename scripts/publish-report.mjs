/**
 * Put a finished report at a link.
 *
 *   DATABASE_URL=postgres://… node scripts/publish-report.mjs report.html \
 *     --title "Kemp Carlsbad · Партнерський звіт · Липень 2026" \
 *     --period 2026-07
 *
 * Prints the URL to send. That is the whole job.
 *
 * It talks to the database directly rather than through the application,
 * because publishing happens on a server where the application may not be
 * running and must work the same on SQLite and on Postgres. What it does not
 * do is bypass the tenant: it sets `app.organization_id` exactly as a request
 * would, so the row-level policy is in force and a mistake in the arguments
 * cannot write a report into somebody else's hotel.
 *
 * Options:
 *   --title    <text>     required — shown in the operator's list
 *   --period   <YYYY-MM>  the month the report is about
 *   --org      <id>       which hotel; required only when the server has more
 *                         than one
 *   --property <id>       optional
 *   --new                 mint a second report for the period instead of
 *                         replacing the one already published for it
 *   --revoke   <token>    stop a link working (the report itself stays)
 *   --list                what is published, with links and view counts
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

// ── Arguments ───────────────────────────────────────────────────────────────
//
// Which flags take a value is declared rather than guessed. Guessing — "the
// next word unless it starts with --" — reads `--new report.html` as a value
// for --new and then reports no file was given.
const TAKES_VALUE = new Set(['title', 'period', 'org', 'property', 'slug', 'revoke']);
const argv = process.argv.slice(2);
const values = {};
const flags = new Set();
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const name = a.slice(2);
  if (TAKES_VALUE.has(name)) values[name] = argv[++i];
  else flags.add(name);
}
const flag = (name) => values[name] ?? null;
const has = (name) => flags.has(name) || name in values;
const file = positional[0];

const die = (msg) => { console.error(msg); process.exit(1); };

// ── The database, whichever one this is ─────────────────────────────────────
//
// On the server, the answer is already written down: deploy/env.prod holds
// DATABASE_URL and APP_URL, and that file is what the running application is
// configured from. Reading it means publishing a report is one command with no
// shell incantation in front of it — and, more importantly, that it cannot be
// pointed at the wrong database by a typo in a variable someone pasted.
//
// An explicit DATABASE_URL in the environment still wins, for a developer
// machine or a one-off.
function fromEnvFile() {
  const name = process.env.ENV_NAME || 'prod';
  const path = `deploy/env.${name}`;
  if (!fs.existsSync(path)) return {};
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/\r$/, '');
  }
  return out;
}
const envFile = fromEnvFile();
const url = process.env.DATABASE_URL || envFile.DATABASE_URL || '';
const usePostgres = !!url
  || process.env.DB_DRIVER === 'postgres'
  || envFile.DB_DRIVER === 'postgres';

/**
 * One shape over two engines: `query(sql, params)` with `?` placeholders.
 *
 * Small enough to write twice rather than import the application's seam, which
 * would drag the whole module graph and its path aliases into a script.
 */
async function connect() {
  if (usePostgres) {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    let n = 0;
    const toDollar = (sql) => { n = 0; return sql.replace(/\?/g, () => `$${++n}`); };
    return {
      kind: 'postgres',
      query: async (sql, params = []) => (await client.query(toDollar(sql), params)).rows,
      scope: async (org) => { await client.query('SELECT set_config($1, $2, false)', ['app.organization_id', org ?? '']); },
      close: () => client.end(),
    };
  }
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(process.env.DB_PATH || 'data/alisio.db');
  return {
    kind: 'sqlite',
    query: async (sql, params = []) => {
      const stmt = db.prepare(sql);
      return stmt.reader ? stmt.all(params) : (stmt.run(params), []);
    },
    // SQLite has no row-level security; the WHERE clauses below carry the
    // scope, and they are the same ones Postgres checks twice.
    scope: async () => {},
    close: () => db.close(),
  };
}

// A stack trace is not an error message. Whoever runs this on the server is
// publishing a report, not debugging a driver — say what failed and where the
// setting came from.
const db = await connect().catch((e) => {
  const where = process.env.DATABASE_URL ? 'змінної DATABASE_URL' : `файла deploy/env.${process.env.ENV_NAME || 'prod'}`;
  die(`не вдалося підключитися до бази (адреса з ${where}):\n  ${e.message}`);
});

/** The hotel to publish as. One organization needs no argument; several do. */
async function resolveOrganization() {
  const explicit = flag('org');
  // Reading `organizations` happens before any tenant is set, which the policy
  // allows — a hotel's own id is not somebody else's secret.
  const rows = await db.query('SELECT id, name FROM organizations ORDER BY created_at');
  if (explicit) {
    const found = rows.find((r) => r.id === explicit);
    if (!found) die(`немає організації ${explicit}`);
    return found;
  }
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) die('у базі немає жодної організації');
  die(`організацій ${rows.length} — вкажіть --org:\n` + rows.map((r) => `  ${r.id}  ${r.name}`).join('\n'));
}

const org = await resolveOrganization();
await db.scope(org.id);

// ── --list ──────────────────────────────────────────────────────────────────
if (has('list')) {
  const rows = await db.query(
    `SELECT token, title, period, published_at, revoked_at, views
       FROM partner_reports WHERE organization_id = ? ORDER BY published_at DESC`,
    [org.id],
  );
  if (!rows.length) console.log('(жодного звіту)');
  for (const r of rows) {
    const state = r.revoked_at ? 'ВІДКЛИКАНО' : `${r.views} переглядів`;
    console.log(`${r.period || '—'}  ${r.title}\n  /report/${r.token}\n  ${state}\n`);
  }
  await db.close();
  process.exit(0);
}

// ── --revoke ────────────────────────────────────────────────────────────────
if (has('revoke')) {
  const token = flag('revoke');
  if (!token) die('--revoke потребує токен');
  await db.query(
    'UPDATE partner_reports SET revoked_at = ? WHERE token = ? AND organization_id = ?',
    [new Date().toISOString(), token, org.id],
  );
  const [left] = await db.query(
    'SELECT revoked_at FROM partner_reports WHERE token = ? AND organization_id = ?', [token, org.id]);
  console.log(left?.revoked_at ? 'посилання більше не працює' : 'такого звіту немає');
  await db.close();
  process.exit(left?.revoked_at ? 0 : 1);
}

// ── publish ─────────────────────────────────────────────────────────────────
if (!file) die('вкажіть HTML-файл звіту');
if (!fs.existsSync(file)) die(`немає файлу ${file}`);

const title = flag('title');
if (!title) die('--title обовʼязковий');

const period = flag('period');
if (period && !/^\d{4}-\d{2}$/.test(period)) die('--period має бути YYYY-MM');

const html = fs.readFileSync(file, 'utf8');
if (!/<html[\s>]/i.test(html)) die('файл не схожий на HTML-документ');

const existing = period && !has('new')
  ? (await db.query(
      `SELECT id, token FROM partner_reports
        WHERE organization_id = ? AND period = ? AND revoked_at IS NULL
        ORDER BY published_at DESC LIMIT 1`,
      [org.id, period],
    ))[0]
  : null;

let token;
if (existing) {
  // The link is already in somebody's inbox. Correcting a number must not mean
  // sending everyone a new URL, so the token survives the republish.
  token = existing.token;
  await db.query(
    'UPDATE partner_reports SET title = ?, html = ?, property_id = ?, published_at = ? WHERE id = ?',
    [title, html, flag('property') ?? null, new Date().toISOString(), existing.id],
  );
} else {
  token = crypto.randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO partner_reports (id, organization_id, property_id, token, slug, title, period, html, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), org.id, flag('property') ?? null, token, flag('slug') ?? null,
     title, period ?? null, html, new Date().toISOString()],
  );
}

await db.close();

// The domain comes from the same env file the application is served with
// (APP_URL), so the printed link is the one that will actually work — not one
// assembled from whatever the person typed.
const base = (process.env.PUBLIC_BASE_URL || envFile.APP_URL || '').replace(/\/$/, '');
console.log(`\n${existing ? 'оновлено' : 'опубліковано'}: ${title}`);
console.log(`${(html.length / 1024 / 1024).toFixed(2)} МБ · ${org.name}\n`);
console.log(`  ${base}/report/${token}\n`);
if (!base) console.log('(домен невідомий — додайте його спереду вручну)\n');
