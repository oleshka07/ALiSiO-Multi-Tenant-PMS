/**
 * Довідник компаній: свій бачить своє, ID унікальний в межах готелю, знімок
 * платника складається з полів довідника.
 *
 *   node src/modules/companies/data/companies.repo.check.ts
 *
 * Дві організації (інваріант 26: вісь орендаря має два значення), у кожній
 * компанія з тим самим `business_id` — і це НЕ дубль (інваріант 3: UNIQUE
 * включає організацію). Дубль — той самий ID у тій самій організації.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { getSql } = await import('@core/db/async');
const repo = await import('./companies.repo.ts');
const { normalizeCompany, payerSnapshot, payerAddressLine, InvalidCompany } = await import('../domain/company.ts');
const { companyPayer } = await import('../api/kernel.ts');

const sql = getSql();
const ORG_A = '__cocomp__a';
const ORG_B = '__cocomp__b';

async function cleanup() {
  for (const org of [ORG_A, ORG_B]) {
    await sql.run('DELETE FROM companies WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

await cleanup();
for (const [org, slug] of [[ORG_A, 'cocomp-a'], [ORG_B, 'cocomp-b']]) {
  await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')", [org, slug, slug]);
}

try {
  // ── домен: нормалізація ─────────────────────────────────────────────────
  const f = normalizeCompany({
    name: '  Kempi s.r.o. ', business_id: ' 12345678 ', vat_id: '', address_country: 'cz',
    iban: 'cz65 0800 0000 1920 0014 5399', bic: 'gibaczpx', email: 'Office@Kempi.CZ',
    address_street: 'Národní 1', address_city: 'Praha', address_zip: '110 00', stray: 'ignored',
  });
  assert.deepStrictEqual(
    [f.name, f.business_id, f.vat_id, f.address_country, f.iban, f.bic, f.email],
    ['Kempi s.r.o.', '12345678', null, 'CZ', 'CZ6508000000192000145399', 'GIBACZPX', 'office@kempi.cz']);
  assert.ok(!('stray' in f), 'невідоме поле не проходить');
  assert.throws(() => normalizeCompany({ name: '   ' }), (e: any) => e instanceof InvalidCompany && e.reason === 'name_required');
  assert.throws(() => normalizeCompany({ name: 'X', address_country: 'Czechia' }), (e: any) => e instanceof InvalidCompany && e.reason === 'country_format');
  const partial = normalizeCompany({ phone: ' +420 777 ' }, true);
  assert.deepStrictEqual(partial, { phone: '+420 777' }, 'PATCH торкається лише названих полів');
  console.log('  ok  нормалізація: обрізка, країна двома літерами, IBAN/BIC без пробілів, невідоме поле відкинуте');

  // ── знімок платника ─────────────────────────────────────────────────────
  const snap = payerSnapshot(f as any);
  assert.deepStrictEqual(snap, {
    invoice_company_name: 'Kempi s.r.o.', invoice_company_ico: '12345678', invoice_company_dic: null,
    invoice_company_address: 'Národní 1', invoice_company_city: '110 00 Praha', invoice_company_country: 'CZ',
    invoice_company_email: 'office@kempi.cz',
  });
  assert.strictEqual(payerAddressLine(f as any), 'Národní 1, 110 00 Praha, CZ');
  console.log('  ok  знімок платника: ІД → ico, ДІЧ → dic, індекс і місто разом, адреса одним рядком для фоліо');

  // ── база: своє/чуже, унікальність у межах готелю ────────────────────────
  const a1 = await repo.createCompany(ORG_A, f as any);
  await assert.rejects(repo.createCompany(ORG_A, { ...f, name: 'Kempi знову' } as any),
    (e: any) => e instanceof repo.DuplicateBusinessId, 'той самий ID у тій самій організації — дубль');
  const b1 = await repo.createCompany(ORG_B, { ...f, name: 'Kempi у сусіда' } as any);
  assert.ok(b1, 'той самий ID в іншій організації — окремий рядок');
  const a2 = await repo.createCompany(ORG_A, normalizeCompany({ name: 'Без ID' }) as any);
  const a3 = await repo.createCompany(ORG_A, normalizeCompany({ name: 'Теж без ID' }) as any);
  assert.ok(a2 && a3, 'два порожні business_id не бʼються');
  console.log('  ok  business_id унікальний у межах організації; порожній не бʼється; сусід із тим самим ID — окремий рядок');

  assert.strictEqual(await repo.getCompany(ORG_B, a1), null, 'чужа компанія — null');
  assert.strictEqual(await companyPayer(ORG_B, a1), null, 'чужий платник — null');
  assert.strictEqual(await repo.updateCompany(ORG_B, a1, { name: 'Hijacked' }), false, 'чужу не перейменувати');
  assert.strictEqual((await repo.getCompany(ORG_A, a1))!.name, 'Kempi s.r.o.');
  assert.strictEqual(await repo.deleteCompany(ORG_B, a1), false, 'чужу не видалити');
  const listB = await repo.listCompanies(ORG_B);
  assert.deepStrictEqual(listB.map((c) => c.id), [b1], 'список B — лише B');
  console.log('  ok  чужа компанія не читається, не редагується, не видаляється, у списку її немає');

  // ── фільтри й архів ─────────────────────────────────────────────────────
  const withContact = await repo.listCompanies(ORG_A, { hasContact: true });
  assert.deepStrictEqual(withContact.map((c) => c.id), [a1], 'є контакти — лише Kempi');
  const withBank = await repo.listCompanies(ORG_A, { hasBank: true });
  assert.deepStrictEqual(withBank.map((c) => c.id), [a1], 'є банк — лише Kempi');
  const found = await repo.listCompanies(ORG_A, { search: '1234' });
  assert.deepStrictEqual(found.map((c) => c.id), [a1], 'пошук за ID');
  assert.ok(await repo.setCompanyArchived(ORG_A, a2, true));
  assert.deepStrictEqual((await repo.listCompanies(ORG_A)).map((c) => c.name).sort(), ['Kempi s.r.o.', 'Теж без ID'], 'архівна випала зі списку');
  assert.strictEqual((await repo.listCompanies(ORG_A, { includeArchived: true })).length, 3, 'з архівом — усі три');
  const payerArchived = await companyPayer(ORG_A, a2);
  assert.strictEqual(payerArchived?.archived, true, 'архівна читається як платник із прапорцем');
  assert.ok(await repo.setCompanyArchived(ORG_A, a2, false));
  assert.strictEqual((await repo.listCompanies(ORG_A)).length, 3, 'повернута з архіву');
  const payer = await companyPayer(ORG_A, a1);
  assert.deepStrictEqual([payer!.payer_debtor_no, payer!.payer_vat_no, payer!.payer_address], ['12345678', null, 'Národní 1, 110 00 Praha, CZ']);
  console.log('  ok  фільтри «є контакти / є банк», пошук за ID, архів ховає зі списку і не з платника');

  await assert.rejects(repo.updateCompany(ORG_A, a3, { business_id: '12345678' }),
    (e: any) => e instanceof repo.DuplicateBusinessId, 'зміна ID на зайнятий — дубль');
  assert.ok(await repo.deleteCompany(ORG_A, a3));
  assert.strictEqual(await repo.getCompany(ORG_A, a3), null);
  console.log('  ok  зміна ID на зайнятий — відмова; своя компанія видаляється');
} finally {
  await cleanup();
}

console.log('companies: свій бачить своє, ID унікальний у межах готелю, знімок платника — з довідника');
