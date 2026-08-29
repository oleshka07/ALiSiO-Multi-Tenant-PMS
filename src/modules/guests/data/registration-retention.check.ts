/**
 * Retention anonymises where identification actually lives — and nothing else.
 *
 *   node src/modules/guests/data/registration-retention.check.ts
 *
 * anonymizeOldRegistrations has reported a healthy zero twice. Once it ran on
 * a bare connection and the Postgres policies matched nothing. Once it UPDATEd
 * `guest_registrations` — SET first_name on the consent log, a table that has
 * no such column on either engine — so every statement was refused, the
 * per-organization catch swallowed the error, and the cron answered
 * `{ success: true, anonymizedCount: 0 }` for every run. Both times the
 * failure mode was indistinguishable from "nothing was due". The only proof
 * against that class is running the real function against a real schema.
 *
 * The other direction matters just as much: the sibling inline copy (the old
 * api/cron/gdpr-retention route) anonymised every guest profile that merely
 * LACKED a recent stay — including profiles with no stays at all, i.e. the
 * hotel's hand-typed contacts. So half of this file asserts what must NOT be
 * touched.
 *
 * A throwaway database via ALISIO_DATA_DIR (the override
 * scripts/check-fresh-schema.mjs uses), never the developer's data/ — this
 * function anonymises every organization it can see.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A stray DB_DRIVER=postgres in the environment would point this at a real
// database. This check destroys data by design; it runs on SQLite only.
delete process.env.DB_DRIVER;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-retention-'));
process.env.ALISIO_DATA_DIR = dir; // read when the db module loads, below

// Aliases first, then the modules that need them — a static import of an
// aliased module would be hoisted above this line and fail.
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { _resetDb } = await import('@core/db/index.ts');
const { anonymizeOldRegistrations } = await import('./registration.repo.ts');

const sql = getSql();

// Dates relative to the wall clock, so the split stays valid on any day this
// runs: the window below is 6 months, an "old" stay ended ~13 months ago and
// a "recent" one ends next week.
const day = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const OLD_IN = day(-403);
const OLD_OUT = day(-400);
const NEW_IN = day(2);
const NEW_OUT = day(5);

async function seedStructure(org: string, name: string, slug: string) {
  await sql.run('INSERT INTO organizations(id, name, slug, language) VALUES (?,?,?,?)', [org, name, slug, 'cs']);
  await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
    [`${org}_p`, org, name, `${slug}-p`, 'CZ']);
  await sql.run('INSERT INTO categories(id, property_id, name, type) VALUES (?,?,?,?)',
    [`${org}_c`, `${org}_p`, 'Pokoj', 'hotel']);
  await sql.run('INSERT INTO unit_types(id, property_id, category_id, name, code) VALUES (?,?,?,?,?)',
    [`${org}_t`, `${org}_p`, `${org}_c`, 'DBL', 'DBL']);
  await sql.run('INSERT INTO units(id, unit_type_id, property_id, category_id, name, code) VALUES (?,?,?,?,?,?)',
    [`${org}_u`, `${org}_t`, `${org}_p`, `${org}_c`, '101', '101']);
}

async function seedGuest(id: string, org: string, first: string, last: string) {
  await sql.run(`INSERT INTO guests (id, organization_id, first_name, last_name, email, phone, whatsapp,
                 city, country, address, document_type, document_number, date_of_birth, nationality)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, org, first, last, `${id}@example.com`, '+420111222333', '+420111222333',
      'Brno', 'CZ', 'Ulice 1', 'passport', `DOC-${id}`, '1980-04-05', 'CZ']);
}

async function seedStay(res: string, org: string, guest: string, checkIn: string, checkOut: string, withRegistry: boolean, withConsentRow: boolean) {
  await sql.run(`INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                 check_in, check_out, nights, adults, children, status, payment_status, source, total_price)
                 VALUES (?,?,?,?,?,?,?,3,1,0,'checked_out','paid','direct',1000)`,
    [res, org, `${org}_p`, `${org}_u`, guest, checkIn, checkOut]);
  if (withRegistry) {
    await sql.run(`INSERT INTO reservation_guests (reservation_id, first_name, last_name, date_of_birth,
                   address, nationality, document_type, document_number, guest_id, fee_amount, fee_exempt,
                   fee_exempt_reason, purpose_of_stay, visa_number)
                   VALUES (?,?,?,?,?,?,?,?,?,0,?,NULL,'Tourism',?)`,
      [res, 'Reg', guest, '1980-04-05', 'Ulice 1', 'CZ', 'passport', `DOC-${res}`, guest, false, `VISA-${res}`]);
  }
  if (withConsentRow) {
    await sql.run(`INSERT INTO guest_registrations (id, reservation_id, guest_id, is_primary, reg_status,
                   registered_at, consent_given, consent_at, purpose_of_stay, visa_number)
                   VALUES (?,?,?,?, 'completed', CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, 'Tourism', ?)`,
      [`gr_${res}`, res, guest, true, `VISA-${res}`]);
  }
}

// ── Two hotels, four kinds of guest ─────────────────────────────────────────
await seedStructure('org_ret1', 'Retenční test A', 'retencni-a');
await seedStructure('org_ret2', 'Retenční test B', 'retencni-b');

// A: every stay past the window → registry row AND profile anonymised.
await seedGuest('ret_g_old', 'org_ret1', 'Alena', 'Stará');
await seedStay('ret_r_old', 'org_ret1', 'ret_g_old', OLD_IN, OLD_OUT, true, true);

// B: an old stay and a recent one → the old registry row anonymised, the
// recent one and the profile untouched (a returning guest keeps their record).
await seedGuest('ret_g_mix', 'org_ret1', 'Bedřich', 'Vrací');
await seedStay('ret_r_mix_old', 'org_ret1', 'ret_g_mix', OLD_IN, OLD_OUT, true, false);
await seedStay('ret_r_mix_new', 'org_ret1', 'ret_g_mix', NEW_IN, NEW_OUT, true, true);

// C: only a recent stay → nothing touched.
await seedGuest('ret_g_new', 'org_ret1', 'Cyril', 'Nový');
await seedStay('ret_r_new', 'org_ret1', 'ret_g_new', NEW_IN, NEW_OUT, false, false);

// D: no stays at all — the hand-typed contact the old inline copy wiped.
await seedGuest('ret_g_lead', 'org_ret1', 'Dana', 'Kontakt');

// E, second hotel: proves the run walks every organization, not just one.
await seedGuest('ret_g_two', 'org_ret2', 'Eva', 'Druhá');
await seedStay('ret_r_two', 'org_ret2', 'ret_g_two', OLD_IN, OLD_OUT, true, false);

// ── The run ─────────────────────────────────────────────────────────────────
const result = await anonymizeOldRegistrations(6);

// Zero failed tenants is the assertion that catches the wrong-table
// regression: a statement naming a column the table lacks throws in every
// organization, and only this counter tells that apart from "nothing was due".
assert.deepStrictEqual(result, { registrations: 3, guests: 2, failedOrganizations: 0 },
  `expected 3 registry rows + 2 profiles across both hotels, got ${JSON.stringify(result)}`);
console.log('  ok  the run counts what it did and no organization failed');

const rg = async (res: string) =>
  (await sql.row<any>('SELECT * FROM reservation_guests WHERE reservation_id = ?', [res]))!;
const guest = async (id: string) =>
  (await sql.row<any>('SELECT * FROM guests WHERE id = ?', [id]))!;
const grCount = async (res: string) =>
  (await sql.row<any>('SELECT COUNT(*) AS n FROM guest_registrations WHERE reservation_id = ?', [res]))!.n;

// The registry copy of every old stay, in both hotels.
for (const res of ['ret_r_old', 'ret_r_mix_old', 'ret_r_two']) {
  const row = await rg(res);
  assert.strictEqual(row.first_name, 'Anonymized', `${res}: first_name survived`);
  for (const col of ['date_of_birth', 'document_type', 'document_number', 'nationality', 'address', 'visa_number', 'purpose_of_stay']) {
    assert.strictEqual(row[col], null, `${res}: ${col} survived retention`);
  }
}
// …while the recent stay's registry row keeps everything.
const fresh = await rg('ret_r_mix_new');
assert.strictEqual(fresh.first_name, 'Reg', 'a recent registry row was anonymised');
assert.strictEqual(fresh.document_number, 'DOC-ret_r_mix_new', 'a recent registry row lost its document');
console.log('  ok  registry rows: old stays anonymised in both hotels, recent stay intact');

// The consent log of an old stay is gone (visa_number lived there too); the
// recent stay's row remains.
assert.strictEqual(await grCount('ret_r_old'), 0, 'consent-log row of an old stay survived');
assert.strictEqual(await grCount('ret_r_mix_new'), 1, 'consent-log row of a recent stay was deleted');
console.log('  ok  consent log: old rows deleted, recent row kept');

// Profiles: A and E fully anonymised — every column eraseGuestData clears,
// including the three (nationality, whatsapp, city) a previous version missed.
for (const id of ['ret_g_old', 'ret_g_two']) {
  const g = await guest(id);
  assert.strictEqual(g.first_name, 'Anonymized', `${id}: first_name survived`);
  assert.strictEqual(g.last_name, 'Anonymized', `${id}: last_name survived`);
  for (const col of ['date_of_birth', 'document_type', 'document_number', 'nationality',
    'email', 'phone', 'whatsapp', 'city', 'country', 'address']) {
    assert.strictEqual(g[col], null, `${id}: ${col} survived retention`);
  }
}
// B (returning), C (recent only) and D (no stays at all) keep their identity.
assert.strictEqual((await guest('ret_g_mix')).first_name, 'Bedřich', 'a returning guest was anonymised');
assert.strictEqual((await guest('ret_g_mix')).email, 'ret_g_mix@example.com', 'a returning guest lost their email');
assert.strictEqual((await guest('ret_g_new')).first_name, 'Cyril', 'a guest with only a recent stay was anonymised');
assert.strictEqual((await guest('ret_g_lead')).first_name, 'Dana', 'a contact with no stays was anonymised — the CRM-wipe bug is back');
console.log('  ok  profiles: gone for the aged-out, kept for returning, recent and stay-less guests');

// Idempotent: a second run finds nothing left to do — anonymised rows leave
// the WHERE, deleted rows do not come back.
assert.deepStrictEqual(await anonymizeOldRegistrations(6),
  { registrations: 0, guests: 0, failedOrganizations: 0 },
  'a second run touched rows again — retention is not idempotent');
console.log('  ok  a second run is a no-op');

_resetDb();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir; the OS will get it */ }

console.log('registration-retention: anonymisation hits the tables that hold identity, and only the aged-out rows');
