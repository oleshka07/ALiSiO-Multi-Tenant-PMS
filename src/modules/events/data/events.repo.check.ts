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
const { issueInvoice, loadInvoiceDocument, generateGermanInvoicePdf } = await import('@invoicing/kernel.ts');

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

    // ── the hall carries its own VAT role, and the request can still override ─
    //
    // Until migration 0025 the rate was the literal 'standard' in two places in
    // code, so a hotel whose Steuerberater reads hall rent as accommodation had
    // no way to say so — the file could not reach a default written in code.
    // The hall above kept 19 % without saying anything, which is the other half
    // of this: switching the mechanism on must not move anybody's tax.
    const reducedHall = await events.saveSpace({
      propertyId: 'evrepo_p', name: 'Festsaal', code: 'FEST', vatCode: 'reduced',
      blockPrices: { h4: 190 },
    });
    const feier = await events.createBooking({
      spaceId: reducedHall, eventDate: '2026-06-01', timeFrom: '18:00', timeTo: '22:00',
      customerName: 'Familie Muster',
    });
    await events.postEventCharges(feier.id, { hallPriceGross: 190 });
    const feierRows = await sql.rows<any>(
      `SELECT i.vat_rate FROM fin_folio_items i
         JOIN event_bookings b ON b.folio_id = i.folio_id
        WHERE b.id = ? AND b.organization_id = ?`, [feier.id, ORG]);
    assert.deepStrictEqual(feierRows.map((r) => Number(r.vat_rate)), [7],
      'зала з vatCode=reduced мала дати 7 %, а не код за замовчуванням');

    const sonder = await events.createBooking({
      spaceId: reducedHall, eventDate: '2026-06-02', timeFrom: '10:00', timeTo: '14:00',
      customerName: 'Firmenfeier',
    });
    await events.postEventCharges(sonder.id, { hallPriceGross: 190, hallVatCode: 'standard' });
    const sonderRows = await sql.rows<any>(
      `SELECT i.vat_rate FROM fin_folio_items i
         JOIN event_bookings b ON b.folio_id = i.folio_id
        WHERE b.id = ? AND b.organization_id = ?`, [sonder.id, ORG]);
    assert.deepStrictEqual(sonderRows.map((r) => Number(r.vat_rate)), [19],
      'явний код у запиті мав перекрити ставку зали');
    console.log('  ok  ставка зали — з самої зали (7 %), запит її перекриває (19 %)');

    // ── зала виставляється один раз ──────────────────────────────────────
    //
    // Кнопка «Рахунок» кладе позиції й одразу випускає рахунок. openFolio
    // ідемпотентний, issueInvoice відмовляється брати вже зафактуровану
    // позицію — а postEventCharges при кожному виклику ДОДАВАВ рядки. Тож
    // друге натискання давало другий рахунок із тим самим заходом і новим
    // номером у книзі. У Німеччині номер видано; прибрати його можна лише
    // сторно. setBilling(true) на екрані блокує тільки подвійний клік у межах
    // одного запиту — портьє, який відкрив діалог удруге, отримував дублікат.
    await assert.rejects(
      () => events.postEventCharges(sonder.id, { hallPriceGross: 190 }),
      /already on the folio/,
      'друге виставлення тієї самої зали мусить бути відхилене');
    const afterSecond = await sql.rows<any>(
      `SELECT i.id FROM fin_folio_items i
         JOIN event_bookings b ON b.folio_id = i.folio_id
        WHERE b.id = ? AND b.organization_id = ?`, [sonder.id, ORG]);
    assert.strictEqual(afterSecond.length, 1,
      'після відхиленої спроби на фоліо мусить лишитись рівно один рядок');
    console.log('  ok  друге натискання «Рахунок» не створює другого рядка зали');

    // Доплати після виставленої зали — законна операція, а не дублікат:
    // додаткова кава на тому ж заході. Гейт саме тут, бо найпростіший спосіб
    // прибрати дублікат — заборонити ВСЕ повторне, і це зламало б роботу.
    const kaffee = await events.saveAddon({
      propertyId: 'evrepo_p', name: 'Kaffee', kind: 'per_person',
      priceGross: 3, vatCode: 'standard',
    });
    const added = await events.postEventCharges(sonder.id, {
      hallPriceGross: 0, addons: [{ addonId: kaffee, quantity: 5 }],
    });
    assert.strictEqual(added.posted, 1, 'доплату після зали мусить бути можна додати');
    console.log('  ok  доплата після виставленої зали проходить');

    // Сторнований рядок означає, що залу треба виставити наново — тому
    // запам'ятовується сам РЯДОК, а не прапорець «уже виставлено». Прапорець
    // тут збрехав би і залишив готель без способу виставити захід.
    const booking = await sql.row<any>(
      'SELECT hall_charge_item_id FROM event_bookings WHERE id = ? AND organization_id = ?',
      [sonder.id, ORG]);
    assert.ok(booking.hall_charge_item_id, 'бронь мусить пам’ятати свій рядок зали');
    await sql.run(
      'UPDATE fin_folio_items SET voided_by_item_id = ? WHERE id = ? AND organization_id = ?',
      ['storno_probe', booking.hall_charge_item_id, ORG]);
    const reposted = await events.postEventCharges(sonder.id, { hallPriceGross: 190 });
    assert.strictEqual(reposted.posted, 1,
      'після сторно зали її мусить бути можна виставити наново');
    console.log('  ok  сторнована зала виставляється наново, прапорець це заборонив би');
  });
} finally {
  await cleanup();
}

console.log('зала бронюється без колізій, а її гроші йдуть тим самим коридором, що й ночівлі');
