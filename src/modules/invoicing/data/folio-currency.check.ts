/**
 * An invoice counts the money the booking was taken in.
 *
 *   node src/modules/invoicing/data/folio-currency.check.ts
 *
 * `issueInvoice` wrote `folio.currency ?? 'EUR'`, and `fin_folios` had no
 * currency column at all — so the left side was always undefined and EVERY
 * invoice issued through a folio came out in euro. A Czech hotel handed its
 * guest «1 850,00 €» over a sum counted in crowns, because the formatter was
 * told EUR and believed it. `folio` is typed `any`, so nothing complained.
 *
 * It was not a rare path: folios are how split bills and halls are billed, and
 * the legacy route next door (`reservation-invoice.repo.ts`) reads
 * `res.currency || 'CZK'` correctly — so two invoices from the same hotel could
 * disagree about what its money is.
 *
 * The assertions below are about where the answer comes from, in order:
 *
 *   1. the reservation — a booking taken in crowns is billed in crowns, even
 *      after the hotel changes its default, because the answer is frozen into
 *      the folio at creation;
 *   2. the organization — for a folio with no reservation (a hall, a walk-in);
 *   3. nowhere else. A row created before migration 0031 has NULL and is
 *      resolved the same way at read time, never from a literal.
 *
 * The fourth is the one that matters most: no path produces EUR for a hotel
 * that does not use euro.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { createFolio, addCharges, issueInvoice } = await import('./folio.repo.ts');

const sql = getSql();
const ORG = 'org_cur';

async function cleanup() {
  await sql.run('DELETE FROM fin_invoice_tax_totals WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_invoice_lines WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM invoices WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_folio_items WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_folios WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_invoice_counters WHERE organization_id = ?', [ORG]).catch(() => {});
  await sql.run("DELETE FROM reservations WHERE id LIKE 'cur_%'", []);
  await sql.run("DELETE FROM units WHERE id LIKE 'cur_%'", []);
  await sql.run("DELETE FROM unit_types WHERE id LIKE 'cur_%'", []);
  await sql.run("DELETE FROM categories WHERE id LIKE 'cur_%'", []);
  await sql.run("DELETE FROM guests WHERE id LIKE 'cur_%'", []);
  await sql.run("DELETE FROM properties WHERE id LIKE 'cur_%'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
// A Czech hotel. Nothing about it is euro.
await sql.run('INSERT INTO organizations(id, name, slug, language, default_currency) VALUES (?,?,?,?,?)',
  [ORG, 'Hotel Koruna', 'koruna', 'cs', 'CZK']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['cur_p', ORG, 'Dům', 'dum', 'CZ']);
    await sql.run('INSERT INTO categories(id, property_id, name, type) VALUES (?,?,?,?)',
      ['cur_c', 'cur_p', 'Pokoje', 'hotel']);
    await sql.run('INSERT INTO unit_types(id, property_id, category_id, name, code) VALUES (?,?,?,?,?)',
      ['cur_t', 'cur_p', 'cur_c', 'DZ', 'DZ']);
    await sql.run('INSERT INTO units(id, unit_type_id, property_id, category_id, name, code) VALUES (?,?,?,?,?,?)',
      ['cur_u', 'cur_t', 'cur_p', 'cur_c', '101', '101']);
    await sql.run('INSERT INTO guests(id, organization_id, first_name, last_name) VALUES (?,?,?,?)',
      ['cur_g', ORG, 'Jan', 'Novák']);
    await sql.run(`INSERT INTO reservations
        (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, status, currency)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ['cur_res', ORG, 'cur_p', 'cur_u', 'cur_g', '2026-09-01', '2026-09-03', 2, 2, 'confirmed', 'CZK']);

    // ── 1. A folio on a crown booking bills in crowns ────────────────────
    const folioId = await createFolio({ reservationId: 'cur_res', payerName: 'Jan Novák' });
    const stored: any = await sql.row<any>('SELECT currency FROM fin_folios WHERE id = ?', [folioId]);
    assert.strictEqual(stored.currency, 'CZK',
      `the folio froze ${stored.currency} for a CZK booking`);

    await addCharges([{
      folioId, reservationId: 'cur_res', serviceDate: '2026-09-01', kind: 'lodging',
      description: 'Ubytování', quantity: 2, unitPriceGross: 1500, totalGross: 3000, vatRate: 12,
    }]);
    const inv = await issueInvoice({ folioId });
    const row: any = await sql.row<any>('SELECT currency, amount FROM invoices WHERE id = ?', [inv.invoiceId]);
    assert.strictEqual(row.currency, 'CZK',
      `the invoice went out in ${row.currency} — this is the bug: a Czech hotel handing out euro`);
    console.log('  ok  бронь у кронах — фактура в кронах');

    // ── 2. No reservation (a hall): the organization answers ─────────────
    const hallFolio = await createFolio({ propertyId: 'cur_p', payerName: 'Firma s.r.o.' });
    const hallStored: any = await sql.row<any>('SELECT currency FROM fin_folios WHERE id = ?', [hallFolio]);
    assert.strictEqual(hallStored.currency, 'CZK',
      `a folio with no reservation took ${hallStored.currency} instead of the organization's currency`);
    console.log('  ok  фоліо без броні бере валюту організації');

    // ── 3. A row born before migration 0031 still does not invent EUR ────
    await sql.run('UPDATE fin_folios SET currency = NULL WHERE id = ?', [hallFolio]);
    await addCharges([{
      folioId: hallFolio, serviceDate: '2026-09-05', kind: 'manual',
      description: 'Sál', quantity: 1, unitPriceGross: 5000, totalGross: 5000, vatRate: 12,
    }]);
    const legacyInv = await issueInvoice({ folioId: hallFolio });
    const legacyRow: any = await sql.row<any>('SELECT currency FROM invoices WHERE id = ?', [legacyInv.invoiceId]);
    assert.strictEqual(legacyRow.currency, 'CZK',
      `a folio with NULL currency fell back to ${legacyRow.currency} instead of resolving it`);
    console.log('  ok  старе фоліо без валюти резолвиться, а не вигадує EUR');

    // ── 4. The literal is gone from every path ───────────────────────────
    const anyEuro = await sql.rows<any>(
      "SELECT id FROM invoices WHERE organization_id = ? AND currency = 'EUR'", [ORG]);
    assert.strictEqual(anyEuro.length, 0,
      `${anyEuro.length} invoice(s) came out in EUR for a hotel that counts crowns`);
    console.log('  ok  жодна фактура цього готелю не вийшла в EUR');
  });

  console.log('фактура рахує ті гроші, у яких узято бронь');
} finally {
  await cleanup();
}
