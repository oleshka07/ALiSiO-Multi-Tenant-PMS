/**
 * Does a NEW customer get the same schema as this database?
 *
 *   npm run build:win && node scripts/check-fresh-schema.mjs
 *
 * Boots the built server against an empty data directory, waits for it to
 * finish migrating, and diffs the resulting schema against data/alisio.db.
 * Tables, and the columns of every shared table.
 *
 * Why this exists: migrations here are written as "upgrade from the previous
 * state" — `if (!cols.includes(x)) ALTER TABLE ADD COLUMN x`. Remove the
 * ALTER and an upgraded database keeps the column while a fresh one never
 * gets it; add a DROP at the end and the two disagree the other way. Nothing
 * noticed, because everyone develops against a database that has been
 * migrating for months. The first person to notice would have been customer
 * number two, on their first day.
 *
 * Reads only. The temporary database lives in the system temp directory and
 * the real one is never opened for writing.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const REAL_DB = process.env.DB_PATH || 'data/alisio.db';
const PORT = process.env.FRESH_PORT || '3999';
const TIMEOUT_MS = 120_000;

if (!fs.existsSync(REAL_DB)) {
  console.error(`Немає ${REAL_DB} — нема з чим порівнювати.`);
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-fresh-'));
const freshDb = path.join(tmp, 'alisio.db');

console.log('Піднімаю застосунок на порожній базі…');
// `next start`, not .next/standalone/server.js: under standalone the
// migrations stopped a few statements in and the completion marker never
// arrived, which is a separate question from the one this script asks.
const server = spawn('npx', ['next', 'start', '-p', PORT], {
  env: { ...process.env, ALISIO_DATA_DIR: tmp },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });

// shell:true means server.pid is the cmd wrapper; kill() reaped the shell and
// left the actual node process holding the port for every later run.
const stop = () => {
  try {
    if (process.platform === 'win32') execSync(`taskkill /T /F /PID ${server.pid}`, { stdio: 'ignore' });
    else server.kill('SIGKILL');
  } catch { /* already gone */ }
};

/** The app builds its schema lazily, on the first request that touches the db. */
async function waitForSchema() {
  const deadline = Date.now() + TIMEOUT_MS;
  let poked = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    if (!poked) {
      // A POST to login, not GET /api/auth/me: without a session cookie the
      // latter answers 401 without ever opening the database, so the schema
      // was never built and this script waited out its timeout.
      try {
        await fetch(`http://localhost:${PORT}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'schema-probe@example.invalid', password: 'x' }),
        });
        poked = true;
      } catch { continue; }
    }
    if (!fs.existsSync(freshDb)) continue;
    // runMigrations prints this as its last statement. Polling the table count
    // instead reported "settled" while columns were still being added.
    if (log.includes('[DB] migrations complete')) {
      await new Promise((r) => setTimeout(r, 1500));
      return true;
    }
  }
  return false;
}

const ok = await waitForSchema();
stop();

if (!ok) {
  console.error('Свіжа база не піднялася за відведений час.');
  console.error(log.split('\n').slice(-15).join('\n'));
  process.exit(2);
}

/**
 * The fresh database is opened read-WRITE on purpose: killing the server
 * leaves a hot WAL, and SQLite can only replay it with write access. The real
 * database is passed readonly by the caller below.
 */
const shape = (file, readonly = true) => {
  const d = new Database(file, { readonly });
  const tables = d.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((r) => r.name);
  const columns = new Map(
    tables.map((t) => [t, d.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map((c) => c.name).sort()]),
  );
  d.close();
  return { tables, columns };
};

await new Promise((r) => setTimeout(r, 800));
const fresh = shape(freshDb, false);
const real = shape(REAL_DB);
// Windows keeps a handle on the file for a moment after the writer dies, so
// a failed cleanup must not fail the check — the OS clears its temp anyway.
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
catch { /* left behind in the system temp directory */ }

const problems = [];
const freshSet = new Set(fresh.tables);
const realSet = new Set(real.tables);

for (const t of real.tables) {
  if (!freshSet.has(t)) problems.push(`таблиця ${t}: є тут, нема у нового клієнта`);
}
for (const t of fresh.tables) {
  if (!realSet.has(t)) problems.push(`таблиця ${t}: є у нового клієнта, нема тут`);
}
for (const t of real.tables) {
  if (!freshSet.has(t)) continue;
  const a = new Set(real.columns.get(t));
  const b = new Set(fresh.columns.get(t));
  const onlyReal = [...a].filter((c) => !b.has(c));
  const onlyFresh = [...b].filter((c) => !a.has(c));
  if (onlyReal.length) problems.push(`${t}: колонки є тут, нема у нового — ${onlyReal.join(', ')}`);
  if (onlyFresh.length) problems.push(`${t}: колонки є у нового, нема тут — ${onlyFresh.join(', ')}`);
}

console.log('═'.repeat(78));
console.log('СХЕМА НОВОГО КЛІЄНТА vs ЦІЄЇ БАЗИ');
console.log('═'.repeat(78));
console.log();
console.log(`  свіжа: ${fresh.tables.length} таблиць    ця: ${real.tables.length} таблиць`);
console.log();

if (!problems.length) {
  console.log('  збігаються — новий клієнт отримає ту саму схему');
  process.exit(0);
}
for (const p of problems) console.log(`  ✗ ${p}`);
console.log();
console.log(`  ${problems.length} розбіжностей. Міграція, написана як «оновити з попереднього`);
console.log('  стану», не виконується на порожній базі — а видалення в кінці не');
console.log('  скасовує створення вище.');
process.exit(1);
