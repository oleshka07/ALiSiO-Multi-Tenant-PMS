/**
 * Спосіб оплати — рядок ГОТЕЛЮ, і клас іде З НЬОГО (0141, Д61).
 *
 *   node src/modules/invoicing/data/payment-methods.check.ts
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 * 1. Засів дав ЧОТИРИ стандартні рядки кожній організації — і кожній СВОЇ;
 * 2. клас платежу береться з рядка, а не приймається поруч із ним: рядок
 *    «Visa» з класом `card_terminal` і `method='transfer'` поруч — відмова, а
 *    не платіж, якого каса не бачить, а бухгалтерія числить карткою;
 * 3. видалити використаний спосіб не можна — названою відмовою з ЧИСЛОМ;
 *    невикористаний видаляється; `is_active` прибирає зі списку пропозицій,
 *    не чіпаючи наявних платежів;
 * 4. `settles_to_debtor` доїжджає до читача обома рушіями (SQLite віддає 0/1,
 *    Postgres — boolean).
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * * ДВІ організації: з однією «кожній свої чотири» не відрізнити від
 *   «чотири на всіх»;
 * * ДВА способи ОДНОГО класу (`card_terminal`) з РІЗНИМИ рахунками обліку —
 *   бо саме цього не вміє CHECK, і з одним твердження зелене й на коді, який
 *   і далі знає лише клас;
 * * ДВА стани `is_active`, і твердження про КІЛЬКІСТЬ у списку, а не про
 *   перший знайдений рядок (AGENTS §7: порядок рядків PGlite не доводить).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-pay-methods-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const repo = await import('./payment-methods.repo.ts');
const payments = await import('./folio-payments.repo.ts');
const folio = await import('./folio.repo.ts');

const sql = getSql();
const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

// Префікс `__pmeth_`, а не `__pm_`: `core/auth/platform-membership.check.ts`
// уже володіє `__pm_a`, `__pm_b`, `__pm_c`, і в СПІЛЬНІЙ базі `check:pg` це
// не косметика. Її прибирання робить `DELETE FROM organizations WHERE id LIKE
// '__pm\_%'`, а мої рядки `reservations` тримають ту саму організацію
// зовнішнім ключем без CASCADE — тобто її DELETE падав, `.catch(() =>
// undefined)` це ковтав, і сцена членства червоніла `organizations_pkey` про
// чужу помилку. Ідентифікатори сцен у спільній базі — простір імен.
const ORG_A = '__pmeth_a';
const ORG_B = '__pmeth_b';
const PROP = '__pmeth_prop';
const GUEST = '__pmeth_guest';
// Рахунки обліку РІЗНІ й обидва під одним класом: саме цього не вміє CHECK.
const ACC_EC = '1361';
const ACC_VISA = '1362';

// Прибирання ПЕРЕД засівом: у спільній базі `check:pg` сцена інакше падає на
// первинному ключі при другому прогоні, тобто червоніє не про те, що стверджує.
for (const org of [ORG_A, ORG_B]) {
  await runWithOrganization(org, async () => {
    for (const t of ['fin_folio_payments', 'fin_folio_items', 'fin_folios',
                     'fin_payment_methods', 'reservations', 'guests', 'properties']) {
      await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [org]).catch(() => undefined);
    }
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [org]).catch(() => undefined);
}

// Організації заводимо ПІСЛЯ прибирання — засів способів робить міграція, тож
// тут його треба відтворити тим самим запитом, що й вона: сцена стверджує
// ПРАВИЛО «кожна організація має чотири», а не «міграція колись відпрацювала».
const SEED = [['cash', 0], ['card_terminal', 1], ['transfer', 2], ['voucher', 3]] as const;
for (const org of [ORG_A, ORG_B]) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, async () => {
    for (const [code, pos] of SEED) {
      await sql.run(
        `INSERT INTO fin_payment_methods (id, organization_id, code, kind, position)
         VALUES (?, ?, ?, ?, ?)`,
        [`__pmeth_${org}_${code}`, org, code, code, pos]);
    }
  });
}

// ── 1. Чотири стандартні рядки, і кожній організації СВОЇ ────────────────
const listA = await runWithOrganization(ORG_A, () => repo.listPaymentMethods());
const listB = await runWithOrganization(ORG_B, () => repo.listPaymentMethods());
say(listA.length === 4 && listB.length === 4,
  `засів дав по чотири способи: ${listA.length} і ${listB.length}`);
say(listA.every((m) => m.organization_id === ORG_A) && listB.every((m) => m.organization_id === ORG_B),
  'і жоден рядок не з чужого рахунку');
say(listA.every((m) => m.name === null),
  'назв засів не пише — `name IS NULL` означає «стандартна назва класу»');

// ── 2. Два способи ОДНОГО класу з різними рахунками обліку ───────────────
//
// Те, чого CHECK не вміє: «картка» це не один спосіб, а кілька.
const ec = await runWithOrganization(ORG_A, () => repo.createPaymentMethod({
  code: 'card_ec', kind: 'card_terminal', name: 'EC-Karte', ledgerAccount: ACC_EC }));
const visa = await runWithOrganization(ORG_A, () => repo.createPaymentMethod({
  code: 'card_visa', kind: 'card_terminal', name: 'Visa', ledgerAccount: ACC_VISA }));
const both = await runWithOrganization(ORG_A, () => repo.listPaymentMethods());
const cards = both.filter((m) => m.kind === 'card_terminal');
say(cards.length === 3,
  `під класом «картка» тепер три способи: ${cards.length}`);
say(new Set(cards.map((m) => m.ledger_account ?? '')).size === 3,
  `і рахунки обліку в них РІЗНІ: ${cards.map((m) => m.ledger_account ?? '—').join(', ')}`);

// ── 3. Клас іде З РЯДКА, а не поруч із ним ───────────────────────────────
await runWithOrganization(ORG_A, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, ?, ?, ?)',
    [PROP, ORG_A, 'House', 'house', 'CZ']);
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    [GUEST, ORG_A, 'G', 'One']);
  await sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, guest_id, check_in, check_out,
                               nights, adults, total_price, currency, status, source)
     VALUES (?, ?, ?, ?, '2026-11-01', '2026-11-02', 1, 1, 500, 'CZK', 'confirmed', 'direct')`,
    ['__pmeth_r1', ORG_A, PROP, GUEST]);
});
const f1 = await runWithOrganization(ORG_A, () => folio.createFolio({ reservationId: '__pmeth_r1' }));

// Виняток ЛОВИТЬСЯ: сцена, яка падає стеком, у виводі `npm run check`
// читається як «сцена зламана», а не «твердження хибне». Саме так виглядав
// злом «клас не береться з рядка», поки цього `catch` не було.
const recorded = await runWithOrganization(ORG_A, async () => {
  try { return { id: await payments.recordPayment({ folioId: f1, amount: 100, methodId: visa }), err: '' }; }
  catch (e) { return { id: '', err: String((e as Error).message) }; }
});
const payId = recorded.id;
const paid = payId ? await runWithOrganization(ORG_A, () => sql.row<any>(
  'SELECT method, method_id FROM fin_folio_payments WHERE id = ? AND organization_id = ?', [payId, ORG_A])) : null;
say(paid?.method === 'card_terminal' && paid?.method_id === visa,
  `клас узятий із рядка: method=${paid?.method ?? `ВІДМОВИЛО — «${recorded.err}»`}, і рядок збережено`);

let clash = '';
await runWithOrganization(ORG_A, async () => {
  try {
    await payments.recordPayment({ folioId: f1, amount: 50, methodId: visa, method: 'transfer' });
  } catch (e) { clash = String((e as Error).message); }
});
say(/does not match/i.test(clash),
  `клас поруч із рядком, що йому суперечить, — відмова: «${clash || 'проїхало!'}»`);

// Чужий спосіб — і фоліо тут мусить бути СВОЄ.
//
// Перша редакція брала фоліо ORG_A, і твердження було зелене НЕ З ТІЄЇ
// ПРИЧИНИ: відмовляло фоліо («Folio not found»), а не спосіб, тож воно
// лишалося зеленим і на коді, який читає довідник БЕЗ орендаря. Знайшлося
// зломом, який не почервонів (§3.2.1). Тепер чуже в запиті рівно одне —
// сам спосіб.
await runWithOrganization(ORG_B, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, ?, ?, ?)',
    ['__pmeth_prop_b', ORG_B, 'House B', 'house-b', 'CZ']);
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    ['__pmeth_guest_b', ORG_B, 'G', 'Two']);
  await sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, guest_id, check_in, check_out,
                               nights, adults, total_price, currency, status, source)
     VALUES (?, ?, ?, ?, '2026-11-01', '2026-11-02', 1, 1, 500, 'CZK', 'confirmed', 'direct')`,
    ['__pmeth_r_b', ORG_B, '__pmeth_prop_b', '__pmeth_guest_b']);
});
const fB = await runWithOrganization(ORG_B, () => folio.createFolio({ reservationId: '__pmeth_r_b' }));
let foreign = '';
await runWithOrganization(ORG_B, async () => {
  try {
    await payments.recordPayment({ folioId: fB, amount: 50, methodId: visa });
  } catch (e) { foreign = String((e as Error).message); }
});
say(/Payment method not found/i.test(foreign),
  `спосіб СУСІДНЬОГО рахунку не приймається — і саме СПОСІБ: «${foreign || 'проїхало!'}»`);

// ── 4. Видалення: використаний — відмова з числом; невикористаний — можна ──
let refused = '';
await runWithOrganization(ORG_A, async () => {
  try { await repo.deletePaymentMethod(visa); }
  catch (e) { refused = String((e as Error).message); }
});
say(/already used by 1 payment/i.test(refused),
  `використаний спосіб не видаляється, і відмова каже СКІЛЬКИ: «${refused || 'видалився!'}»`);
const goneEc = await runWithOrganization(ORG_A, async () => {
  try { return await repo.deletePaymentMethod(ec) ? 'так' : 'не знайшло'; }
  catch (e) { return `ВІДМОВИЛО — «${(e as Error).message}»`; }
});
say(goneEc === 'так', `невикористаний — видаляється (щоб довідник не обростав сміттям): ${goneEc}`);

// ── 5. `is_active` прибирає з ПРОПОЗИЦІЙ, не чіпаючи наявних платежів ────
await runWithOrganization(ORG_A, () => repo.updatePaymentMethod(visa, { isActive: false }));
const offered = await runWithOrganization(ORG_A, () => repo.listPaymentMethods(true));
const all = await runWithOrganization(ORG_A, () => repo.listPaymentMethods());
say(offered.length === all.length - 1,
  `вимкнений зник із пропозицій: пропонується ${offered.length} із ${all.length}`);
say(!offered.some((m) => m.id === visa) && all.some((m) => m.id === visa),
  'але сам рядок лишився — платіж, який на нього вказує, не осиротів');
const stillPaid = await runWithOrganization(ORG_A, () => sql.row<any>(
  'SELECT method_id FROM fin_folio_payments WHERE id = ? AND organization_id = ?', [payId, ORG_A]));
say(stillPaid?.method_id === visa, 'і платіж далі вказує на нього');

// ── 6. «На дебітора» доїжджає до читача обома рушіями ───────────────────
const dep = await runWithOrganization(ORG_A, () => repo.createPaymentMethod({
  code: 'to_debtor', kind: 'transfer', name: 'Na debitora', settlesToDebtor: true }));
const depRow = await runWithOrganization(ORG_A, () => repo.getPaymentMethod(dep));
const cashRow = await runWithOrganization(ORG_A, () => repo.listPaymentMethods())
  .then((rows) => rows.find((m) => m.code === 'cash'));
say(depRow?.settles_to_debtor === true && cashRow?.settles_to_debtor === false,
  `«на дебітора» читається булевим обома рушіями: ${depRow?.settles_to_debtor} проти ${cashRow?.settles_to_debtor}`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\npayment-methods: ${fails.length} червоних`);
  process.exit(1);
}
console.log('payment-methods: довідник над класом, клас іде з рядка, використаний не видаляється');
assert.ok(true);
