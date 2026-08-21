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
import assert from 'node:assert';
import { getSql } from '../src/core/db/async.ts';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TAG = '__isolation_check__';

// The probe password and its bcrypt hash, both constants.
//
// Not hashed here: Next's standalone build inlines bcryptjs into the compiled
// server rather than leaving it as a package, so a container built from the
// application's image cannot import it — and that container is the only place
// that can reach a Postgres bound to loopback inside the compose network.
//
// Regenerate with:
//   node -e "console.log(require('bcryptjs').hashSync('probe-password-1234', 10))"
const PROBE_PASSWORD = 'probe-password-1234';
const PROBE_HASH = '$2b$10$oiYMXccjTWuK20axUyyF/..DMBr3rKnNGabo8F8H/kw/1CjncKOr6';

// Through the seam, not through better-sqlite3: this file used to open
// data/alisio.db directly, so the day an environment moved to Postgres the
// strongest check in the repository quietly stopped covering it. DB_DRIVER
// now decides here exactly as it does in the application.
//
// Against Postgres, DATABASE_URL must be the SUPERUSER connection. The script
// seeds two organizations from outside any request, and row-level security
// refuses that to the application's role — correctly, which is the point.
const sql = getSql();

async function makeTenant(suffix) {
  const orgId = `${TAG}org_${suffix}`;
  const userId = `${TAG}user_${suffix}`;
  const email = `${suffix}@isolation.test`;
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [orgId, `Probe ${suffix}`, `${TAG}${suffix}`]);
  await sql.run('INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)', [userId, orgId, email, `Probe ${suffix}`, 'owner', PROBE_HASH]);
  return { orgId, userId, email, password: PROBE_PASSWORD };
}

async function cleanup() {
  // Children first: foreign keys are ON. Channel rows go before unit_types,
  // because a room mapping points at one.
  const conns = (await sql.rows('SELECT id FROM channel_connections WHERE organization_id LIKE ?', [`${TAG}%`])).map((r) => r.id);
  for (const cid of conns) await sql.run('DELETE FROM channel_room_mapping WHERE connection_id = ?', [cid]);
  await sql.run('DELETE FROM channel_connections WHERE organization_id LIKE ?', [`${TAG}%`]);
  await sql.run('DELETE FROM channel_credentials WHERE organization_id LIKE ?', [`${TAG}%`]);

  const props = (await sql.rows('SELECT id FROM properties WHERE organization_id LIKE ?', [`${TAG}%`])).map((r) => r.id);
  for (const pid of props) {
    const resIds = (await sql.rows('SELECT id FROM reservations WHERE property_id = ?', [pid])).map((r) => r.id);
    for (const rid of resIds) {
      await sql.run('DELETE FROM guest_registrations WHERE reservation_id = ?', [rid]);
      await sql.run('DELETE FROM booking_activity_log WHERE reservation_id = ?', [rid]);
    }
    await sql.run('DELETE FROM reservations WHERE property_id = ?', [pid]);
    await sql.run('DELETE FROM units WHERE property_id = ?', [pid]);
    await sql.run('DELETE FROM unit_types WHERE property_id = ?', [pid]);
    await sql.run('DELETE FROM buildings WHERE property_id = ?', [pid]);
    await sql.run('DELETE FROM categories WHERE property_id = ?', [pid]);
  }
  await sql.run('DELETE FROM properties WHERE organization_id LIKE ?', [`${TAG}%`]);
  try { await sql.run('DELETE FROM waitlist WHERE site_id IN (SELECT id FROM booking_sites WHERE slug LIKE ?)', [`${TAG}%`]); } catch { /* table may not exist */ }
  try { await sql.run('DELETE FROM booking_sites WHERE slug LIKE ?', [`${TAG}%`]); } catch { /* table may not exist */ }
  await sql.run('DELETE FROM finance_tags WHERE organization_id LIKE ?', [`${TAG}%`]);
  // The app creates this table on first boot; cleanup may run against a
  // database the new code has not touched yet.
  try { await sql.run('DELETE FROM organization_features WHERE organization_id LIKE ?', [`${TAG}%`]); } catch { /* not yet migrated */ }
  await sql.run('DELETE FROM guests WHERE organization_id LIKE ?', [`${TAG}%`]);
  await sql.run('DELETE FROM app_users WHERE organization_id LIKE ?', [`${TAG}%`]);
  await sql.run('DELETE FROM sessions WHERE user_id LIKE ?', [`${TAG}%`]);
  await sql.run('DELETE FROM organizations WHERE id LIKE ?', [`${TAG}%`]);
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
  await cleanup();
  const a = await makeTenant('a');
  const b = await makeTenant('b');

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
    const row = await sql.row('SELECT organization_id FROM properties WHERE id = ?', [propA.id]);
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
    const afterPatch = await sql.row('SELECT name FROM properties WHERE id = ?', [propA.id]);
    assert.strictEqual(afterPatch.name, 'Probe A Hotel', 'name was changed by B');
    console.log("  ok  B cannot rename A's property");

    // B must not delete it — the failure this whole exercise exists for.
    const delB = await call(cookieB, `/api/properties/${propA.id}`, { method: 'DELETE' });
    assert.strictEqual(delB.status, 404, `B deleted A's property: ${delB.status}`);
    const stillThere = await sql.row('SELECT 1 FROM properties WHERE id = ?', [propA.id]);
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

    // The LIST, not only the writes.
    //
    // This assertion is here because it was not, and its absence hid a real
    // leak: `listUnitTypes` took `organizationId`, never used it, and returned
    // every hotel's room types. The category list two blocks up was checked
    // the same way and was correct — the unit-type list was checked for
    // creation and deletion only, so nothing ever asked what B could SEE.
    //
    // Postgres row-level security covered it in production, which is why it
    // survived: prod behaved and SQLite did not.
    const utsB = await (await call(cookieB, '/api/unit-types')).json();
    const utRows = Array.isArray(utsB) ? utsB : (utsB.unitTypes ?? utsB.unit_types ?? []);
    assert.ok(!utRows.some((t) => t.id === utA.id), "B's unit-type list contains A's room type");
    console.log("  ok  B's unit-type list excludes A's room type");

    const bulkB = await call(cookieB, '/api/units', {
      method: 'POST',
      body: JSON.stringify({
        bulk: true, property_id: propA.id, category_id: catA.id, unit_type_id: utA.id,
        prefix: 'HIJACK', from: 1, to: 50,
      }),
    });
    assert.strictEqual(bulkB.status, 404, `B bulk-created units in A's property: ${bulkB.status}`);
    const leaked = await sql.row('SELECT COUNT(*) c FROM units WHERE property_id = ?', [propA.id]);
    assert.strictEqual(leaked.c, 0, `${leaked.c} units were written into A's property by B`);
    console.log("  ok  B cannot bulk-create 50 units inside A's property");

    // ── The guest page's configuration ───────────────────────────────────
    // Wi-Fi passwords, door codes and emergency phones live in these two
    // tables. The list handlers had no organization filter at all — every
    // authenticated hotel got every hotel's rows, held back only by RLS on
    // Postgres and by nothing anywhere else. Found from a settings screen
    // that mysteriously selected another tenant's property.
    const cfgAOwn = await call(cookieA, '/api/property-guest-config', {
      method: 'PUT',
      body: JSON.stringify({ property_id: propA.id, wifi_network: 'A-Net', wifi_password: 'a-secret-wifi' }),
    });
    assert.ok(cfgAOwn.ok, `A could not save its own guest config: ${cfgAOwn.status}`);

    const pgcListB = await (await call(cookieB, '/api/property-guest-config')).json();
    assert.ok(Array.isArray(pgcListB) && !pgcListB.some((c) => c.property_id === propA.id),
      "B's property-guest-config list contains A's row — with A's wifi password in it");

    const pgcPutB = await call(cookieB, '/api/property-guest-config', {
      method: 'PUT',
      body: JSON.stringify({ property_id: propA.id, wifi_password: 'stolen' }),
    });
    assert.ok([403, 404].includes(pgcPutB.status),
      `B wrote into A's property guest config: ${pgcPutB.status}`);
    const wifiAfter = await sql.row(
      'SELECT wifi_password FROM property_guest_config WHERE property_id = ?', [propA.id]);
    assert.strictEqual(wifiAfter?.wifi_password, 'a-secret-wifi',
      "B's write reached A's wifi password");
    console.log("  ok  B can neither read nor rewrite A's property guest config");

    const utCfgAOwn = await call(cookieA, `/api/guest-page-config/${utA.id}`, {
      method: 'PUT', body: JSON.stringify({ lock_code: '1111#' }),
    });
    assert.ok(utCfgAOwn.ok, `A could not save its unit-type guest config: ${utCfgAOwn.status}`);

    const gpcListB = await (await call(cookieB, '/api/guest-page-config')).json();
    assert.ok(Array.isArray(gpcListB) && !gpcListB.some((c) => c.unit_type_id === utA.id),
      "B's guest-page-config list contains A's row — the door code travels with it");

    const gpcPutB = await call(cookieB, `/api/guest-page-config/${utA.id}`, {
      method: 'PUT', body: JSON.stringify({ lock_code: '0000#' }),
    });
    assert.ok([403, 404].includes(gpcPutB.status),
      `B rewrote A's door code: ${gpcPutB.status}`);
    const lockAfter = await sql.row(
      'SELECT lock_code FROM guest_page_config WHERE unit_type_id = ?', [utA.id]);
    assert.strictEqual(lockAfter?.lock_code, '1111#', "B's write reached A's door code");
    console.log("  ok  B can neither read nor rewrite A's unit-type guest config");

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
    const storedA = await sql.row('SELECT client_id FROM channel_credentials WHERE id = ?', [credA.id]);
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
    const mapped = await sql.row('SELECT COUNT(*) c FROM channel_room_mapping WHERE connection_id = ?', [connA.id]);
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
    const tagRow = await sql.row('SELECT organization_id FROM finance_tags WHERE name = ?', [`probe-tag-${TAG}`]);
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
    const userA = await sql.row('SELECT full_name, is_active FROM app_users WHERE id = ?', [a.userId]);
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
    const pinRow = await sql.row('SELECT payment_pin_hash FROM app_users WHERE id = ?', [a.userId]);
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
    await sql.run(`
      INSERT INTO units (id, property_id, category_id, unit_type_id, name, code)
      VALUES (?, ?, ?, ?, 'Probe unit', 'PRB-1')
    `, [`${TAG}unit_a`, propA.id, catA.id, utA.id]);

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

    // ── The manual discount, from the field reception types into to the row
    //    the modal reopens with ────────────────────────────────────────────
    //
    // Not isolation, and here anyway: this is the only place in the repository
    // where a real booking exists behind a real session on the engine that
    // serves customers, and the discount is written by one request and read
    // back by another.
    //
    // What it caught: the booking modal opens from a row of the LIST, and the
    // list's SELECT names its columns one by one. The discount columns were
    // added to the table, to the detail query and to PATCH — and not to that
    // list. The field would then show 0 % on a booking that has 20 %, and the
    // first time anyone touched it, that zero would be written back over the
    // discount. Nothing would have failed; the reduction would simply have
    // stopped existing.
    const setDiscount = await call(cookieA, `/api/bookings/${booking.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ lodging_discount_percent: 20, lodging_discount_reason: 'Stammkunde' }),
    });
    assert.ok(setDiscount.ok, `A could not grant a discount: ${setDiscount.status}`);
    const withDiscount = (await (await call(cookieA, '/api/bookings')).json())
      .find((r) => r.id === booking.id);
    assert.strictEqual(Number(withDiscount.lodging_discount_percent), 20,
      'the booking list does not carry the discount — the modal would show 0 % and overwrite it');
    assert.strictEqual(withDiscount.lodging_discount_reason, 'Stammkunde',
      'the booking list does not carry the reason the discount was granted');
    console.log('  ok  a granted discount comes back in the list the modal opens from');

    // A percent typed with a stray minus is an ordinary slip at a reception
    // desk. The answer to it is the number the hotel meant, not a 500 from the
    // CHECK constraint — and never a negative discount, which raises a guest's
    // bill from a box labelled "discount".
    for (const [typed, stored] of [[-5, 0], [150, 100]]) {
      const r = await call(cookieA, `/api/bookings/${booking.id}`, {
        method: 'PATCH', body: JSON.stringify({ lodging_discount_percent: typed }),
      });
      assert.ok(r.ok, `${typed} % answered ${r.status} instead of being clamped`);
      const now = await (await call(cookieA, `/api/bookings/${booking.id}`)).json();
      assert.strictEqual(Number(now.lodging_discount_percent), stored,
        `${typed} % was stored as ${now.lodging_discount_percent}, not ${stored}`);
    }
    console.log('  ok  −5 % becomes 0 and 150 % becomes 100, without an error page');

    // Left at a value B will not use, so that "B's write did not land" is
    // distinguishable from "B wrote what was already there".
    await call(cookieA, `/api/bookings/${booking.id}`, {
      method: 'PATCH', body: JSON.stringify({ lodging_discount_percent: 10 }),
    });

    const readBookB = await call(cookieB, `/api/bookings/${booking.id}`);
    assert.strictEqual(readBookB.status, 404, `B read A's booking: ${readBookB.status}`);
    const patchBookB = await call(cookieB, `/api/bookings/${booking.id}`, {
      method: 'PATCH', body: JSON.stringify({ notes: 'hijack' }),
    });
    assert.strictEqual(patchBookB.status, 404, `B patched A's booking: ${patchBookB.status}`);
    // Named separately from `notes` because it moves money: a discount granted
    // by the wrong hotel reduces this hotel's revenue on this hotel's invoice.
    const discountB = await call(cookieB, `/api/bookings/${booking.id}`, {
      method: 'PATCH', body: JSON.stringify({ lodging_discount_percent: 100 }),
    });
    assert.strictEqual(discountB.status, 404, `B discounted A's booking: ${discountB.status}`);
    const stillA = await (await call(cookieA, `/api/bookings/${booking.id}`)).json();
    assert.strictEqual(Number(stillA.lodging_discount_percent), 10,
      `B's discount reached A's booking: ${stillA.lodging_discount_percent} %`);
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
    // Asserted, not skipped. `if (siteRes.ok)` meant a refused site creation
    // read exactly like six passing isolation checks — and it did: against
    // Postgres this route quietly stopped working, six assertions never ran,
    // and the failure surfaced eighty lines later as a widget answering 404.
    // A check that skips itself when the setup fails is not a check.
    assert.ok(siteRes.ok, `A could not create a booking site: ${siteRes.status} ${await siteRes.clone().text()}`);
    const siteA = await siteRes.json();
    const siteId = siteA.id || siteA.site?.id;
    assert.ok(siteId, `no site id came back: ${JSON.stringify(siteA)}`);

    for (const view of ['overview', 'traffic', 'geo', 'listings', 'campaigns', 'funnel']) {
      const leak = await call(cookieB, `/api/booking-sites/${siteId}/analytics/${view}`);
      assert.strictEqual(leak.status, 404, `B read A's analytics/${view}: ${leak.status}`);
    }
    const own = await call(cookieA, `/api/booking-sites/${siteId}/analytics/overview`);
    assert.ok(own.ok, `A cannot read its own analytics: ${own.status}`);
    console.log("  ok  B cannot read A's site analytics, A still can");

    // 'all' must mean "all of MINE". It expanded to `1=1` — every reservation
    // on the server — which read correctly only while there was one hotel.
    const allB = await call(cookieB, '/api/booking-sites/all/analytics/overview');
    assert.ok(allB.ok, `'all sites' refused B: ${allB.status} ${await allB.clone().text()}`);
    const allBody = await allB.json();
    assert.strictEqual(allBody?.current?.revenue ?? 0, 0,
      "B's 'all sites' revenue is not zero — it is counting somebody else's");
    console.log("  ok  'all sites' counts only the caller's own");

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
    // Asserted first, then read. Six blocks here used to be `if (x.ok)`
    // alone: a route that started refusing printed nothing — no failure,
    // no "ok" line — and the run ended green having checked less than it
    // claimed. The `if` stays only so the bodies need no reindenting.
    assert.ok(dashB.ok, `B's dashboard was refused: ${dashB.status}`);
    if (dashB.ok) {
      const d = await dashB.json();
      assert.strictEqual(d.totalUnits, 0, `B's dashboard counts ${d.totalUnits} units it does not own`);
      assert.strictEqual((d.upcomingArrivals || []).length, 0, "B's dashboard lists arrivals it does not own");
      assert.strictEqual((d.todayDepartures || []).length, 0, "B's dashboard lists departures it does not own");
      console.log("  ok  the dashboard counts only the caller's own hotel");
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

    // ── A room reception sells and the website must not ─────────────────
    // The pilot's Appartements: «online nicht buchbar, nur auf Anfrage».
    // bookable_online=false must keep a type out of the PUBLIC widget config
    // — the endpoint any visitor can call — while the type stays fully
    // visible to the staff. Hiding it from the admin instead would be the
    // inverse bug: a room nobody can sell.
    const widgetOnA = await call(cookieA, '/api/settings/features', {
      method: 'PUT', body: JSON.stringify({ feature: 'widget', enabled: true }),
    });
    assert.ok(widgetOnA.ok, `enabling the widget for A failed: ${widgetOnA.status}`);

    const offlineType = await call(cookieA, '/api/unit-types', {
      method: 'POST',
      body: JSON.stringify({
        property_id: propA.id, category_id: catA.id,
        name: 'Desk-only type', code: 'PRB-OFF', bookable_online: false,
      }),
    });
    assert.strictEqual(offlineType.status, 201, `offline type not created: ${offlineType.status}`);
    const offType = await offlineType.json();

    // Public endpoint on purpose — no cookie. This is what the internet sees.
    const pubConfig = await fetch(`${BASE}/api/widget/config?propertyId=${propA.id}`);
    assert.ok(pubConfig.ok, `public widget config refused: ${pubConfig.status}`);
    const pubTypes = (await pubConfig.json()).unitTypes ?? [];
    assert.ok(pubTypes.some((t) => t.id === utA.id),
      'the sellable type disappeared from the public widget');
    assert.ok(!pubTypes.some((t) => t.id === offType.id),
      'a desk-only type (bookable_online=false) is offered on the public widget');

    // …while the staff list still carries it — otherwise reception cannot
    // sell the room either, and the flag would just be a slower is_active.
    const staffTypes = await (await call(cookieA, '/api/unit-types')).json();
    const staffRows = Array.isArray(staffTypes) ? staffTypes : (staffTypes.unitTypes ?? []);
    assert.ok(staffRows.some((t) => t.id === offType.id),
      'the desk-only type vanished from the staff list too');
    console.log('  ok  a desk-only room type is invisible to the widget, visible to staff');

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
    const taskRow = await sql.row('SELECT title FROM tasks WHERE id = ?', [tA.id]);
    assert.strictEqual(taskRow.title, 'Probe A: fix the boiler', "B renamed A's task");

    await call(cookieB, `/api/tasks/${tA.id}`, { method: 'DELETE' });
    assert.ok(await sql.row('SELECT 1 FROM tasks WHERE id = ?', [tA.id]), "B deleted A's task");
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
    assert.ok(repB.ok, `B's report was refused: ${repB.status}`);
    if (repB.ok) {
      const r = await repB.json();
      assert.strictEqual(r.summary.totalBookings, 0, `B's report counts ${r.summary.totalBookings} bookings it does not own`);
      assert.strictEqual(r.summary.totalRevenue, 0, "B's report sums revenue it does not own");
      console.log("  ok  B's report counts only its own bookings");
    }

    const taxB = await call(cookieB, '/api/reports/city-tax?month=2025-01');
    assert.ok(taxB.ok, `B's city-tax return was refused: ${taxB.status}`);
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
    assert.ok(alertsB.ok, `B's alerts was refused: ${alertsB.status}`);
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
    assert.ok(savedKey.ok, `saving an integration key was refused: ${savedKey.status}`);
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
    await cleanup();
  }
}

main().catch((e) => {
  // The finally block has already cleaned up and closed the handle. Touching
  // it again here threw "database connection is not open" — which is what got
  // printed, instead of the assertion that actually failed.
  console.error('isolation CHECK FAILED:', e.message);
  process.exit(1);
});
