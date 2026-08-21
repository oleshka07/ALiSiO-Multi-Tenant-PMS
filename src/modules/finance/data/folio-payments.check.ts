/**
 * The payment row and the fiscal guard.
 *
 *   node src/modules/finance/data/folio-payments.check.ts
 *
 * The single behaviour worth breaking things over: a GERMAN property with
 * the fiscal module OFF must refuse cash and card-at-the-desk — otherwise
 * this PMS quietly becomes an unregistered till under §146a AO while the
 * hotel still runs its old system. A transfer must pass (not a till
 * movement), a Czech property must pass (no KassenSichV), and switching
 * `fiscal_de` on must open the till. docs/TSE-KASSENSICHV.md §6.4, Block A.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { setFeature } = await import('@core/features');
const { createFolio } = await import('./folio.repo.ts');
const { recordPayment, listPayments } = await import('./folio-payments.repo.ts');

const sql = getSql();
const ORG = 'org_paych';

async function cleanup() {
  for (const t of ['fin_folio_payments', 'fin_folios', 'organization_features']) {
    await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]).catch(() => {});
  }
  await sql.run("DELETE FROM properties WHERE id LIKE 'paych_%'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run('INSERT INTO organizations(id, name, slug) VALUES (?,?,?)',
  [ORG, 'Kassenhotel', 'kassenhotel']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['paych_de', ORG, 'Kassenhaus', 'kassenhaus', 'DE']);
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['paych_cz', ORG, 'Penzion', 'penzion', 'CZ']);

    const deFolio = await createFolio({
      reservationId: null, propertyId: 'paych_de',
      payerKind: 'guest', payerName: 'M. Muster',
    });
    const czFolio = await createFolio({
      reservationId: null, propertyId: 'paych_cz',
      payerKind: 'guest', payerName: 'J. Novák',
    });

    // ── the guard: German till, fiscal off ─────────────────────────────────
    await assert.rejects(
      recordPayment({ folioId: deFolio, amount: 100, method: 'cash' }),
      /old till system/, 'готівка в DE без fiscal_de мала бути відмовлена');
    await assert.rejects(
      recordPayment({ folioId: deFolio, amount: 100, method: 'card_terminal' }),
      /old till system/, 'карта на рецепції — теж касовий оборот, теж відмова');
    console.log('  ok  DE без фіскального модуля: готівка і термінал відмовлені');

    // A bank transfer is not a till movement — §146a AO has nothing to sign.
    const transferId = await recordPayment({ folioId: deFolio, amount: 154, method: 'transfer' });
    assert.ok(transferId, 'переказ мусить проходити і без TSE');
    // Another country's till is not Germany's problem.
    await recordPayment({ folioId: czFolio, amount: 500, method: 'cash' });
    console.log('  ok  переказ у DE і готівка в CZ проходять без фіскального модуля');

    // ── the till opens with the feature ────────────────────────────────────
    await setFeature(ORG, 'fiscal_de', true);
    await recordPayment({ folioId: deFolio, amount: 50, method: 'cash' });
    // Money handed back keeps its sign; deleting a payment is not a thing.
    await recordPayment({ folioId: deFolio, amount: -20, method: 'cash' });
    const rows = await listPayments(deFolio);
    assert.deepStrictEqual(rows.map((p) => [p.method, Number(p.amount)]),
      [['transfer', 154], ['cash', 50], ['cash', -20]],
      'оплати фоліо: спосіб і знак мусять зберегтися як записані');
    assert.strictEqual(rows[0].property_id, 'paych_de',
      'оплата мусить знати касу (property) — без неї DSFinV-K не збереться');
    console.log('  ok  з fiscal_de готівка пишеться, повернення несе мінус, каса відома');

    // ── the honest refusals ────────────────────────────────────────────────
    // A folio with no property cannot prove its till is not German — the
    // guard fails closed rather than guessing.
    const orphan = await createFolio({ reservationId: null, payerKind: 'guest', payerName: 'X' });
    await assert.rejects(recordPayment({ folioId: orphan, amount: 10, method: 'cash' }),
      /till belongs to a place/, 'готівка на фоліо без обʼєкта мусить бути відмовлена');
    await assert.rejects(recordPayment({ folioId: deFolio, amount: 0, method: 'cash' }),
      /non-zero/, 'нульова оплата — не оплата');
    await assert.rejects(recordPayment({ folioId: deFolio, amount: 10, method: 'paypal' }),
      /method must be/, 'невідомий спосіб мусить бути відмовлений, не записаний як текст');
    await assert.rejects(recordPayment({ folioId: 'missing', amount: 10, method: 'transfer' }),
      /Folio not found/);
    console.log('  ok  нуль, невідомий спосіб і чуже фоліо — відмови');
  });
} finally {
  await cleanup();
}

console.log('оплата — факт на фоліо, і німецька каса не відкривається раніше за TSE');
