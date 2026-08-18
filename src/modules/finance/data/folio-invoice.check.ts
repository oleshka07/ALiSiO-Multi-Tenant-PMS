/**
 * Two guests, one room, two invoices — and correcting one must not void the other.
 *
 *   node src/modules/finance/data/folio-invoice.check.ts
 *
 * The pilot's owner asked for this in one sentence: «es müssen bitte mind. 2
 * Rechnungen mit fortlaufender RG-Nr. aus einem Zimmer möglich sein», adding
 * that the program they use today handles three guests in one room. Two people
 * share a double, each pays their half, each takes home a document with their
 * own name and its own number.
 *
 * Most of the machinery was already here — a folio per payer, `issueInvoice`
 * numbering one document per folio, `fin_folio_items.invoice_id` stopping a
 * charge from being billed twice. What was missing ran the other way: an
 * invoice could not say which folio it came from. It knew its reservation, and
 * a reservation is the room, not the payer.
 *
 * That gap had teeth. Reissue cancelled by reservation:
 *
 *     UPDATE invoices SET status='cancelled' WHERE reservation_id = ?
 *
 * With one invoice per stay that is a correction. With two payers it is
 * destruction — reissuing the first guest's document voids the second guest's,
 * which they have already paid and taken with them. The number stays spent,
 * the paper in their hand becomes invalid, and nothing says so.
 *
 * So the assertions below are about that, not about arithmetic: two documents
 * exist, they carry consecutive numbers, each names its own payer, and neither
 * the reissue route nor a storno of one touches the other.
 */
import assert from 'node:assert';
// Aliases first, then the modules that need them — see the file's own note on
// why a static import of an aliased module would be hoisted above this and
// still fail.
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { createFolio, addCharges, issueInvoice, stornoInvoice } = await import('./folio.repo.ts');
const { reissueInvoiceForReservation } = await import('./reservation-invoice.repo.ts');

const sql = getSql();
const ORG = 'org_split';
const RES = 'split_res';

async function cleanup() {
  await sql.run('DELETE FROM fin_invoice_tax_totals WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_invoice_lines WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM invoices WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_folio_items WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_folios WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_invoice_counters WHERE organization_id = ?', [ORG]).catch(() => {});
  await sql.run("DELETE FROM reservations WHERE id LIKE 'split_%'", []);
  await sql.run("DELETE FROM units WHERE id LIKE 'split_%'", []);
  await sql.run("DELETE FROM unit_types WHERE id LIKE 'split_%'", []);
  await sql.run("DELETE FROM categories WHERE id LIKE 'split_%'", []);
  await sql.run("DELETE FROM guests WHERE id LIKE 'split_%'", []);
  await sql.run("DELETE FROM properties WHERE id LIKE 'split_%'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run('INSERT INTO organizations(id, name, slug, language) VALUES (?,?,?,?)',
  [ORG, 'Teilung', 'teilung', 'de']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['split_p', ORG, 'Haus', 'haus', 'DE']);
    await sql.run('INSERT INTO categories(id, property_id, name, type) VALUES (?,?,?,?)',
      ['split_c', 'split_p', 'Zimmer', 'hotel']);
    await sql.run('INSERT INTO unit_types(id, property_id, category_id, name, code) VALUES (?,?,?,?,?)',
      ['split_t', 'split_p', 'split_c', 'DZ', 'DZ']);
    await sql.run('INSERT INTO units(id, unit_type_id, property_id, category_id, name, code) VALUES (?,?,?,?,?,?)',
      ['split_u', 'split_t', 'split_p', 'split_c', '204', '204']);
    await sql.run('INSERT INTO guests(id, organization_id, first_name, last_name) VALUES (?,?,?,?)',
      ['split_g', ORG, 'Anna', 'Weber']);
    await sql.run(
      `INSERT INTO reservations(id, organization_id, property_id, unit_id, guest_id,
                                check_in, check_out, nights, adults, children, infants,
                                status, payment_status, source, total_price, currency, commission_amount)
       VALUES (?,?,?,?,?, '2026-10-05','2026-10-07',2,2,0,0,'confirmed','unpaid','direct',178,'EUR',0)`,
      [RES, ORG, 'split_p', 'split_u', 'split_g']);

    // ── one room, two payers ────────────────────────────────────────────────
    const folioA = await createFolio({ reservationId: RES, payerKind: 'guest', payerName: 'Anna Weber', label: 'A' });
    const folioB = await createFolio({ reservationId: RES, payerKind: 'guest', payerName: 'Bernd Kraus', label: 'B' });
    assert.notStrictEqual(folioA, folioB);

    // Half the room each. The split itself is reception's decision; what is
    // under test is that it survives to two documents.
    for (const [folioId, guest] of [[folioA, 'Anna Weber'], [folioB, 'Bernd Kraus']] as const) {
      await addCharges([{
        folioId, reservationId: RES, serviceDate: '2026-10-05', kind: 'lodging',
        description: 'Übernachtung', guestName: guest, unitCode: '204',
        quantity: 2, unitPriceGross: 44.5, totalGross: 89, vatRate: 7, source: 'manual',
      }]);
    }

    const a = await issueInvoice({ folioId: folioA });
    const b = await issueInvoice({ folioId: folioB });

    assert.strictEqual(a.gross, 89, `A має 89, а вийшло ${a.gross}`);
    assert.strictEqual(b.gross, 89, `B має 89, а вийшло ${b.gross}`);
    assert.notStrictEqual(a.invoiceNumber, b.invoiceNumber, 'два платники — один номер рахунку');
    console.log(`  ok  один номер, два рахунки: ${a.invoiceNumber} і ${b.invoiceNumber}`);

    // Consecutive, from the same series — «fortlaufende RG-Nr.» is the words
    // the owner used, and a gap in a German invoice sequence is a finding at
    // an audit, not a cosmetic detail.
    const tail = (n: string) => Number(n.replace(/\D/g, '').slice(-4));
    assert.strictEqual(tail(b.invoiceNumber) - tail(a.invoiceNumber), 1,
      `номери не поспіль: ${a.invoiceNumber} → ${b.invoiceNumber}`);
    assert.strictEqual(a.series, b.series, 'платники розійшлися по різних серіях');
    console.log('  ok  номери йдуть поспіль в одній серії');

    // ── each document names its own payer ───────────────────────────────────
    const owner = async (invoiceId: string) => (await sql.row<any>(
      'SELECT folio_id, reservation_id FROM invoices WHERE id = ?', [invoiceId]))!;
    assert.strictEqual((await owner(a.invoiceId)).folio_id, folioA);
    assert.strictEqual((await owner(b.invoiceId)).folio_id, folioB);
    assert.strictEqual((await owner(a.invoiceId)).reservation_id, RES, 'рахунок загубив бронь');
    console.log('  ok  кожен рахунок знає свого платника і спільну бронь');

    // ── the reissue route must not reach a payer's document ─────────────────
    //
    // This is the assertion the whole file exists for. Before folio_id, the
    // call below cancelled every invoice of the reservation — both guests'.
    await reissueInvoiceForReservation(RES);
    const live = await sql.rows<any>(
      "SELECT id, status FROM invoices WHERE reservation_id = ? AND folio_id IS NOT NULL", [RES]);
    assert.strictEqual(live.length, 2, `платників має лишитись двоє, а лишилось ${live.length}`);
    for (const inv of live) {
      assert.strictEqual(inv.status, 'issued',
        `перевиставлення скасувало рахунок платника (${inv.id} → ${inv.status})`);
    }
    console.log('  ok  перевиставлення броні не чіпає рахунки платників');

    // ── correcting one guest leaves the other alone ─────────────────────────
    const reversal = await stornoInvoice({ invoiceId: a.invoiceId });
    const afterA = await sql.row<any>('SELECT status FROM invoices WHERE id = ?', [a.invoiceId]);
    const afterB = await sql.row<any>('SELECT status FROM invoices WHERE id = ?', [b.invoiceId]);
    assert.strictEqual(afterA.status, 'corrected', 'оригінал не позначено як виправлений');
    assert.strictEqual(afterB.status, 'issued', 'сторно одного платника зачепило другого');

    // The credit note belongs to the same payer's trail, not to the room's.
    const stornoRow = await sql.row<any>(
      'SELECT folio_id, corrects_invoice_id FROM invoices WHERE id = ?', [reversal.invoiceId]);
    assert.strictEqual(stornoRow.folio_id, folioA, 'сторно не успадкувало фоліо');
    assert.strictEqual(stornoRow.corrects_invoice_id, a.invoiceId);
    console.log('  ok  сторно одного гостя лишає рахунок другого чинним');
  });
} finally {
  await cleanup();
}

console.log('один номер → кілька платників → кілька рахунків, і жоден не гасить інший');
