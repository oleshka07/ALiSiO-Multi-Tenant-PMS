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
  // Children first: foreign keys are ON.
  await sql.run('DELETE FROM channel_credentials WHERE organization_id LIKE ?', [`${TAG}%`]);
  await sql.run('DELETE FROM fin_operation_audit WHERE organization_id LIKE ?', [`${TAG}%`]);
  await sql.run('DELETE FROM fin_operations WHERE organization_id LIKE ?', [`${TAG}%`]);
  await sql.run('DELETE FROM finance_accounts WHERE organization_id LIKE ?', [`${TAG}%`]);
  await sql.run('DELETE FROM tasks WHERE organization_id LIKE ?', [`${TAG}%`]);
  await sql.run('DELETE FROM business_units WHERE organization_id LIKE ?', [`${TAG}%`]);
  const icalIds = (await sql.rows(
    'SELECT ic.id FROM ical_channels ic JOIN properties p ON ic.property_id = p.id WHERE p.organization_id LIKE ?',
    [`${TAG}%`])).map((r) => r.id);
  for (const cid of icalIds) {
    await sql.run('DELETE FROM ical_sync_log WHERE channel_id = ?', [cid]);
    await sql.run('DELETE FROM ical_channels WHERE id = ?', [cid]);
  }

  const props = (await sql.rows('SELECT id FROM properties WHERE organization_id LIKE ?', [`${TAG}%`])).map((r) => r.id);
  for (const pid of props) {
    const resIds = (await sql.rows('SELECT id FROM reservations WHERE property_id = ?', [pid])).map((r) => r.id);
    for (const rid of resIds) {
      await sql.run('DELETE FROM guest_registrations WHERE reservation_id = ?', [rid]);
      await sql.run('DELETE FROM booking_activity_log WHERE reservation_id = ?', [rid]);
    }
    await sql.run('DELETE FROM reservations WHERE property_id = ?', [pid]);
    await sql.run('DELETE FROM reservation_groups WHERE property_id = ?', [pid]);
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

    // B needs real inventory of its own, not just an account.
    //
    // Several probes below ask "can A reach into B?" and need a B-owned unit
    // to aim at. Without one they quietly skipped — `if (unitOfB?.id)` around
    // an assertion reads exactly like a passing check, which is the failure
    // mode this file already learned once with `if (siteRes.ok)`.
    const createdB = await call(cookieB, '/api/properties', {
      method: 'POST',
      body: JSON.stringify({ name: 'Probe B Hotel', slug: `${TAG}b-hotel` }),
    });
    assert.strictEqual(createdB.status, 201, `B could not create a property: ${createdB.status}`);
    const propB = await createdB.json();
    const catBRes = await call(cookieB, '/api/categories', {
      method: 'POST',
      body: JSON.stringify({ property_id: propB.id, name: 'B rooms', type: 'resort' }),
    });
    assert.ok(catBRes.ok, `B could not create a category: ${catBRes.status}`);
    const catB = await catBRes.json();
    const utBRes = await call(cookieB, '/api/unit-types', {
      method: 'POST',
      body: JSON.stringify({ property_id: propB.id, category_id: catB.id, name: 'B type', code: 'BPR' }),
    });
    assert.ok(utBRes.ok, `B could not create a unit type: ${utBRes.status}`);
    const utB = await utBRes.json();
    const unitBRes = await call(cookieB, '/api/units', {
      method: 'POST',
      body: JSON.stringify({
        property_id: propB.id, category_id: catB.id, unit_type_id: utB.id,
        name: 'B-101', code: 'B101',
      }),
    });
    assert.ok(unitBRes.ok, `B could not create a unit: ${unitBRes.status} ${await unitBRes.clone().text()}`);
    const unitB = await unitBRes.json();
    assert.ok(unitB.id, `no unit id came back for B: ${JSON.stringify(unitB).slice(0, 200)}`);

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

    // An uploaded file is a guest's passport as often as it is a logo. The
    // read route used to check only that there WAS a session, because the
    // stored path said nothing about whose file it was — so B, logged in as
    // itself, could fetch A's registration scans by name. The name was
    // `${original}_${Date.now()}`, which is a range, not a secret.
    //
    // Uploaded as a real file through the real route, then fetched by the
    // neighbour, because the interesting part is what the URL alone gets you.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64');
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'passport-scan.png');
    form.append('folder', 'registrations');
    const upRes = await fetch(`${BASE}/api/file-upload`, {
      method: 'POST', headers: { cookie: cookieA }, body: form,
    });
    assert.ok(upRes.ok, `A could not upload a file: ${upRes.status}`);
    const { url: fileUrl } = await upRes.json();

    const ownRead = await call(cookieA, fileUrl);
    assert.ok(ownRead.ok, `A cannot read its own upload: ${ownRead.status}`);

    const neighbourRead = await call(cookieB, fileUrl);
    assert.strictEqual(neighbourRead.status, 404,
      `B read A's uploaded document: ${neighbourRead.status} — this is the leak`);

    // And the old shape, with no organization in it, must not resolve either:
    // that is the path every legacy row still carries.
    const legacyShape = await call(cookieB, `/api/uploads/registrations/${fileUrl.split('/').pop()}`);
    assert.strictEqual(legacyShape.status, 404,
      `the pre-migration path still serves files: ${legacyShape.status}`);
    console.log("  ok  B cannot read A's uploaded documents, by new path or old");

    // The channel-manager probes that stood here — save credentials, create a
    // connection, map a room — spoke to /api/channels/*, which was the
    // Connectivity API of Booking.com and is deleted. `channel_credentials`
    // itself survived (fiscalisation keys live there) and its isolation is
    // still proven end to end, further down, through
    // /api/settings/integration-credentials.

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

    // ── Finance objects, addressed by id ────────────────────────────────
    //
    // The list and create handlers named the organization; get, update, delete
    // and merge did not — they wrote `WHERE id = ?` and left the rest to RLS.
    // On SQLite there is no policy at all and the ids are `inc_${Date.now()}`,
    // which is a range to walk rather than a secret.
    const accARes = await call(cookieA, '/api/finance/accounts', {
      method: 'POST',
      body: JSON.stringify({ name: 'A cash', type: 'cash', currency: 'EUR', initial_balance: 100 }),
    });
    assert.ok(accARes.ok, `A could not create a finance account: ${accARes.status}`);
    const accA = await accARes.json();
    assert.ok(accA?.id, `no account id came back: ${JSON.stringify(accA).slice(0, 200)}`);

    const accListB = await (await call(cookieB, '/api/finance/accounts')).json();
    assert.ok(!(accListB || []).some((x) => x.id === accA.id),
      "B's account list contains A's bank account");

    const renameAcc = await call(cookieB, '/api/finance/accounts', {
      method: 'PATCH', body: JSON.stringify({ id: accA.id, name: 'hijacked', iban: 'DE00 EVIL' }),
    });
    assert.strictEqual(renameAcc.status, 404, `B renamed A's account: ${renameAcc.status}`);
    const accAfter = await sql.row('SELECT name FROM finance_accounts WHERE id = ?', [accA.id]);
    assert.strictEqual(accAfter?.name, 'A cash', "B's rename reached A's bank account");

    const killAcc = await call(cookieB, `/api/finance/accounts/${accA.id}`, { method: 'DELETE' });
    assert.strictEqual(killAcc.status, 404, `B deleted A's account: ${killAcc.status}`);
    assert.ok(await sql.row('SELECT 1 FROM finance_accounts WHERE id = ?', [accA.id]),
      "B's delete removed A's bank account");

    // The audit trail of finance operations. Its own docstring said «ALL audit
    // entries across all operations», and the WHERE started empty — every
    // entry carries before_json/after_json, so this was the ledgers of every
    // hotel on the server, searchable with ?search=.
    const histB = await call(cookieB, '/api/finance/history?limit=500');
    assert.ok(histB.ok, `B could not read its own finance history: ${histB.status}`);
    const histItems = (await histB.json()).items || [];
    const foreignHist = [];
    for (const h of histItems) {
      const own = await sql.row(
        'SELECT 1 x FROM fin_operation_audit WHERE id = ? AND organization_id = ?', [h.id, b.orgId]);
      if (!own) foreignHist.push(h.id);
    }
    assert.strictEqual(foreignHist.length, 0,
      `B's finance history carries ${foreignHist.length} entr(ies) from other hotels' ledgers`);
    console.log("  ok  B cannot read, rename or delete A's finance objects, nor read A's ledger history");

    // ── The last of the id-shaped holes ─────────────────────────────────
    // A gets a real room, through the real API. Until now A owned a property,
    // a category and a room TYPE but no unit at all — the fifty units in the
    // probe above are B's refused attempt, not A's inventory — so anything
    // aimed at "a room of A's" had nothing to aim at.
    const unitARes = await call(cookieA, '/api/units', {
      method: 'POST',
      body: JSON.stringify({
        property_id: propA.id, category_id: catA.id, unit_type_id: utA.id,
        name: 'A-101', code: 'A101',
      }),
    });
    assert.ok(unitARes.ok, `A could not create a unit: ${unitARes.status} ${await unitARes.clone().text()}`);
    const aUnit = await unitARes.json();
    assert.ok(aUnit?.id, `no unit id came back for A: ${JSON.stringify(aUnit).slice(0, 200)}`);


    // C11 — iCal channels. The rows carry the import URL a hotel got from its
    // OTA and the export token that IS the credential for its own calendar
    // feed: hand that token to anyone and they read every arrival, departure
    // and guest name in it, with no session at all.
    const icalARes = await call(cookieA, '/api/ical-sync/channels', {
      method: 'POST',
      body: JSON.stringify({
        channel_type: 'unit', unit_id: aUnit.id, source_code: 'vrbo',
        ical_url: 'https://example.invalid/a.ics', sync_interval_minutes: 15,
      }),
    });
    assert.ok(icalARes.ok, `A could not create an iCal channel: ${icalARes.status} ${await icalARes.clone().text()}`);
    const icalA = await icalARes.json();
    assert.ok(icalA?.id, `no iCal channel id came back: ${JSON.stringify(icalA).slice(0, 200)}`);

    const icalListB = await (await call(cookieB, '/api/ical-sync/channels')).json();
    assert.ok(!(icalListB || []).some((c) => c.id === icalA.id),
      "B's iCal channel list contains A's channel — with A's export token in it");

    const repoint = await call(cookieB, `/api/ical-sync/channels/${icalA.id}`, {
      method: 'PUT', body: JSON.stringify({ ical_url: 'https://evil.invalid/feed.ics' }),
    });
    assert.strictEqual(repoint.status, 404, `B repointed A's iCal import: ${repoint.status}`);
    const icalAfter = await sql.row('SELECT ical_url FROM ical_channels WHERE id = ?', [icalA.id]);
    assert.strictEqual(icalAfter?.ical_url, 'https://example.invalid/a.ics',
      "B's write reached A's iCal import URL — fabricated bookings would block A's rooms");
    const icalKill = await call(cookieB, `/api/ical-sync/channels/${icalA.id}`, { method: 'DELETE' });
    assert.strictEqual(icalKill.status, 404, `B deleted A's iCal channel: ${icalKill.status}`);

    // C14 — the business-unit picker. `WHERE is_active` and nothing else, so
    // one hotel's tasks screen offered the neighbour's departments by name.
    const buB = await (await call(cookieB, '/api/business-units')).json();
    assert.ok(Array.isArray(buB), 'business units did not come back as an array');
    for (const u of buB) {
      const own = await sql.row(
        'SELECT 1 x FROM business_units WHERE id = ? AND organization_id = ?', [u.id, b.orgId]);
      assert.ok(own, `B's business-unit picker offers ${u.id}, which is not B's`);
    }
    console.log("  ok  B cannot see or repoint A's iCal channels, nor A's business units");

    // ── A task can be tied to an object, and it stays tied ──────────────
    //
    // `tasks.property_id` has a foreign key to `properties(id)`, and the picker
    // on the tasks screen was filled from /api/business-units — the wrong
    // table. On Postgres the write was refused by that key; on SQLite it was
    // stored pointing at nothing. The field had never once saved, in either
    // engine, and the UI reported success both times because the PATCH result
    // was never looked at. So: write it, then READ IT BACK, because "the
    // request returned 200" is exactly the evidence that was trusted before.
    const objTaskRes = await call(cookieA, '/api/tasks', {
      method: 'POST', body: JSON.stringify({ title: `${TAG}object-probe` }),
    });
    assert.ok(objTaskRes.ok, `A could not create a task: ${objTaskRes.status}`);
    const objTask = await objTaskRes.json();
    assert.ok(objTask?.id, `no task id came back: ${JSON.stringify(objTask).slice(0, 200)}`);

    const tie = await call(cookieA, `/api/tasks/${objTask.id}`, {
      method: 'PATCH', body: JSON.stringify({ property_id: propA.id }),
    });
    assert.ok(tie.ok, `tying a task to an object was refused: ${tie.status} ${await tie.clone().text()}`);
    const tied = await sql.row('SELECT property_id FROM tasks WHERE id = ?', [objTask.id]);
    assert.strictEqual(tied?.property_id, propA.id,
      `the task's object was not saved (${tied?.property_id}) — this is the bug the screen hid`);

    // And a business-unit id must NOT be accepted in that field: that is what
    // the picker used to offer, and taking it would put the foreign key back
    // in the position of being the only thing saying no.
    // Seeded, not looked for: the assertion has to run, and nothing else in
    // this file creates a business unit. With the old picker this exact value
    // is what the screen sent, and it answers 500 from the foreign key —
    // verified by pointing the probe at it.
    await sql.run('INSERT INTO business_units (id, organization_id, name) VALUES (?, ?, ?)',
      [`${TAG}bu_a`, a.orgId, 'Probe BU']);
    await call(cookieA, `/api/tasks/${objTask.id}`, {
      method: 'PATCH', body: JSON.stringify({ property_id: `${TAG}bu_a` }),
    });
    const after = await sql.row('SELECT property_id FROM tasks WHERE id = ?', [objTask.id]);
    assert.strictEqual(after?.property_id, propA.id,
      `a business-unit id reached tasks.property_id (${after?.property_id}), which points at properties`);
    console.log('  ok  задачу можна прив\'язати до обʼєкта, і вона лишається прив\'язаною');

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

    // ── Four more ways into somebody else's booking ─────────────────────
    //
    // `reservations` has no organization_id of its own — the tenant arrives
    // through property_id — so a handler that writes `WHERE id = ?` is not
    // "relying on RLS", it is asking nothing at all.

    // C4 — moving a booking onto somebody else's room. A owns the booking, so
    // the ownership check on the BOOKING passes; the unit id came from the
    // request body and was written straight through. The booking would then
    // sit on the neighbour's calendar, and the overlap check below it would
    // run against the wrong hotel's inventory.
    const moveOntoB = await call(cookieA, `/api/bookings/${booking.id}`, {
      method: 'PATCH', body: JSON.stringify({ unit_id: unitB.id }),
    });
    assert.strictEqual(moveOntoB.status, 404,
      `A moved its booking onto B's room: ${moveOntoB.status}`);
    const movedTo = await sql.row('SELECT unit_id FROM reservations WHERE id = ?', [booking.id]);
    assert.notStrictEqual(movedTo?.unit_id, unitB.id,
      "the booking landed on B's room — B's calendar now shows a stay nobody there made");

    // C3 — sub-bookings, addressed by the master reservation id.
    const subList = await call(cookieB, `/api/bookings/${booking.id}/sub-bookings`);
    assert.strictEqual(subList.status, 404, `B listed A's sub-bookings: ${subList.status}`);
    const subAdd = await call(cookieB, `/api/bookings/${booking.id}/sub-bookings`, {
      method: 'POST', body: JSON.stringify({ label: 'intruder', adults: 1 }),
    });
    assert.strictEqual(subAdd.status, 404, `B added a sub-booking to A's reservation: ${subAdd.status}`);

    // C5 — the audit trail. `role === 'owner'` is true for the owner of every
    // hotel on the server, and with no reservation_id the query named no
    // organization: every entry from every tenant came back, each carrying
    // before_json/after_json — whole row snapshots of other hotels' bookings,
    // guest ids, prices and internal notes included. One GET, no parameters.
    const auditB = await call(cookieB, '/api/audit/bookings?limit=200');
    assert.ok(auditB.ok, `B could not read its own audit trail: ${auditB.status}`);
    const auditItems = (await auditB.json()).items || [];
    const foreign = auditItems.filter((e) => e.reservation_id === booking.id);
    assert.strictEqual(foreign.length, 0,
      `B's audit trail carries ${foreign.length} entr(ies) about A's booking, with full row snapshots`);

    // C2 — group bookings. The list named no tenant; creation took unitIds
    // and buildingId from the body, and then filed the group under whichever
    // property the FIRST of those rooms belonged to.
    const groupsB = await call(cookieB, '/api/group-bookings');
    assert.ok(groupsB.ok, `B could not list its own group bookings: ${groupsB.status}`);
    const groupList = await groupsB.json();
    assert.ok(Array.isArray(groupList), 'group list is not an array');
    const foreignGroups = groupList.filter((g) => g.property_id === propA.id);
    assert.strictEqual(foreignGroups.length, 0,
      "B's group-booking list contains A's groups, guest name and phone attached");

    const groupOnA = await call(cookieB, '/api/group-bookings', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Intruder', lastName: 'Probe',
        checkIn: '2027-03-01', checkOut: '2027-03-03',
        unitIds: [aUnit.id], groupType: 'custom',
      }),
    });
    assert.strictEqual(groupOnA.status, 404,
      `B created a group booking on A's rooms: ${groupOnA.status}`);
    const wroteGroups = await sql.row(
      "SELECT COUNT(*) c FROM reservation_groups WHERE property_id = ?", [propA.id]);
    assert.strictEqual(Number(wroteGroups.c), 0,
      `${wroteGroups.c} group(s) were written into A's property by B`);
    console.log("  ok  B cannot reach A's booking through units, sub-bookings, the audit trail or groups");

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

    // The site itself, not just its analytics. Six route files under
    // booking-sites/[id]/** checked for a session and then queried
    // `WHERE id = ?` with no tenant context at all — over an id the widget
    // publishes through /api/booking/site-config?slug=. On Postgres that meant
    // two failures at once: `booking_sites` has a uniquely permissive policy
    // (`OR app.organization_id = ''`), so the READ leaked another hotel's
    // design_config, widget_config and allowed_domains, while every WRITE was
    // refused by the same empty setting — site editing was broken for every
    // customer on production. On SQLite there is no policy, so it was plain
    // cross-tenant read, write and delete.
    //
    // Both halves are asserted, because fixing only the leak would leave the
    // product broken and fixing only the writes would leave the leak.
    for (const path of ['', '/listings', '/rate-plans', '/services']) {
      const leak = await call(cookieB, `/api/booking-sites/${siteId}${path}`);
      assert.strictEqual(leak.status, 404,
        `B read A's site${path || ''}: ${leak.status}`);
    }
    const hijack = await call(cookieB, `/api/booking-sites/${siteId}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'hijacked', allowed_domains: 'evil.example' }),
    });
    assert.strictEqual(hijack.status, 404, `B renamed A's site: ${hijack.status}`);
    const killed = await call(cookieB, `/api/booking-sites/${siteId}`, { method: 'DELETE' });
    assert.strictEqual(killed.status, 404, `B deleted A's site: ${killed.status}`);

    const siteAfterB = await sql.row('SELECT name, status FROM booking_sites WHERE id = ?', [siteId]);
    assert.strictEqual(siteAfterB?.name, 'Probe site', "B's write reached A's site name");
    assert.notStrictEqual(siteAfterB?.status, 'deleted', "B's delete reached A's site");

    // A editing its own site has to WORK. This is the half that was broken on
    // Postgres for everyone, and a fix that only tightens the read would leave
    // it broken while looking finished.
    const ownEdit = await call(cookieA, `/api/booking-sites/${siteId}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'Probe site renamed' }),
    });
    assert.ok(ownEdit.ok, `A could not edit its own site: ${ownEdit.status} ${await ownEdit.clone().text()}`);
    const renamed = await sql.row('SELECT name FROM booking_sites WHERE id = ?', [siteId]);
    assert.strictEqual(renamed?.name, 'Probe site renamed',
      "A's own edit did not reach the database — this is the production bug, not the leak");
    console.log("  ok  B cannot read or change A's site; A can edit its own");

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
      // B owns exactly one room — the one it created for itself above — and A
      // owns fifty. `=== 0` was the assertion while B owned nothing at all,
      // which meant it could not tell "scoped correctly" from "counted
      // nothing"; comparing against B's real count says the scoping works AND
      // that the dashboard is not simply empty.
      const ownedByB = await sql.row(
        'SELECT COUNT(*) c FROM units u JOIN properties p ON u.property_id = p.id WHERE p.organization_id = ?',
        [b.orgId]);
      assert.strictEqual(Number(d.totalUnits), Number(ownedByB.c),
        `B's dashboard counts ${d.totalUnits} units, B owns ${ownedByB.c}`);
      assert.ok(Number(ownedByB.c) > 0, 'B owns no units — the count proves nothing');
      assert.strictEqual((d.upcomingArrivals || []).length, 0, "B's dashboard lists arrivals it does not own");
      assert.strictEqual((d.todayDepartures || []).length, 0, "B's dashboard lists departures it does not own");
      console.log("  ok  the dashboard counts only the caller's own hotel");
    }

    // ── The feature registry ─────────────────────────────────────────────
    // Probe organizations are created after the seed migration, so they have
    // no feature rows — exactly what a brand-new customer looks like. Nothing
    // may work until a feature is switched on, and switching one on for B must
    // change nothing for A.
    // Hostex and PriceLabs used to be the two probes here. Both integrations
    // were removed — each kept its tenant in a module-level variable, so a
    // cron or a webhook ran with whoever's token was set last — and the
    // invariant they were probing is not about them. It is about the registry:
    // off until bought, and bought by one hotel is not bought by its neighbour.
    const widgetOffA = await call(cookieA, `/api/widget/config?propertyId=${propA.id}`);
    assert.strictEqual(widgetOffA.status, 403, `widget without the feature returned ${widgetOffA.status}`);
    console.log('  ok  a new organization has every integration off');

    const turnOn = await call(cookieB, '/api/settings/features', {
      method: 'PUT',
      body: JSON.stringify({ feature: 'widget', enabled: true }),
    });
    assert.ok(turnOn.ok, `enabling a feature failed: ${turnOn.status}`);

    const stillOffForA = await call(cookieA, `/api/widget/config?propertyId=${propA.id}`);
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
    // The point of per-organization credentials is that B's key bills B and
    // reaches B's account. Two things have to hold: A must not see it, and the
    // screen must not hand the raw key back to anyone — including its owner,
    // since whoever opens the page can read what it renders.
    const KEY = `fk_probe_${TAG}_wxyz9876`;
    await call(cookieB, '/api/settings/features', {
      method: 'PUT', body: JSON.stringify({ feature: 'fiscal_de', enabled: true }),
    });
    const savedKey = await call(cookieB, '/api/settings/integration-credentials', {
      method: 'PUT', body: JSON.stringify({ channel: 'fiskaly', values: { clientId: KEY } }),
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
        method: 'PUT', body: JSON.stringify({ channel: 'fiskaly', values: { clientId: 'x' } }),
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
