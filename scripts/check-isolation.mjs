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
    const resIds = db.prepare('SELECT id FROM reservations WHERE property_id = ?').all(pid).map((r) => r.id);
    for (const rid of resIds) {
      db.prepare('DELETE FROM guest_registrations WHERE reservation_id = ?').run(rid);
      db.prepare('DELETE FROM booking_activity_log WHERE reservation_id = ?').run(rid);
    }
    db.prepare('DELETE FROM reservations WHERE property_id = ?').run(pid);
    db.prepare('DELETE FROM units WHERE property_id = ?').run(pid);
    db.prepare('DELETE FROM unit_types WHERE property_id = ?').run(pid);
    db.prepare('DELETE FROM buildings WHERE property_id = ?').run(pid);
    db.prepare('DELETE FROM categories WHERE property_id = ?').run(pid);
  }
  db.prepare('DELETE FROM properties WHERE organization_id LIKE ?').run(`${TAG}%`);
  try { db.prepare('DELETE FROM waitlist WHERE site_id IN (SELECT id FROM booking_sites WHERE slug LIKE ?)').run(`${TAG}%`); } catch { /* table may not exist */ }
  try { db.prepare('DELETE FROM booking_sites WHERE slug LIKE ?').run(`${TAG}%`); } catch { /* table may not exist */ }
  db.prepare('DELETE FROM finance_tags WHERE organization_id LIKE ?').run(`${TAG}%`);
  // The app creates this table on first boot; cleanup may run against a
  // database the new code has not touched yet.
  try { db.prepare('DELETE FROM organization_features WHERE organization_id LIKE ?').run(`${TAG}%`); } catch { /* not yet migrated */ }
  db.prepare('DELETE FROM guests WHERE organization_id LIKE ?').run(`${TAG}%`);
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

    // Finance used to answer "which organization is this?" with the first row
    // in the table, in 66 files. With the tenant context in place, a write from
    // B's session must land under B — not under whichever organization the
    // server happens to have created first.
    const tagRes = await call(cookieB, '/api/finance/tags', {
      method: 'POST',
      body: JSON.stringify({ name: `probe-tag-${TAG}`, color: '#123456' }),
    });
    assert.ok(tagRes.ok, `B could not create a finance tag: ${tagRes.status}`);
    const tagRow = db
      .prepare('SELECT organization_id FROM finance_tags WHERE name = ?')
      .get(`probe-tag-${TAG}`);
    assert.ok(tagRow, 'the finance tag was not written');
    assert.strictEqual(tagRow.organization_id, b.orgId, `B's tag was filed under ${tagRow.organization_id}`);
    console.log("  ok  a finance write from B lands under B, not the first organization");

    // Staff accounts: the permission check was there, the ownership check was
    // not, so an owner could rename, re-role or delete another hotel's staff —
    // including its owner.
    const userGetB = await call(cookieB, `/api/users/${a.userId}`);
    assert.strictEqual(userGetB.status, 404, `B read A's user: ${userGetB.status}`);
    const userPutB = await call(cookieB, `/api/users/${a.userId}`, {
      method: 'PUT',
      body: JSON.stringify({ full_name: 'Hijacked', is_active: false }),
    });
    assert.strictEqual(userPutB.status, 404, `B edited A's user: ${userPutB.status}`);
    const userDelB = await call(cookieB, `/api/users/${a.userId}`, { method: 'DELETE' });
    assert.strictEqual(userDelB.status, 404, `B deleted A's user: ${userDelB.status}`);
    const userA = db.prepare('SELECT full_name, is_active FROM app_users WHERE id = ?').get(a.userId);
    assert.ok(userA && userA.full_name === 'Probe a' && userA.is_active === 1, "A's user was changed by B");
    console.log("  ok  B cannot read, change or delete A's staff");

    // The widget's cash-confirmation PIN is a staff credential and must only
    // work inside the organization that owns the reservation. It used to be
    // four hard-coded numbers that worked everywhere.
    const pinSet = await call(cookieA, `/api/users/${a.userId}`, {
      method: 'PUT',
      body: JSON.stringify({ payment_pin: '4721' }),
    });
    assert.ok(pinSet.ok, `A could not set a payment PIN: ${pinSet.status}`);
    const pinRow = db.prepare('SELECT payment_pin_hash FROM app_users WHERE id = ?').get(a.userId);
    assert.ok(pinRow.payment_pin_hash && pinRow.payment_pin_hash !== '4721', 'the PIN was stored in the clear');
    console.log('  ok  a staff PIN is stored hashed, per organization');

    // The guest registry — names, dates of birth, nationality, document type
    // and number — was served to the open internet, export included.
    const registryAnon = await fetch(`${BASE}/api/guest-registry?month=2026-07`);
    assert.strictEqual(registryAnon.status, 401, `anonymous registry read returned ${registryAnon.status}`);
    const exportAnon = await fetch(`${BASE}/api/guest-registry?month=2026-07&format=csv`);
    assert.strictEqual(exportAnon.status, 401, `anonymous registry export returned ${exportAnon.status}`);
    const registryPatchAnon = await fetch(`${BASE}/api/guest-registry/probe`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'hide' }),
    });
    assert.strictEqual(registryPatchAnon.status, 401, `anonymous registry write returned ${registryPatchAnon.status}`);
    console.log('  ok  the guest registry needs a session, read and export alike');

    // The public price list must name a hotel rather than return everyone's.
    const pricesAnon = await fetch(`${BASE}/api/widget/prices`);
    assert.strictEqual(pricesAnon.status, 400, `unqualified public price list returned ${pricesAnon.status}`);
    console.log('  ok  the public price list refuses to answer without a site');

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

    // ── The booking book itself ──────────────────────────────────────────
    // The calendar's API. This is the exact list that was returned to every
    // tenant on the server until the calendar audit — so it gets the full
    // cross-tenant treatment: list, read, edit, delete, and the guest
    // documents attached to a booking.
    db.prepare(`
      INSERT INTO units (id, property_id, category_id, unit_type_id, name, code)
      VALUES (?, ?, ?, ?, 'Probe unit', 'PRB-1')
    `).run(`${TAG}unit_a`, propA.id, catA.id, utA.id);

    const bookRes = await call(cookieA, '/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Probe', lastName: 'Guest', unitId: `${TAG}unit_a`,
        checkIn: '2031-01-10', checkOut: '2031-01-12', nights: 2,
      }),
    });
    assert.strictEqual(bookRes.status, 201, `A could not create a booking: ${bookRes.status}`);
    const booking = await bookRes.json();

    const listBookA = await (await call(cookieA, '/api/bookings')).json();
    assert.ok(listBookA.some((r) => r.id === booking.id), "A's booking list is missing A's booking");
    const listBookB = await (await call(cookieB, '/api/bookings')).json();
    assert.ok(!listBookB.some((r) => r.id === booking.id), "B's booking list contains A's booking");
    console.log("  ok  the booking list is per organization");

    const readBookB = await call(cookieB, `/api/bookings/${booking.id}`);
    assert.strictEqual(readBookB.status, 404, `B read A's booking: ${readBookB.status}`);
    const patchBookB = await call(cookieB, `/api/bookings/${booking.id}`, {
      method: 'PATCH', body: JSON.stringify({ notes: 'hijack' }),
    });
    assert.strictEqual(patchBookB.status, 404, `B patched A's booking: ${patchBookB.status}`);
    const regsB = await call(cookieB, `/api/bookings/${booking.id}/registrations`);
    assert.strictEqual(regsB.status, 404, `B read A's guest registrations: ${regsB.status}`);
    const delBookB = await call(cookieB, `/api/bookings/${booking.id}`, { method: 'DELETE' });
    assert.strictEqual(delBookB.status, 404, `B deleted A's booking: ${delBookB.status}`);
    console.log("  ok  B cannot read, change or delete A's booking");

    // Deleting one's own booking must actually work — it 500'd on a leftover
    // crm_leads statement from the CRM removal until the calendar audit.
    const delBookA = await call(cookieA, `/api/bookings/${booking.id}`, { method: 'DELETE' });
    assert.ok(delBookA.ok, `A could not delete its own booking: ${delBookA.status}`);
    console.log('  ok  deleting your own booking works');

    // ── Site analytics ───────────────────────────────────────────────────
    // Six analytics routes had a session and never asked whose. A logged-in
    // user of hotel B could read hotel A's revenue, conversion, campaigns and
    // geography by putting A's site id in the URL — confirmed live, HTTP 200
    // with a body, before this was fixed.
    const siteRes = await call(cookieA, '/api/booking-sites', {
      method: 'POST',
      body: JSON.stringify({ property_id: propA.id, name: 'Probe site', slug: `${TAG}site_a` }),
    });
    if (siteRes.ok) {
      const siteA = await siteRes.json();
      const siteId = siteA.id || siteA.site?.id;
      if (siteId) {
        for (const view of ['overview', 'traffic', 'geo', 'listings', 'campaigns', 'funnel']) {
          const leak = await call(cookieB, `/api/booking-sites/${siteId}/analytics/${view}`);
          assert.strictEqual(leak.status, 404, `B read A's analytics/${view}: ${leak.status}`);
        }
        const own = await call(cookieA, `/api/booking-sites/${siteId}/analytics/overview`);
        assert.ok(own.ok, `A cannot read its own analytics: ${own.status}`);
        console.log("  ok  B cannot read A's site analytics, A still can");
      }
    }

    // 'all' must mean "all of MINE". It expanded to `1=1` — every reservation
    // on the server — which read correctly only while there was one hotel.
    const allB = await call(cookieB, '/api/booking-sites/all/analytics/overview');
    if (allB.ok) {
      const body = await allB.json();
      assert.strictEqual(body?.current?.revenue ?? 0, 0,
        "B's 'all sites' revenue is not zero — it is counting somebody else's");
      console.log("  ok  'all sites' counts only the caller's own");
    }

    // ── The public waitlist ──────────────────────────────────────────────
    // Open by design (a guest joins from the widget), so the guard is that a
    // made-up site id cannot become a row of somebody's personal data.
    const bogus = await fetch(`${BASE}/api/booking/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: 'no-such-site', checkIn: '2031-01-01', checkOut: '2031-01-02',
        email: 'probe@example.invalid',
      }),
    });
    assert.strictEqual(bogus.status, 404, `waitlist accepted an invented site: ${bogus.status}`);

    const malformed = await fetch(`${BASE}/api/booking/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: 'x', checkIn: 'tomorrow', checkOut: 'later', email: 'not-an-email' }),
    });
    assert.strictEqual(malformed.status, 400, `waitlist accepted junk: ${malformed.status}`);
    console.log('  ok  the public waitlist refuses invented sites and junk input');

    // ── The dashboard ────────────────────────────────────────────────────
    // The first screen after logging in showed arrivals, departures and an
    // occupancy percentage computed across every hotel on the server, plus a
    // list of upcoming guests by name. B has no property with units, so its
    // dashboard must be empty rather than a copy of A's.
    const dashB = await call(cookieB, '/api/dashboard');
    if (dashB.ok) {
      const d = await dashB.json();
      assert.strictEqual(d.totalUnits, 0, `B's dashboard counts ${d.totalUnits} units it does not own`);
      assert.strictEqual((d.upcomingArrivals || []).length, 0, "B's dashboard lists arrivals it does not own");
      assert.strictEqual((d.todayDepartures || []).length, 0, "B's dashboard lists departures it does not own");
      console.log("  ok  the dashboard counts only the caller's own hotel");
    }

    // ── The nightly digest ───────────────────────────────────────────────
    // It sends numbers to Telegram. Every query in it was unscoped, so the
    // message pasted into one hotel's chat carried both companies' revenue,
    // arrivals and guest names. The cron now runs once per organization.
    const digest = await fetch(`${BASE}/api/cron/daily-digest`, {
      headers: { 'x-cron-secret': process.env.CRON_SECRET || 'local-cron' },
    });
    if (digest.ok) {
      const d = await digest.json();
      assert.ok(Array.isArray(d.results), 'the digest cron did not report per-organization results');
      for (const r of d.results) {
        assert.ok(!r.error, `digest failed for ${r.organization}: ${r.error}`);
      }
      console.log(`  ok  the digest runs per organization (${d.organizations} of them, none failed)`);
    }

    // ── The feature registry ─────────────────────────────────────────────
    // Probe organizations are created after the seed migration, so they have
    // no feature rows — exactly what a brand-new customer looks like. Nothing
    // may work until a feature is switched on, and switching one on for B must
    // change nothing for A.
    const hostexOff = await call(cookieB, '/api/hostex/sync');
    assert.strictEqual(hostexOff.status, 403, `hostex without the feature returned ${hostexOff.status}`);

    const widgetOff = await call(cookieA, `/api/widget/config?propertyId=${propA.id}`);
    assert.strictEqual(widgetOff.status, 403, `widget without the feature returned ${widgetOff.status}`);
    console.log('  ok  a new organization has every integration off');

    const turnOn = await call(cookieB, '/api/settings/features', {
      method: 'PUT',
      body: JSON.stringify({ feature: 'hostex', enabled: true }),
    });
    assert.ok(turnOn.ok, `enabling a feature failed: ${turnOn.status}`);
    const hostexOn = await call(cookieB, '/api/hostex/sync');
    assert.notStrictEqual(hostexOn.status, 403, 'hostex still refused after enabling the feature');

    const stillOffForA = await call(cookieA, '/api/hostex/sync');
    assert.strictEqual(stillOffForA.status, 403, "B's toggle changed A's features");
    console.log("  ok  a feature toggles per organization, not per server");

    // ── Staff tasks ──────────────────────────────────────────────────────
    // The tasks repositories put an organization on every INSERT and on no
    // SELECT. So the writes were filed correctly and every read returned the
    // whole server: B's task board listed A's titles, assignees and due dates,
    // and B could rename or delete them by id.
    const taskA = await call(cookieA, '/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Probe A: fix the boiler', priority: 'high' }),
    });
    assert.strictEqual(taskA.status, 201, `A could not create a task: ${taskA.status}`);
    const tA = await taskA.json();

    const tasksB = await (await call(cookieB, '/api/tasks')).json();
    assert.ok(!tasksB.some((t) => t.id === tA.id), "B's task list contains A's task");
    console.log("  ok  B's task list excludes A's tasks");

    const readTaskB = await call(cookieB, `/api/tasks/${tA.id}`);
    assert.strictEqual(readTaskB.status, 404, `B read A's task: ${readTaskB.status}`);

    await call(cookieB, `/api/tasks/${tA.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    const taskRow = db.prepare('SELECT title FROM tasks WHERE id = ?').get(tA.id);
    assert.strictEqual(taskRow.title, 'Probe A: fix the boiler', "B renamed A's task");

    await call(cookieB, `/api/tasks/${tA.id}`, { method: 'DELETE' });
    assert.ok(db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(tA.id), "B deleted A's task");
    console.log("  ok  B cannot read, rename or delete A's task");

    // Projects and tags are the same repositories with the same hole.
    const projA = await call(cookieA, '/api/tasks/projects', {
      method: 'POST', body: JSON.stringify({ name: 'Probe A project' }),
    });
    if (projA.status === 201) {
      const pA = await projA.json();
      const projectsB = await (await call(cookieB, '/api/tasks/projects')).json();
      assert.ok(!projectsB.some((x) => x.id === pA.id), "B's project list contains A's project");
      console.log("  ok  B's task projects exclude A's");
    }

    // ── Reports ──────────────────────────────────────────────────────────
    // Revenue, occupancy and the city-tax return were computed over every
    // reservation on the server. The city-tax report is the worse of the two:
    // it is filed with the municipality and it carries guest names.
    const repB = await call(cookieB, '/api/reports?from=2020-01-01&to=2030-01-01');
    if (repB.ok) {
      const r = await repB.json();
      assert.strictEqual(r.summary.totalBookings, 0, `B's report counts ${r.summary.totalBookings} bookings it does not own`);
      assert.strictEqual(r.summary.totalRevenue, 0, "B's report sums revenue it does not own");
      console.log("  ok  B's report counts only its own bookings");
    }

    const taxB = await call(cookieB, '/api/reports/city-tax?month=2025-01');
    if (taxB.ok) {
      const t = await taxB.json();
      assert.strictEqual(t.totalBookings, 0, `B's city-tax return lists ${t.totalBookings} stays it does not own`);
      assert.strictEqual((t.bookings || []).length, 0, "B's city-tax return carries other guests' names");
      console.log("  ok  B's city-tax return contains only its own guests");
    }

    // ── Alerts ───────────────────────────────────────────────────────────
    // Worse than a leak: the panel opens with an UPDATE that archived every
    // organization's stale confirmed bookings as no_show, so opening A's
    // dashboard rewrote B's reservation statuses.
    const alertsB = await call(cookieB, '/api/alerts');
    if (alertsB.ok) {
      const list = await alertsB.json();
      assert.ok(Array.isArray(list), 'alerts did not return a list');
      assert.strictEqual(list.length, 0, `B's alert panel shows ${list.length} alerts about other hotels' guests`);
      console.log("  ok  B's alerts mention only its own bookings");
    }

    // ── Integration keys ─────────────────────────────────────────────────
    // The point of per-organization credentials is that B's Hostex token bills
    // B and reaches B's listings. Two things have to hold: A must not see it,
    // and the screen must not hand the raw token back to anyone — including
    // its owner, since whoever opens the page can read what it renders.
    const KEY = `hx_probe_${TAG}_wxyz9876`;
    await call(cookieB, '/api/settings/features', {
      method: 'PUT', body: JSON.stringify({ feature: 'hostex', enabled: true }),
    });
    const savedKey = await call(cookieB, '/api/settings/integration-credentials', {
      method: 'PUT', body: JSON.stringify({ channel: 'hostex', values: { accessToken: KEY } }),
    });
    if (savedKey.ok) {
      const back = await savedKey.text();
      assert.ok(!back.includes(KEY), 'the save response echoed the raw token back');
      assert.ok(back.includes('9876'), 'the save response did not confirm which key was stored');

      const readB = await (await call(cookieB, '/api/settings/integration-credentials')).text();
      assert.ok(!readB.includes(KEY), 'the settings screen returns the raw token');

      const readA = await call(cookieA, '/api/settings/integration-credentials');
      const bodyA = await readA.text();
      assert.ok(!bodyA.includes(KEY), "A's settings screen carries B's token");
      assert.ok(!bodyA.includes('9876'), "A's settings screen hints at B's token");
      console.log("  ok  an integration key is B's alone, and never leaves the server");

      // An organization without the feature cannot park a secret for it.
      const offChannel = await call(cookieA, '/api/settings/integration-credentials', {
        method: 'PUT', body: JSON.stringify({ channel: 'pricelabs', values: { accessToken: 'x' } }),
      });
      assert.strictEqual(offChannel.status, 409, `saving a key for a disabled integration returned ${offChannel.status}`);
      console.log('  ok  a key cannot be saved for an integration that is off');
    }

    console.log('isolation: all checks passed');
  } finally {
    cleanup();
    db.close();
  }
}

main().catch((e) => {
  // The finally block has already cleaned up and closed the handle. Touching
  // it again here threw "database connection is not open" — which is what got
  // printed, instead of the assertion that actually failed.
  console.error('isolation CHECK FAILED:', e.message);
  process.exit(1);
});
