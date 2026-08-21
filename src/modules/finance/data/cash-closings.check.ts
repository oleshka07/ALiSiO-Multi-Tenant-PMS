/**
 * The Kassenabschluss: closed once, frozen, and honest about the till.
 *
 *   node src/modules/finance/data/cash-closings.check.ts
 *
 * Three behaviours with wrong-but-plausible twins. The closing must count
 * ONLY till methods — a bank transfer inside cash_total inflates the
 * DSFinV-K turnover. Closing a day twice must be refused, not merged: two
 * Z_NRs over the same money is the export disagreeing with itself. And the
 * closing number is sequential per property, because DSFinV-K's Z_NR is.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { setFeature } = await import('@core/features');
const { createFolio } = await import('./folio.repo.ts');
const { recordPayment } = await import('./folio-payments.repo.ts');
const { closeDay, listClosings, tillJournalCsv } = await import('./cash-closings.repo.ts');

const sql = getSql();
const ORG = 'org_closech';

async function cleanup() {
  for (const t of ['fin_cash_closings', 'fin_folio_payments', 'fin_fiscal_outages',
    'fin_invoice_tax_totals', 'invoices', 'fin_folios', 'organization_features']) {
    await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]).catch(() => {});
  }
  await sql.run("DELETE FROM properties WHERE id LIKE 'closech_%'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run('INSERT INTO organizations(id, name, slug) VALUES (?,?,?)',
  [ORG, 'Abschlusshotel', 'abschlusshotel']);

const stub = {
  async signReceipt() {
    return {
      tseSerial: 'TSE-1', txNumber: '1', signatureCounter: '1', signature: 'S',
      startTime: '2026-08-21T08:00:00Z', endTime: '2026-08-21T08:00:01Z',
      qrPayload: 'V0;...', clientId: 'c', processType: 'Kassenbeleg-V1', processData: 'Beleg^',
    };
  },
};

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['closech_p', ORG, 'Kassenhaus', 'kassenhaus-c', 'DE']);
    await setFeature(ORG, 'fiscal_de', true);
    const folio = await createFolio({
      reservationId: null, propertyId: 'closech_p', payerKind: 'guest', payerName: 'G',
    });
    await sql.run(
      `INSERT INTO invoices (id, organization_id, invoice_number, issued_at, amount, currency, status, folio_id)
       VALUES ('closech_inv', ?, 'C-1', '2026-08-21', 100, 'EUR', 'issued', ?)`, [ORG, folio]);
    await sql.run(
      `INSERT INTO fin_invoice_tax_totals (id, organization_id, invoice_id, vat_rate, gross_amount, net_amount, tax_amount)
       VALUES ('closech_tt', ?, 'closech_inv', 19, 100, 84.03, 15.97)`, [ORG]);

    const DAY = '2026-08-21';
    const pay = (amount: number, method: string, device: any = stub) => recordPayment(
      { folioId: folio, amount, method, invoiceId: 'closech_inv', paidAt: `${DAY}T10:00:00Z` },
      device ? { device } : undefined);
    await pay(60, 'cash');
    await pay(-10, 'cash');
    await pay(40, 'card_terminal');
    // The transfer must stay OUT of the till totals.
    await recordPayment({ folioId: folio, amount: 500, method: 'transfer', paidAt: `${DAY}T11:00:00Z` });
    // One failed signature — the closing must count it, not hide it.
    await recordPayment(
      { folioId: folio, amount: 5, method: 'cash', invoiceId: 'closech_inv', paidAt: `${DAY}T12:00:00Z` },
      { device: { async signReceipt(): Promise<never> { throw new Error('down'); } } });

    const made = await closeDay({ propertyId: 'closech_p', date: DAY });
    assert.strictEqual(made.closingNumber, 1, 'перше закриття — Z_NR 1');
    const row = (await listClosings({ propertyId: 'closech_p' }))[0];
    assert.strictEqual(Number(row.cash_total), 55, `готівка 60−10+5=55, не ${row.cash_total} — переказ не з каси`);
    assert.strictEqual(Number(row.card_total), 40);
    assert.strictEqual(Number(row.payments_count), 4, 'переказ не рахується касовою операцією');
    assert.strictEqual(Number(row.signed_count), 3);
    assert.strictEqual(Number(row.failed_count), 1, 'непідписана операція мусить бути ПОЛІЧЕНА, не схована');
    console.log('  ok  закриття рахує лише касу, зі знаками і зі збоями');

    await assert.rejects(closeDay({ propertyId: 'closech_p', date: DAY }),
      /already closed/, 'повторне закриття дня мало бути відмовлене');
    const next = await closeDay({ propertyId: 'closech_p', date: '2026-08-22' });
    assert.strictEqual(next.closingNumber, 2, 'номер закриття мусить бути наскрізним');
    console.log('  ok  день закривається один раз, номер наскрізний');

    const csv = await tillJournalCsv({ propertyId: 'closech_p', from: DAY, to: DAY });
    const lines = csv.split('\r\n');
    assert.strictEqual(lines.length, 1 + 4, 'журнал каси: 4 касові рядки, переказу немає');
    assert.match(lines[0], /tse_signature_counter/, 'журнал мусить нести §6-поля');
    assert.match(csv, /"C-1"/, 'номер рахунку — в журналі');
    console.log('  ok  журнал каси експортується з TSE-полями, без переказів');
  });
} finally {
  await cleanup();
}

console.log('день каси закривається один раз — і закритим лишається');
