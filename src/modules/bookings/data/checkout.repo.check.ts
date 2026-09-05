/**
 * Виселення з боргом на живій базі: політика обʼєкта × борг гостя.
 *
 *   node src/modules/bookings/data/checkout.repo.check.ts
 *
 * Домен уже доведено таблицею (`domain/checkout-balance.check.ts`); тут —
 * що читач бере політику з ПРАВИЛЬНОГО обʼєкта і борг із ПРАВИЛЬНОГО
 * джерела: фоліо, коли воно є (нараховане − оплачене, виставлений документ
 * боргу не знімає), і статус оплати броні, коли фоліо ще немає. Дві броні
 * на двох обʼєктах з різними політиками, щоб «взяв першу політику» не
 * пройшло за «взяв правильну».
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { openFolio, addCharges, recordPayment, issueInvoice } = await import('@invoicing/kernel');
const { decideCheckout } = await import('./checkout.repo.ts');

const { reservationFolioSummary } = await import('@invoicing/kernel');
const sql = getSql();
const folioOf = async (reservationId: string): Promise<string> =>
  String((await reservationFolioSummary(reservationId)).folios[0].id);
const ORG = '__cobal__org';
const P_BLOCK = '__cobal__p_block';
const P_WARN = '__cobal__p_warn';
const GUEST = '__cobal__guest';
const R_BLOCK = '__cobal__r_block';
const R_WARN = '__cobal__r_warn';
const R_NOFOLIO = '__cobal__r_nofolio';

async function cleanup() {
  // Фоліо, рядки, оплати й документи йдуть каскадом за організацією
  // (FK ON DELETE CASCADE, foreign_keys = ON): власного SQL до таблиць
  // фактурування тут немає — це чужий модуль (`check-boundaries`).
  await sql.run("DELETE FROM reservations WHERE id LIKE '__cobal__%'", []);
  await sql.run('DELETE FROM guests WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')", [ORG, 'Cobal', 'cobal']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run(
      "INSERT INTO properties (id, organization_id, name, slug, country, checkout_balance_policy) VALUES (?, ?, 'Blocking house', 'cobal-block', 'CZ', 'blocking')",
      [P_BLOCK, ORG]);
    await sql.run(
      "INSERT INTO properties (id, organization_id, name, slug, country, checkout_balance_policy) VALUES (?, ?, 'Warning house', 'cobal-warn', 'CZ', 'warning')",
      [P_WARN, ORG]);
    await sql.run(
      "INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, 'Jana', 'Nová')",
      [GUEST, ORG]);
    for (const [id, prop] of [[R_BLOCK, P_BLOCK], [R_WARN, P_WARN], [R_NOFOLIO, P_BLOCK]]) {
      await sql.run(
        `INSERT INTO reservations (id, organization_id, property_id, guest_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency)
         VALUES (?, ?, ?, ?, '2026-10-09', '2026-10-12', 3, 2, 'checked_in', 'unpaid', 3600, 'CZK')`,
        [id, ORG, prop, GUEST]);
    }

    // ── Фоліо: три ночі по 1200, одна оплата 1000 → борг 2600 ─────────────
    for (const [res] of [[R_BLOCK], [R_WARN]]) {
      const folioId = await openFolio({ reservationId: res, payerKind: 'guest', payerName: 'Jana Nová' });
      await addCharges([1200, 1200, 1200].map((price, i) => ({
        folioId, reservationId: res, serviceDate: `2026-10-${9 + i}`, kind: 'lodging' as const,
        description: `Night ${i + 1}`, quantity: 1, unitPriceGross: price, totalGross: price, vatRate: 12,
      })));
      await recordPayment({ folioId, amount: 1000, method: 'cash' });
    }

    const base = { organizationId: ORG, paymentStatus: 'unpaid', totalPrice: 3600 };

    // blocking × борг з фоліо → відмова, і сума — з фоліо (2600), не з броні (3600).
    const blocked = await decideCheckout(sql, { ...base, propertyId: P_BLOCK, reservationId: R_BLOCK });
    assert.notStrictEqual(blocked, 'not_found');
    assert.strictEqual((blocked as any).allowed, false, 'blocking з боргом мав відмовити');
    assert.strictEqual((blocked as any).balance, 2600, 'борг — нараховане мінус оплачене з фоліо');
    console.log('  ok  blocking: борг 3×1200 − 1000 = 2600 з фоліо, виселення відмовлено');

    // warning × той самий борг на іншому обʼєкті → дозволено з прапорцем.
    const warned = await decideCheckout(sql, { ...base, propertyId: P_WARN, reservationId: R_WARN });
    assert.strictEqual((warned as any).allowed, true);
    assert.strictEqual((warned as any).warning, 'unpaid_balance');
    assert.strictEqual((warned as any).balance, 2600);
    console.log('  ok  warning: те саме число, але виселення проходить із прапорцем');

    // Виставлений документ боргу не знімає: рядки лишаються нарахованими.
    const blockFolio = await folioOf(R_BLOCK);
    await issueInvoice({ folioId: blockFolio });
    const invoiced = await decideCheckout(sql, { ...base, propertyId: P_BLOCK, reservationId: R_BLOCK });
    assert.strictEqual((invoiced as any).balance, 2600, 'документ — не оплата');
    console.log('  ok  виставлений документ не є оплатою');

    // Доплата закриває борг → blocking пускає.
    await recordPayment({ folioId: blockFolio, amount: 2600, method: 'card_terminal' });
    const settled = await decideCheckout(sql, { ...base, propertyId: P_BLOCK, reservationId: R_BLOCK });
    assert.strictEqual((settled as any).allowed, true);
    assert.strictEqual((settled as any).balance, 0);
    console.log('  ok  доплата до нуля — blocking пускає');

    // Без фоліо — зі статусу броні: unpaid → вся сума → blocking відмовляє;
    // той самий рядок, позначений paid у тілі PATCH, → пускає.
    const noFolio = await decideCheckout(sql, { ...base, propertyId: P_BLOCK, reservationId: R_NOFOLIO });
    assert.strictEqual((noFolio as any).allowed, false);
    assert.strictEqual((noFolio as any).balance, 3600, 'без фоліо борг — total_price броні');
    const paidInBody = await decideCheckout(sql, { ...base, paymentStatus: 'paid', propertyId: P_BLOCK, reservationId: R_NOFOLIO });
    assert.strictEqual((paidInBody as any).allowed, true);
    console.log('  ok  без фоліо борг читається зі статусу оплати, який стане чинним');

    // Чужий або неіснуючий обʼєкт — не «політики немає».
    assert.strictEqual(await decideCheckout(sql, { ...base, propertyId: 'nope', reservationId: R_BLOCK }), 'not_found');
    console.log('  ok  обʼєкта немає — відмова, не дозвіл');
  });
} finally {
  await cleanup();
}

console.log('checkout.repo: політика — з обʼєкта броні, борг — з фоліо, без фоліо — зі статусу оплати');
