/**
 * Лічильники компанії: броні й гості рахуються лише свої (Блок 4 §2.3).
 *
 *   node src/modules/bookings/data/company-stays.repo.check.ts
 *
 * Дві організації з компаніями під одним ID (вісь орендаря, інваріант 26):
 * броні готелю Б не потрапляють у лічильник готелю А, скасована бронь не
 * рахується, один гість на двох бронях — один гість.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const { companyStays } = await import('./company-stays.repo.ts');
// Компанії — таблиця сусіда: заводяться через його двері, не SQL-ом.
const { createCompanyForTests } = await import('@companies/kernel');

const sql = getSql();
const ORG_A = '__costay__a';
const ORG_B = '__costay__b';
const ids = {
  propA: '__costay__prop_a', propB: '__costay__prop_b',
  g1: '__costay__g1', g2: '__costay__g2', gB: '__costay__gb',
};

async function cleanup() {
  await sql.run("DELETE FROM reservations WHERE id LIKE '__costay__%'", []);
  for (const org of [ORG_A, ORG_B]) {
    await sql.run('DELETE FROM guests WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

await cleanup();
for (const [org, prop, slug] of [[ORG_A, ids.propA, 'costay-a'], [ORG_B, ids.propB, 'costay-b']]) {
  await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')", [org, slug, slug]);
  await sql.run("INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, 'House', ?, 'CZ')", [prop, org, slug]);
}
await sql.run("INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, 'Eva', 'Nová')", [ids.g1, ORG_A]);
await sql.run("INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, 'Jan', 'Novák')", [ids.g2, ORG_A]);
await sql.run("INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, 'Max', 'Müller')", [ids.gB, ORG_B]);

try {
  const compA = await createCompanyForTests(ORG_A, { name: 'Kempi A', business_id: '12345678' });
  const compA2 = await createCompanyForTests(ORG_A, { name: 'Порожня A', business_id: null });
  const compB = await createCompanyForTests(ORG_B, { name: 'Kempi B', business_id: '12345678' });

  const stay = (id: string, org: string, prop: string, guest: string, company: string | null, status = 'confirmed', checkIn = '2026-10-09') => sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, guest_id, company_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency)
     VALUES (?, ?, ?, ?, ?, ?, '2026-10-11', 2, 1, ?, 'unpaid', 1000, 'CZK')`,
    [id, org, prop, guest, company, checkIn, status]);
  await stay('__costay__r1', ORG_A, ids.propA, ids.g1, compA);
  await stay('__costay__r2', ORG_A, ids.propA, ids.g1, compA, 'confirmed', '2026-11-01'); // той самий гість двічі
  await stay('__costay__r3', ORG_A, ids.propA, ids.g2, compA);
  await stay('__costay__r4', ORG_A, ids.propA, ids.g2, compA, 'cancelled'); // не рахується
  await stay('__costay__r5', ORG_A, ids.propA, ids.g2, null);              // без платника
  await stay('__costay__rb', ORG_B, ids.propB, ids.gB, compB);

  const a = await companyStays(ORG_A);
  assert.deepStrictEqual(a.get(compA), { reservations: 3, guests: 2, last_check_in: '2026-11-01' }, 'три броні, два гості, останній заїзд');
  assert.strictEqual(a.get(compA2), undefined, 'компанія без броней — без рядка');
  assert.strictEqual(a.get(compB), undefined, 'чужа компанія не рахується в А');
  const b = await companyStays(ORG_B);
  assert.deepStrictEqual(b.get(compB), { reservations: 1, guests: 1, last_check_in: '2026-10-09' });
  assert.strictEqual(b.get(compA), undefined, 'броні А не видно з Б');
  console.log('  ok  лічильники: 3 броні / 2 гості, скасована не рахується, чуже не рахується з обох боків');
} finally {
  await cleanup();
}

console.log('company-stays: броні й гості компанії рахуються лише свої');
