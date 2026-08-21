/**
 * From database rows to a German invoice document — and an honest null.
 *
 *   node src/modules/finance/data/invoice-document.repo.check.ts
 *
 * The German renderer and the §14 document model were both finished and both
 * unreachable: nothing loaded an issued invoice out of the database into
 * their input shape. This checks that middle step against real rows — a
 * German property, a folio with a named payer, an invoice issued through the
 * same issueInvoice() production uses.
 *
 * The null cases matter as much as the happy one. An invoice with no line
 * items predates folios: its money was never split by VAT rate, and a German
 * document without its MwSt-Übersicht is not a German document. The assembler
 * must refuse — the caller then falls back to the Czech renderer that made
 * the invoice. Inventing rates here would put invented tax on a legal paper.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { setFeature } = await import('@core/features');
const { createFolio, addCharges, issueInvoice, stornoInvoice } = await import('./folio.repo.ts');
const { recordPayment } = await import('./folio-payments.repo.ts');
const { loadInvoiceDocument } = await import('./invoice-document.repo.ts');
const { generateGermanInvoicePdf } = await import('../domain/invoice-pdf-de.ts');

const sql = getSql();
const ORG = 'org_dedoc';
const RES = 'dedoc_res';

async function cleanup() {
  for (const t of ['fin_folio_payments', 'fin_fiscal_settings', 'fin_fiscal_outages', 'organization_features']) {
    await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]).catch(() => {});
  }
  await sql.run('DELETE FROM fin_invoice_tax_totals WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_invoice_lines WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM invoices WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_folio_items WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_folios WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_invoice_counters WHERE organization_id = ?', [ORG]).catch(() => {});
  await sql.run("DELETE FROM reservations WHERE id LIKE 'dedoc_%'", []);
  await sql.run("DELETE FROM units WHERE id LIKE 'dedoc_%'", []);
  await sql.run("DELETE FROM unit_types WHERE id LIKE 'dedoc_%'", []);
  await sql.run("DELETE FROM categories WHERE id LIKE 'dedoc_%'", []);
  await sql.run("DELETE FROM guests WHERE id LIKE 'dedoc_%'", []);
  await sql.run("DELETE FROM properties WHERE id LIKE 'dedoc_%'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run(
  `INSERT INTO organizations(id, name, slug, language, legal_name, legal_address, vat_no, iban, bank_name)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  [ORG, 'Burghotel', 'burghotel', 'de', 'Burghotel GmbH',
   'Marktplatz 2, 07973 Greiz', 'DE811111111', 'DE02120300000000202051', 'Beispielbank']);

try {
  await runWithOrganization(ORG, async () => {
    // Country DE on the property is what makes the document German — the
    // jurisdiction resolver reads it, not the operator's language.
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['dedoc_p', ORG, 'Burg', 'burg', 'DE']);
    await sql.run('INSERT INTO categories(id, property_id, name, type) VALUES (?,?,?,?)',
      ['dedoc_c', 'dedoc_p', 'Zimmer', 'hotel']);
    await sql.run('INSERT INTO unit_types(id, property_id, category_id, name, code) VALUES (?,?,?,?,?)',
      ['dedoc_t', 'dedoc_p', 'dedoc_c', 'DZ', 'DZ']);
    await sql.run('INSERT INTO units(id, unit_type_id, property_id, category_id, name, code) VALUES (?,?,?,?,?,?)',
      ['dedoc_u', 'dedoc_t', 'dedoc_p', 'dedoc_c', '213', '213']);
    await sql.run('INSERT INTO guests(id, organization_id, first_name, last_name) VALUES (?,?,?,?)',
      ['dedoc_g', ORG, 'Maria', 'Schneider']);
    await sql.run(
      `INSERT INTO reservations(id, organization_id, property_id, unit_id, guest_id,
                                check_in, check_out, nights, adults, children, infants,
                                status, payment_status, source, total_price, currency, commission_amount)
       VALUES (?,?,?,?,?, '2026-08-04','2026-08-05',1,2,0,0,'confirmed','unpaid','direct',188.05,'EUR',0)`,
      [RES, ORG, 'dedoc_p', 'dedoc_u', 'dedoc_g']);

    const folio = await createFolio({
      reservationId: RES, payerKind: 'guest',
      payerName: 'M. Schneider', payerAddress: 'Musterweg 7, 10115 Berlin',
    });
    await addCharges([
      { folioId: folio, reservationId: RES, serviceDate: '2026-08-04', kind: 'lodging',
        description: 'Übernachtung', guestName: 'M. Schneider', unitCode: '213',
        quantity: 1, unitPriceGross: 173.05, totalGross: 173.05, vatRate: 7, source: 'manual' },
      { folioId: folio, reservationId: RES, serviceDate: '2026-08-05', kind: 'service',
        description: 'Frühstück Getränke', guestName: 'M. Schneider', unitCode: '213',
        quantity: 1, unitPriceGross: 3, totalGross: 3, vatRate: 19, source: 'manual' },
    ]);
    const issued = await issueInvoice({ folioId: folio });

    // ── the assembled document ──────────────────────────────────────────────
    const doc = await loadInvoiceDocument(issued.invoiceId);
    assert.ok(doc, 'зібраний документ — null для щойно виставленого рахунку');
    assert.strictEqual(doc.locale, 'de-DE', `юрисдикція: ${doc.locale}`);
    assert.strictEqual(doc.number, issued.invoiceNumber);
    assert.strictEqual(doc.seller.name, 'Burghotel GmbH', 'продавець — не юридична назва');
    assert.strictEqual(doc.seller.vatId, 'DE811111111');
    assert.strictEqual(doc.buyer?.name, 'M. Schneider', 'платник — не той, кого назвало фоліо');
    assert.strictEqual(doc.lines.length, 2);
    assert.strictEqual(doc.serviceFrom, '2026-08-04', 'Leistungszeitraum загубився');
    // 173,05 + 3 = 176,05 — і обидві ставки видно в підсумках.
    assert.strictEqual(doc.gross, 176.05, `валова сума: ${doc.gross}`);
    assert.deepStrictEqual(doc.taxTotals.map((t) => t.vat_rate).sort(), [19, 7].sort());
    assert.strictEqual(doc.isSmallAmount, true, '176,05 ≤ 250 — §33 UStDV дозволяє спрощену');
    console.log(`  ok  документ зібрано: ${doc.number}, de-DE, 176,05 €, ставки 7 і 19`);

    // Renders through the real German layout, end to end.
    const pdf = await generateGermanInvoicePdf(doc);
    assert.ok(pdf.length > 1000, 'PDF порожній');
    console.log(`  ok  німецький PDF рендериться (${(pdf.length / 1024).toFixed(0)} KiB)`);

    // ── §6 KassenSichV on the beleg ─────────────────────────────────────────
    // A cash payment signed by the (stubbed) TSE must surface on the
    // DOCUMENT: every §6 field plus the QR payload, and the recording-system
    // serial from the property's fiscal settings. TSE spec §6.4, block C.
    await setFeature(ORG, 'fiscal_de', true);
    await sql.run(
      `INSERT INTO fin_fiscal_settings (id, organization_id, property_id, tss_id, tse_client_id, recording_system_serial)
       VALUES ('dedoc_fs', ?, 'dedoc_p', 'tss-1', 'client-1', 'ALISIO-KASSE-01')`,
      [ORG]);
    await recordPayment(
      { folioId: folio, amount: 176.05, method: 'cash', invoiceId: issued.invoiceId },
      { device: { async signReceipt() {
        return {
          tseSerial: 'TSE-9000', txNumber: '77', signatureCounter: '3001',
          signature: 'PRUEFWERT==', startTime: '2026-08-05T09:00:00Z', endTime: '2026-08-05T09:00:01Z',
          qrPayload: 'V0;ALISIO-KASSE-01;Kassenbeleg-V1;77;3001;...',
          clientId: 'client-1', processType: 'Kassenbeleg-V1', processData: 'Beleg^...',
        };
      } } });
    const fiscalDoc = await loadInvoiceDocument(issued.invoiceId);
    assert.ok(fiscalDoc?.fiscal?.length, 'підписана готівка мусить зʼявитися на документі');
    const beleg = fiscalDoc!.fiscal![0];
    assert.strictEqual(beleg.failed, false);
    assert.strictEqual(beleg.tseSerial, 'TSE-9000');
    assert.strictEqual(beleg.txNumber, '77');
    assert.strictEqual(beleg.signatureCounter, '3001');
    assert.strictEqual(beleg.signature, 'PRUEFWERT==');
    assert.strictEqual(beleg.recordingSystemSerial, 'ALISIO-KASSE-01',
      'серійник системи запису мусить прийти з налаштувань обʼєкта');
    assert.ok(beleg.qrPayload, 'QR — на додачу до тексту, не замість');
    const fiscalPdf = await generateGermanInvoicePdf(fiscalDoc!);
    assert.ok(fiscalPdf.length > pdf.length,
      'PDF із TSE-блоком і QR мусить бути більшим за PDF без нього');
    console.log('  ok  §6-реквізити і QR доходять до документа й до PDF');

    // A failed signature reaches the paper too — as the outage wording, not
    // as invented fields and not as silence.
    await recordPayment(
      { folioId: folio, amount: 10, method: 'cash', invoiceId: issued.invoiceId },
      { device: { async signReceipt(): Promise<never> { throw new Error('down'); } } });
    const failedDoc = await loadInvoiceDocument(issued.invoiceId);
    assert.strictEqual(failedDoc!.fiscal!.length, 2);
    assert.strictEqual(failedDoc!.fiscal![1].failed, true);
    assert.ok((await generateGermanInvoicePdf(failedDoc!)).length > 1000,
      'PDF із поміткою про збій TSE мусить рендеритися');
    console.log('  ok  збій TSE друкується словами закону, не тишею');

    // ── the storno inherits the trail ───────────────────────────────────────
    const reversal = await stornoInvoice({ invoiceId: issued.invoiceId });
    const stornoDoc = await loadInvoiceDocument(reversal.invoiceId);
    assert.ok(stornoDoc);
    assert.strictEqual(stornoDoc.status, 'storno');
    assert.strictEqual(stornoDoc.correctsNumber, issued.invoiceNumber,
      'сторно не називає номер документа, який скасовує');
    assert.strictEqual(stornoDoc.gross, -176.05, `сторно має бути дзеркалом: ${stornoDoc.gross}`);
    console.log('  ok  сторно знає номер оригіналу і несе мінус');

    // ── the honest nulls ────────────────────────────────────────────────────
    // A legacy invoice: one amount, no lines, no VAT split. German rendering
    // must refuse it, not dress it up.
    await sql.run(
      `INSERT INTO invoices (id, organization_id, reservation_id, invoice_number, issued_at, amount, currency, status)
       VALUES ('dedoc_legacy', ?, ?, 'LEG-1', '2026-08-05', 188.05, 'EUR', 'issued')`,
      [ORG, RES]);
    assert.strictEqual(await loadInvoiceDocument('dedoc_legacy'), null,
      'рахунок без позицій має відмовити, а не вигадати ПДВ');
    console.log('  ok  рахунок без позицій → null → легасі-рендерер');

    assert.strictEqual(await loadInvoiceDocument('dedoc_missing'), null);
    console.log('  ok  неіснуючий рахунок → null, не помилка');
  });
} finally {
  await cleanup();
}

console.log('рядки з бази → документ §14 → німецький PDF, і жодного вигаданого податку');
