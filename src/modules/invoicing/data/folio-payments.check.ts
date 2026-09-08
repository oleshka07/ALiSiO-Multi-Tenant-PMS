/**
 * The payment row, the fiscal guard, and the signature that lands with it.
 *
 *   node src/modules/invoicing/data/folio-payments.check.ts
 *
 * Block A: a GERMAN property with the fiscal module OFF must refuse cash and
 * card-at-the-desk — otherwise this PMS quietly becomes an unregistered till
 * under §146a AO while the hotel still runs its old system. A transfer must
 * pass (not a till movement), a Czech property must pass (no KassenSichV).
 *
 * Block B: with `fiscal_de` ON, a German cash payment is SIGNED — through
 * the FiscalDevice seam, fed the invoice's own VAT split — and when the TSE
 * cannot be reached the payment still goes through, but loudly: tse_failed
 * on the row, an outage entry with both timestamps, and the desk can list
 * the unsigned operations. The device here is a stub on purpose: the check
 * proves the TILL's behaviour, not fiskaly's uptime.
 * docs/TSE-KASSENSICHV.md §6.4, blocks A і B.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { setFeature } = await import('@core/features');
const { createFolio, reverseFolioPayment } = await import('./folio.repo.ts');
const { recordPayment, listPayments, unsignedPayments } = await import('./folio-payments.repo.ts');

const sql = getSql();
const ORG = 'org_paych';

async function cleanup() {
  for (const t of ['fin_folio_payments', 'fin_fiscal_outages', 'fin_fiscal_settings',
    'fin_invoice_tax_totals', 'invoices', 'fin_folios', 'organization_features']) {
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

    // ── the till opens with the feature — and signs ────────────────────────
    await setFeature(ORG, 'fiscal_de', true);

    // The beleg being signed is the invoice; German cash without one would
    // have to invent a VAT split, so it is refused.
    await assert.rejects(
      recordPayment({ folioId: deFolio, amount: 50, method: 'cash' }),
      /must name its invoice/, 'німецька готівка без рахунку мала бути відмовлена');

    await sql.run(
      `INSERT INTO invoices (id, organization_id, invoice_number, issued_at, amount, currency, status, folio_id)
       VALUES ('paych_inv', ?, 'K-1', '2026-08-21', 50, 'EUR', 'issued', ?)`,
      [ORG, deFolio]);
    await sql.run(
      `INSERT INTO fin_invoice_tax_totals (id, organization_id, invoice_id, vat_rate, gross_amount, net_amount, tax_amount)
       VALUES ('paych_tt1', ?, 'paych_inv', 7, 43, 40.19, 2.81), ('paych_tt2', ?, 'paych_inv', 19, 7, 5.88, 1.12)`,
      [ORG, ORG]);

    // The stub proves the TILL: what it was fed, and that what it returned
    // landed on the row — not fiskaly's uptime.
    const fed: any[] = [];
    const stub = {
      async signReceipt(receipt: any) {
        fed.push(receipt);
        return {
          tseSerial: 'TSE-77', txNumber: '42', signatureCounter: '1001',
          signature: 'SIG==', startTime: '2026-08-21T10:00:00Z', endTime: '2026-08-21T10:00:01Z',
          qrPayload: 'V0;swissbit;...', clientId: 'client-1',
          processType: 'Kassenbeleg-V1', processData: 'Beleg^43.00_7.00^50.00:Bar',
        };
      },
    };
    await recordPayment(
      { folioId: deFolio, amount: 50, method: 'cash', invoiceId: 'paych_inv' },
      { device: stub });
    assert.deepStrictEqual(fed[0].vatAmounts, [{ rate: 7, amount: 43 }, { rate: 19, amount: 7 }],
      'пристрій мусить отримати розбивку ПДВ РАХУНКУ, не вигадану');
    // Money handed back keeps its sign; deleting a payment is not a thing.
    await recordPayment(
      { folioId: deFolio, amount: -20, method: 'cash', invoiceId: 'paych_inv' },
      { device: stub });
    const rows = await listPayments(deFolio);
    assert.deepStrictEqual(rows.map((p) => [p.method, Number(p.amount), (p as any).tse_status ?? null]),
      [['transfer', 154, null], ['cash', 50, 'signed'], ['cash', -20, 'signed']],
      'переказ без підпису, готівка підписана, знак повернення збережено');
    const signed = rows[1] as any;
    assert.strictEqual(signed.tse_signature, 'SIG==');
    assert.strictEqual(signed.tse_tx_number, '42');
    assert.strictEqual(signed.tse_serial, 'TSE-77');
    assert.ok(signed.tse_qr_payload, 'QR-payload мусить лягти на белег');
    assert.strictEqual(rows[0].property_id, 'paych_de',
      'оплата мусить знати касу (property) — без неї DSFinV-K не збереться');
    console.log('  ok  готівка підписується розбивкою рахунку, підпис лежить на рядку');

    // ── the TSE is down: checkout passes, nothing passes silently ──────────
    const broken = { async signReceipt(): Promise<never> { throw new Error('TSE unreachable'); } };
    const failedId = await recordPayment(
      { folioId: deFolio, amount: 30, method: 'cash', invoiceId: 'paych_inv' },
      { device: broken });
    assert.ok(failedId, 'падіння TSE не сміє блокувати виїзд — оплата записана');
    const failed = (await listPayments(deFolio)).find((p) => p.id === failedId) as any;
    assert.strictEqual(failed.tse_status, 'tse_failed');
    assert.strictEqual(failed.tse_signature ?? null, null, 'підпис не вигадується');
    const outage = await sql.row<any>(
      'SELECT started_at, ended_at, note FROM fin_fiscal_outages WHERE organization_id = ?', [ORG]);
    assert.ok(outage?.started_at && outage?.ended_at,
      'збій мусить лягти в журнал із часом початку І кінця');
    assert.match(String(outage.note), /TSE unreachable/);
    const unsigned = await unsignedPayments();
    assert.strictEqual(unsigned.length, 1, 'рецепція мусить бачити непідписані операції');
    console.log('  ok  TSE лежить: оплата пройшла, tse_failed на рядку, збій у журналі');

    // No device injected and nothing configured: same loud path, not a hang.
    const unconfigured = await recordPayment(
      { folioId: deFolio, amount: 10, method: 'card_terminal', invoiceId: 'paych_inv' });
    const uRow = (await listPayments(deFolio)).find((p) => p.id === unconfigured) as any;
    assert.strictEqual(uRow.tse_status, 'tse_failed', 'несконфігурований fiskaly — теж tse_failed, не тиша');
    console.log('  ok  без конфігурації fiskaly — tse_failed і запис у журналі, виїзд не стоїть');

    // ── зустрічний рядок НІМЕЦЬКОЇ каси проходить (Р10.8) ─────────────────
    //
    // `reverseFolioPayment` знімає гроші з книги гостя, коли зникла операція в
    // фінансовій книзі. Доти він писав `method: 'cash'` літералом і БЕЗ
    // рахунку — а німецька каса з увімкненим TSE саме цього й не приймає
    // (`must name its invoice`). Тобто для сегмента, заради якого фіскальний
    // модуль і будується, зняття не проходило НІКОЛИ, і гроші лишались у
    // рахунку гостя після видалення операції — Р8.7 у повному обсязі.
    //
    // Спосіб і документ беруться з ТОГО САМОГО платежу, який знімаємо.
    const toReverse = await recordPayment(
      { folioId: deFolio, amount: 25, method: 'cash', invoiceId: 'paych_inv' },
      { device: stub });
    const takenBack = await reverseFolioPayment(toReverse);
    assert.strictEqual(takenBack, 25, 'зустрічний рядок мав зняти рівно суму платежу');
    const counter = (await listPayments(deFolio)).at(-1) as any;
    assert.strictEqual(Number(counter.amount), -25, 'зустрічний рядок мусить бути відʼємним');
    assert.strictEqual(counter.method, 'cash', 'спосіб береться з платежу, а не підставляється');
    assert.strictEqual(counter.invoice_id, 'paych_inv', 'документ береться з платежу — інакше каса відмовить');
    console.log('  ok  зустрічний рядок німецької каси носить спосіб і документ початкового платежу');

    // Чужий платіж не знімається: ідентифікатор із іншої організації —
    // «нічого не знайдено», а не «знімемо з першого фоліо, яке трапилось».
    assert.strictEqual(await reverseFolioPayment('paych_nope'), 0,
      'неіснуючий платіж не сміє нічого знімати');

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

console.log('оплата — факт на фоліо, німецька готівка носить підпис, а збій TSE — голосний');
