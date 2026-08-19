/**
 * A hall booking, its collisions, and its money reaching a German invoice.
 *
 *   node src/modules/events/data/events.repo.check.ts
 *
 * The part worth guarding hardest is the LAST leg: an event has no
 * reservation, and until fin_folios.property_id the German renderer refused
 * every reservation-less folio — jurisdiction had nowhere to come from. This
 * check drives a hall booking through openFolio → postEventCharges →
 * issueInvoice → loadInvoiceDocument and demands the result be a de-DE
 * document with the hall's VAT split, rendered to paper. If someone
 * "simplifies" createFolio or the COALESCE in invoice-document.repo, this is
 * the check that goes red.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const events = await import('./events.repo.ts');
const { issueInvoice } = await import('../../finance/data/folio.repo.ts');
const { loadInvoiceDocument } = await import('../../finance/data/invoice-document.repo.ts');
const { generateGermanInvoicePdf } = await import('../../finance/domain/invoice-pdf-de.ts');

const sql = getSql();
const ORG = 'org_evrepo';

async function cleanup() {
  for (const t of ['fin_invoice_tax_totals', 'fin_invoice_lines', 'invoices',
    'fin_folio_items', 'fin_folios', 'event_bookings', 'event_addons', 'event_spaces',
    'fin_tax_rates']) {
    await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]).catch(() => {});
  }
  await sql.run("DELETE FROM properties WHERE id = 'evrepo_p'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run(
  `INSERT INTO organizations(id, name, slug, language, legal_name, legal_address, vat_no)
   VALUES (?,?,?,?,?,?,?)`,
  [ORG, 'Tagungshotel', 'tagungshotel', 'de', 'Tagungshotel GmbH',
   'Beispielweg 1, 07973 Beispielstadt', 'DE812222222']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['evrepo_p', ORG, 'Tagungshaus', 'tagungshaus', 'DE']);
    for (const [code, rate] of [['standard', 19], ['reduced', 7]]) {
      await sql.run('INSERT INTO fin_tax_rates(id, organization_id, code, rate, valid_from) VALUES (?,?,?,?,?)',
        [crypto.randomUUID(), ORG, code, rate, '2020-01-01']);
    }

    // ── the catalogue ───────────────────────────────────────────────────────
    const spaceId = await events.saveSpace({
      propertyId: 'evrepo_p', name: 'Kleiner Saal', code: 'KSAAL',
      blockPrices: { h2: 49, h4: 79, h8: 119, h8plus: 149 },
    });
    const wasserId = await events.saveAddon({
      propertyId: 'evrepo_p', name: 'Wasser', kind: 'per_person', priceGross: 5, vatCode: 'standard',
    });
    const flipchartId = await events.saveAddon({
      propertyId: 'evrepo_p', name: 'Flipchart', kind: 'flat', priceGross: 15, vatCode: 'standard',
    });
    await assert.rejects(
      events.saveSpace({ propertyId: 'missing_p', name: 'X', code: 'X' }),
      /Property not found/, 'чужий property_id мав бути відкинутий');
    console.log('  ok  зала і доплати заведені, чужий обʼєкт відкинуто');

    // ── booking + the collision rule against real rows ──────────────────────
    const first = await events.createBooking({
      spaceId, eventDate: '2026-09-01', timeFrom: '10:00', timeTo: '13:00',
      persons: 12, customerName: 'Muster AG', company: 'Muster AG',
    });
    assert.strictEqual(first.suggestedPrice, 79, `3 год у KSAAL → підказка 79, не ${first.suggestedPrice}`);

    await assert.rejects(
      events.createBooking({
        spaceId, eventDate: '2026-09-01', timeFrom: '12:00', timeTo: '15:00',
        customerName: 'Zweite GmbH',
      }),
      /occupied 10:00–13:00/, 'перетин 12–15 із 10–13 мав бути відмовлений');

    const backToBack = await events.createBooking({
      spaceId, eventDate: '2026-09-01', timeFrom: '13:00', timeTo: '16:00',
      customerName: 'Dritte e.V.',
    });
    await events.updateBooking(backToBack.id, { status: 'cancelled' });
    const revived = await events.createBooking({
      spaceId, eventDate: '2026-09-01', timeFrom: '13:00', timeTo: '16:00',
      customerName: 'Vierte KG',
    });
    // Moving an event may not collide — but must not collide with ITSELF.
    await events.updateBooking(revived.id, { timeFrom: '13:30', timeTo: '16:30' });
    await assert.rejects(
      events.updateBooking(revived.id, { timeFrom: '11:00', timeTo: '12:00' }),
      /occupied/, 'перенесення на зайняті години мало бути відмовлене');
    console.log('  ok  колізії: перетин відмовлено, впритул можна, скасована звільняє день');

    // ── refusal before money: a missing rate leaves NOTHING behind ──────────
    const early = await events.createBooking({
      spaceId, eventDate: '2019-05-01', timeFrom: '10:00', timeTo: '12:00',
      customerName: 'Frühbucher',
    });
    await assert.rejects(
      events.postEventCharges(early.id, { hallPriceGross: 49 }),
      /No tax rate 'standard' for 2019-05-01/,
      'дата до valid_from ставки мала зупинити проводку');
    const untouched = await sql.row(
      'SELECT folio_id FROM event_bookings WHERE id = ? AND organization_id = ?', [early.id, ORG]);
    assert.strictEqual(untouched.folio_id ?? null, null,
      'відмова через ставку не сміє лишати порожнє фоліо');
    console.log('  ok  без ставки ПДВ — відмова, і жодного фоліо після неї');

    // ── the money leg: hall + add-ons → folio → §14 document → paper ───────
    const posted = await events.postEventCharges(first.id, {
      hallPriceGross: 79,
      addons: [{ addonId: wasserId }, { addonId: flipchartId }],
    });
    // Wasser is per_person and the booking holds 12 — quantity comes from the
    // headcount, not a silent 1.
    assert.strictEqual(posted.posted, 3, `зала + 2 доплати = 3 рядки, не ${posted.posted}`);
    const again = await events.openFolio(first.id);
    assert.strictEqual(again, posted.folioId, 'повторний openFolio мусить віддати те саме фоліо');

    const issued = await issueInvoice({ folioId: posted.folioId });
    const doc = await loadInvoiceDocument(issued.invoiceId);
    assert.ok(doc, 'документ по фоліо без резервації — null: юрисдикція загубилась');
    assert.strictEqual(doc.locale, 'de-DE',
      `юрисдикція мала прийти з fin_folios.property_id: ${doc.locale}`);
    assert.strictEqual(doc.buyer?.name, 'Muster AG');
    // 79 + 12×5 + 15 = 154, все під 19 %.
    assert.strictEqual(doc.gross, 154, `валова сума: ${doc.gross}`);
    assert.deepStrictEqual(doc.taxTotals.map((t) => t.vat_rate), [19]);
    const pdf = await generateGermanInvoicePdf(doc);
    assert.ok(pdf.length > 1000, 'PDF порожній');
    console.log(`  ok  зала → фоліо → ${doc.number} (de-DE, 154 €) → PDF ${(pdf.length / 1024).toFixed(0)} KiB`);
  });
} finally {
  await cleanup();
}

console.log('зала бронюється без колізій, а її гроші йдуть тим самим коридором, що й ночівлі');
