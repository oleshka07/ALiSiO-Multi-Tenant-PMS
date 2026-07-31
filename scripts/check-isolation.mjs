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
  // Children first: foreign keys are ON. Channel rows go before unit_types,
  // because a room mapping points at one.
  const conns = db.prepare('SELECT id FROM channel_connections WHERE organization_id LIKE ?').all(`${TAG}%`).map((r) => r.id);
  for (const cid of conns) db.prepare('DELETE FROM channel_room_mapping WHERE connection_id = ?').run(cid);
  db.prepare('DELETE FROM channel_connections WHERE organization_id LIKE ?').run(`${TAG}%`);
  db.prepare('DELETE FROM channel_credentials WHERE organization_id LIKE ?').run(`${TAG}%`);

  const props = db.prepare('SELECT id FROM properties WHERE organization_id LIKE ?').all(`${TAG}%`).map((r) => r.id);
  for (const pid of props) {
    db.prepare('DELETE FROM units WHERE property_id = ?').run(pid);
    db.prepare('DELETE FROM unit_types WHERE property_id = ?').run(pid);
    db.prepare('DELETE FROM buildings WHERE property_id = ?').run(pid);
    db.prepare('DELETE FROM categories WHERE property_id = ?').run(pid);
  }
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

    // ── The property's children ─────────────────────────────────────────────
    // categories, buildings, unit_types and units carry no organization_id;
    // they reach one through property_id. That indirection is exactly where a
    // check is easy to forget, so each is exercised rather than assumed.
    const catRes = await call(cookieA, '/api/categories', {
      method: 'POST',
      body: JSON.stringify({ property_id: propA.id, name: 'Probe rooms', type: 'resort' }),
    });
    assert.strictEqual(catRes.status, 201, `A could not create a category: ${catRes.status}`);
    const catA = await catRes.json();
    console.log('  ok  tenant A created a category');

    // B must not attach anything to A's property, even with a valid own session.
    const stolenCat = await call(cookieB, '/api/categories', {
      method: 'POST',
      body: JSON.stringify({ property_id: propA.id, name: 'Hijack', type: 'resort' }),
    });
    assert.strictEqual(stolenCat.status, 404, `B created a category on A's property: ${stolenCat.status}`);
    console.log("  ok  B cannot create a category on A's property");

    const catsB = await (await call(cookieB, '/api/categories')).json();
    assert.ok(!catsB.some((c) => c.id === catA.id), "B's category list contains A's category");
    console.log("  ok  B's category list excludes A's category");

    const catPatchB = await call(cookieB, `/api/categories/${catA.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    assert.strictEqual(catPatchB.status, 404, `B renamed A's category: ${catPatchB.status}`);
    const catDelB = await call(cookieB, `/api/categories/${catA.id}`, { method: 'DELETE' });
    assert.strictEqual(catDelB.status, 404, `B deleted A's category: ${catDelB.status}`);
    console.log("  ok  B cannot rename or delete A's category");

    // Bulk creation is the worst case: unchecked it writes 200 rows at once.
    const utRes = await call(cookieA, '/api/unit-types', {
      method: 'POST',
      body: JSON.stringify({ property_id: propA.id, category_id: catA.id, name: 'Probe type', code: 'PRB' }),
    });
    assert.strictEqual(utRes.status, 201, `A could not create a unit type: ${utRes.status}`);
    const utA = await utRes.json();

    const bulkB = await call(cookieB, '/api/units', {
      method: 'POST',
      body: JSON.stringify({
        bulk: true, property_id: propA.id, category_id: catA.id, unit_type_id: utA.id,
        prefix: 'HIJACK', from: 1, to: 50,
      }),
    });
    assert.strictEqual(bulkB.status, 404, `B bulk-created units in A's property: ${bulkB.status}`);
    const leaked = db
      .prepare('SELECT COUNT(*) c FROM units WHERE property_id = ?')
      .get(propA.id);
    assert.strictEqual(leaked.c, 0, `${leaked.c} units were written into A's property by B`);
    console.log("  ok  B cannot bulk-create 50 units inside A's property");

    // Channel credentials authenticate the hotel to Booking.com. Leaking them
    // — or letting B point its connection at A's — sells A's rooms under B's
    // account, so this is exercised end to end rather than trusted.
    const credRes = await call(cookieA, '/api/channels/credentials', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'booking_com', environment: 'test',
        client_id: 'probe-client-a', client_secret: 'probe-secret-a',
      }),
    });
    assert.ok(credRes.ok, `A could not save credentials: ${credRes.status}`);
    const credA = await credRes.json();

    const credsB = await (await call(cookieB, '/api/channels/credentials')).json();
    assert.ok(Array.isArray(credsB), 'credentials list is not an array');
    assert.ok(!credsB.some((c) => c.id === credA.id), "B's credential list contains A's credentials");
    console.log("  ok  B's channel credentials exclude A's");

    // B saving its own credentials must not overwrite A's row.
    const credResB = await call(cookieB, '/api/channels/credentials', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'booking_com', environment: 'test',
        client_id: 'probe-client-b', client_secret: 'probe-secret-b',
      }),
    });
    assert.ok(credResB.ok, `B could not save credentials: ${credResB.status}`);
    const storedA = db.prepare('SELECT client_id FROM channel_credentials WHERE id = ?').get(credA.id);
    assert.strictEqual(storedA?.client_id, 'probe-client-a', "B's save overwrote A's credentials");
    console.log("  ok  B saving credentials does not overwrite A's");

    const connRes = await call(cookieA, '/api/channels/connections', {
      method: 'POST',
      body: JSON.stringify({ channel: 'booking_com', external_property_id: 'probe-prop-a' }),
    });
    assert.strictEqual(connRes.status, 201, `A could not create a connection: ${connRes.status}`);
    const connA = await connRes.json();

    const connsB = await (await call(cookieB, '/api/channels/connections')).json();
    assert.ok(!connsB.some((c) => c.id === connA.id), "B's connection list contains A's connection");
    const connGetB = await call(cookieB, `/api/channels/connections/${connA.id}`);
    assert.strictEqual(connGetB.status, 404, `B read A's connection: ${connGetB.status}`);
    const connPutB = await call(cookieB, `/api/channels/connections/${connA.id}`, {
      method: 'PUT',
      body: JSON.stringify({ external_property_id: 'hijacked' }),
    });
    assert.strictEqual(connPutB.status, 404, `B updated A's connection: ${connPutB.status}`);
    const connDelB = await call(cookieB, `/api/channels/connections/${connA.id}`, { method: 'DELETE' });
    assert.strictEqual(connDelB.status, 404, `B deleted A's connection: ${connDelB.status}`);
    console.log("  ok  B cannot read, change or delete A's channel connection");

    // The mapping is what puts a room on a channel: both ids come from the
    // request body, so both are checked.
    const mapB = await call(cookieB, '/api/channels/mapping', {
      method: 'POST',
      body: JSON.stringify({ connection_id: connA.id, unit_type_id: utA.id, external_room_type_id: 'hijack' }),
    });
    assert.strictEqual(mapB.status, 404, `B mapped A's unit type onto A's connection: ${mapB.status}`);
    const mapped = db
      .prepare('SELECT COUNT(*) c FROM channel_room_mapping WHERE connection_id = ?')
      .get(connA.id);
    assert.strictEqual(mapped.c, 0, `${mapped.c} room mappings were written into A's connection by B`);
    console.log("  ok  B cannot map rooms onto A's connection");

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
