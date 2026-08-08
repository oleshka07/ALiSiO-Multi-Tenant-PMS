/**
 * Hit every static GET route with a real session and report the ones that 5xx.
 *
 *   npm run build:win && npm run start
 *   node scripts/smoke-routes.mjs [out.json]
 *
 * Run it against the PRODUCTION build, not `npm run dev`. The dev server
 * compiles each route on first request and runs out of memory somewhere past a
 * hundred of them — and a dead server reads as thirty broken routes, which
 * sends you hunting for bugs that are not there.
 *
 * This is the only thing that finds a whole class of bug the compiler cannot:
 * SQL lives in a string, so a query naming a column that does not exist type-
 * checks, builds, passes every audit, and then answers 500 on every single
 * call. `/api/units` — the entire rooms list — had been doing exactly that.
 *
 * A 503 for an integration nobody configured is expected, not a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getSql } from '../src/core/db/async.ts';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT = process.argv[2] || null;

const routes = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (e.name !== 'route.ts') continue;
    const src = fs.readFileSync(p, 'utf8');
    if (!/export\s+(const|(async\s+)?function)\s+GET/.test(src)) continue;
    const rel = p.replace(/\\/g, '/');
    const url = rel.slice(rel.indexOf('src/app') + 'src/app'.length).replace(/\/route\.ts$/, '');
    if (url.includes('[')) continue; // a dynamic segment needs a real id
    routes.push(url);
  }
})('src/app/api');
routes.sort();

// Its own throwaway organization, rather than a demo account.
//
// This used to log in as admin@demo.local/demo1234 — a seed that exists on a
// developer's machine and on no deployed environment, so against beta it
// printed "login failed" and checked nothing at all. Same probe tenant as
// check-isolation.mjs, and the same constant bcrypt hash, because a container
// built from the application's image cannot import bcryptjs.
const sql = getSql();
const TAG = '__smoke_routes__';
const PROBE = {
  orgId: `${TAG}org`,
  userId: `${TAG}user`,
  email: 'smoke@routes.test',
  password: 'probe-password-1234',
  hash: '$2b$10$oiYMXccjTWuK20axUyyF/..DMBr3rKnNGabo8F8H/kw/1CjncKOr6',
};

async function removeProbe() {
  await sql.run('DELETE FROM sessions WHERE user_id = ?', [PROBE.userId]);
  await sql.run('DELETE FROM app_users WHERE id = ?', [PROBE.userId]);
  try { await sql.run('DELETE FROM organization_features WHERE organization_id = ?', [PROBE.orgId]); } catch { /* not yet migrated */ }
  await sql.run('DELETE FROM organizations WHERE id = ?', [PROBE.orgId]);
}

await removeProbe();
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [PROBE.orgId, 'Smoke probe', TAG]);
await sql.run(
  'INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
  [PROBE.userId, PROBE.orgId, PROBE.email, 'Smoke probe', 'owner', PROBE.hash],
);

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: PROBE.email, password: PROBE.password }),
});
const cookie = (login.headers.get('set-cookie') || '').match(/session_id=([^;]+)/)?.[1];
if (!cookie) {
  console.error(`login failed: ${login.status} ${await login.text()}`);
  await removeProbe();
  process.exit(1);
}

const results = [];
const QUEUE = [...routes];
async function worker() {
  for (let url = QUEUE.shift(); url; url = QUEUE.shift()) {
    try {
      const res = await fetch(`${BASE}${url}`, {
        headers: { Cookie: `session_id=${cookie}` },
        signal: AbortSignal.timeout(60000),
      });
      let detail = '';
      if (res.status >= 500) detail = (await res.text()).slice(0, 200);
      results.push({ url, status: res.status, detail });
    } catch (e) {
      results.push({ url, status: 0, detail: String(e.message).slice(0, 120) });
    }
  }
}
// One at a time: six concurrent first-compiles is enough to take the dev
// server down, and a dead server reads as thirty broken routes.
await worker();
results.sort((a, b) => a.url.localeCompare(b.url));

const bad = results.filter((r) => r.status >= 500 || r.status === 0);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ total: results.length, bad }, null, 2));
console.log(`checked ${results.length} routes, ${bad.length} failing`);
for (const r of bad) console.log(`${String(r.status).padEnd(4)} ${r.url}  ${r.detail}`);

await removeProbe();

// Only a 5xx or a dead connection is a failure; 503 means "not configured".
const broken = bad.filter((r) => r.status === 0 || (r.status >= 500 && r.status !== 503));
if (broken.length) process.exit(1);
