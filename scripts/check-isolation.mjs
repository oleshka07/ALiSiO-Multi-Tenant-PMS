/**
 * Proves tenant isolation against a live server with two real organizations.
 *
 * Static analysis says a query is constrained; this says a second hotel's
 * request actually cannot see or destroy the first hotel's data. Before
 * onboarding anyone, that has to be demonstrated, not argued.
 *
 *   npm run dev
 *   node scripts/check-isolation.mjs
 *
 * Creates its own throwaway organizations and users, exercises the API as each
 * of them, and removes what it created.
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import assert from 'node:assert';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB = process.env.DB_PATH || 'data/alisio.db';
const TAG = '__isolation_check__';

const db = new Database(DB);

function makeTenant(suffix) {
  const orgId = `${TAG}org_${suffix}`;
  const userId = `${TAG}user_${suffix}`;
  const email = `${suffix}@isolation.test`;
  const password = 'probe-password-1234';
  db.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
    .run(orgId, `Probe ${suffix}`, `${TAG}${suffix}`);
  db.prepare(
    'INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId, orgId, email, `Probe ${suffix}`, 'owner', bcrypt.hashSync(password, 10));
  return { orgId, userId, email, password };
}

function cleanup() {
  // Children first: foreign keys are ON.
  db.prepare('DELETE FROM properties WHERE organization_id LIKE ?').run(`${TAG}%`);
  db.prepare('DELETE FROM app_users WHERE organization_id LIKE ?').run(`${TAG}%`);
  db.prepare('DELETE FROM sessions WHERE user_id LIKE ?').run(`${TAG}%`);
  db.prepare('DELETE FROM organizations WHERE id LIKE ?').run(`${TAG}%`);
}

async function login({ email, password }) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(res.ok, `login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get('set-cookie') || '';
  const sid = cookie.match(/session_id=([^;]+)/)?.[1];
  assert.ok(sid, 'no session cookie returned');
  return `session_id=${sid}`;
}

const call = (cookie, path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(init.headers || {}) } });

async function main() {
  cleanup();
  const a = makeTenant('a');
  const b = makeTenant('b');

  try {
    const cookieA = await login(a);
    const cookieB = await login(b);

    // A creates a property.
    const created = await call(cookieA, '/api/properties', {
      method: 'POST',
      body: JSON.stringify({ name: 'Probe A Hotel', slug: `${TAG}a-hotel` }),
    });
    assert.strictEqual(created.status, 201, `A could not create a property: ${created.status}`);
    const propA = await created.json();
    assert.ok(propA.id, 'no property id returned');
    console.log('  ok  tenant A created a property');

    // It must land in A's organization, not in whichever row is first.
    const row = db.prepare('SELECT organization_id FROM properties WHERE id = ?').get(propA.id);
    assert.strictEqual(row.organization_id, a.orgId, `property landed in ${row.organization_id}`);
    console.log('  ok  it belongs to A, not to the first organization in the table');

    // B must not see it.
    const listB = await (await call(cookieB, '/api/properties')).json();
    assert.ok(!listB.some((p) => p.id === propA.id), "B's list contains A's property");
    console.log("  ok  B's property list excludes A's property");

    // B must not read it by id.
    const readB = await call(cookieB, `/api/properties/${propA.id}`);
    assert.strictEqual(readB.status, 404, `B read A's property: ${readB.status}`);
    console.log("  ok  B reading A's property by id gets 404");

    // B must not modify it.
    const patchB = await call(cookieB, `/api/properties/${propA.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    assert.strictEqual(patchB.status, 404, `B patched A's property: ${patchB.status}`);
    const afterPatch = db.prepare('SELECT name FROM properties WHERE id = ?').get(propA.id);
    assert.strictEqual(afterPatch.name, 'Probe A Hotel', 'name was changed by B');
    console.log("  ok  B cannot rename A's property");

    // B must not delete it — the failure this whole exercise exists for.
    const delB = await call(cookieB, `/api/properties/${propA.id}`, { method: 'DELETE' });
    assert.strictEqual(delB.status, 404, `B deleted A's property: ${delB.status}`);
    const stillThere = db.prepare('SELECT 1 FROM properties WHERE id = ?').get(propA.id);
    assert.ok(stillThere, "A's property was deleted by B");
    console.log("  ok  B cannot delete A's property");

    // And without a session, nothing at all.
    const anon = await fetch(`${BASE}/api/properties`);
    assert.strictEqual(anon.status, 401, `anonymous list returned ${anon.status}`);
    const anonDel = await fetch(`${BASE}/api/properties/${propA.id}`, { method: 'DELETE' });
    assert.ok([401, 403].includes(anonDel.status), `anonymous delete returned ${anonDel.status}`);
    console.log('  ok  anonymous requests are rejected');

    // The public widget price list must be read-only.
    const put = await fetch(`${BASE}/api/widget/prices`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'probe', rate_standard: 1 }),
    });
    assert.ok([401, 403, 405].includes(put.status), `unauthenticated PUT on widget prices returned ${put.status}`);
    console.log('  ok  unauthenticated PUT on the public price list is refused');

    console.log('isolation: all checks passed');
  } finally {
    cleanup();
    db.close();
  }
}

main().catch((e) => {
  cleanup();
  db.close();
  console.error('isolation CHECK FAILED:', e.message);
  process.exit(1);
});
