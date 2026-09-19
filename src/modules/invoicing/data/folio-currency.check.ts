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
const { recordPayment } = await import('./folio-payments.repo.ts');
const { setFeature } = await import('@core/features');
const { documentLanguage } = await import('@core/i18n/resolve');
const { localeForLanguage, buildInvoiceDocument } = await import('../domain/invoice-document.ts');

const sql = getSql();
const ORG = 'org_cur';
/**
 * Друга організація, і вона обовʼязкова, а не для повноти: твердження нижче —
 * про ВІСЬ ВАЛЮТИ, і з однією валютою у фікстурі «взяли валюту готелю» та
 * «підставили константу» зелені однаково (інваріант 26). Тут гривня проти
 * крони, і жодне число не збігається.
 */
const UA_ORG = 'org_cur_ua';

async function cleanup() {
  await sql.run('DELETE FROM fin_invoice_tax_totals WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_invoice_lines WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM invoices WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_folio_items WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_folios WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_invoice_counters WHERE organization_id = ?', [ORG]).catch(() => {});
  for (const t of ['fin_folio_payments', 'prro_operations', 'prro_settings', 'organization_features']) {
    await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [UA_ORG]).catch(() => {});
  }
  for (const t of ['fin_invoice_tax_totals', 'fin_invoice_lines', 'invoices',
    'fin_folio_items', 'fin_folios', 'fin_invoice_counters']) {
    await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [UA_ORG]).catch(() => {});
  }
  await sql.run("DELETE FROM properties WHERE id LIKE 'uah_%'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [UA_ORG]).catch(() => {});
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

  // ── 5. Гривня проходить весь шлях: фоліо → рахунок → каса → документ ──
  //
  // Д27 у своєму роді: в ядрі обліку колись стояло `to_currency = 'CZK'`
  // літералом, і готель з іншою базовою валютою не міг провести готівку
  // ВЗАГАЛІ. Тому шлях перевіряється прогоном, а не читанням, і до самого
  // кінця — включно з оплатою, яку той дефект і зупиняв.
  await sql.run('INSERT INTO organizations(id, name, slug, language, default_currency) VALUES (?,?,?,?,?)',
    [UA_ORG, 'Готель на Дніпрі', 'dnipro-cur', 'uk', 'UAH']);
  await runWithOrganization(UA_ORG, async () => {
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['uah_p', UA_ORG, 'Дніпро', 'dnipro-house', 'UA']);

    const folioId = await createFolio({ propertyId: 'uah_p', payerName: 'І. Коваленко' });
    const stored = await sql.row<any>('SELECT currency FROM fin_folios WHERE id = ?', [folioId]);
    assert.strictEqual(stored.currency, 'UAH',
      `фоліо українського готелю заморозило ${stored.currency}`);

    await addCharges([
      { folioId, serviceDate: '2026-09-19', kind: 'lodging', description: 'Проживання',
        quantity: 1, unitPriceGross: 1000, totalGross: 1000, vatRate: 20 },
      { folioId, serviceDate: '2026-09-19', kind: 'city_tax', description: 'Туристичний збір',
        quantity: 1, unitPriceGross: 60, totalGross: 60, vatRate: 0 },
    ]);
    const inv = await issueInvoice({ folioId });
    const invoice = await sql.row<any>('SELECT currency, amount FROM invoices WHERE id = ?', [inv.invoiceId]);
    assert.strictEqual(invoice.currency, 'UAH',
      `фактура вийшла в ${invoice.currency} — готель рахує гривні`);
    assert.strictEqual(Number(invoice.amount), 1060, 'сума фактури — обидва рядки разом');

    // Каса: без ключа модуля готівка НЕ проходить (та сама варта, що в DE),
    // з ключем — проходить, і чек несе валюту ФОЛІО, а не константу.
    await assert.rejects(recordPayment({ folioId, amount: 1060, method: 'cash' }), /ПРРО/,
      'українська готівка без fiscal_ua мусить бути відмовлена і тут');
    await setFeature(UA_ORG, 'fiscal_ua', true);
    const seen: any[] = [];
    const till = {
      async openShift() { return { shiftId: 'S', openedAt: '2026-09-19T08:00:00Z' }; },
      async registerReceipt(receipt: any) {
        seen.push(receipt);
        return { fiscalNumber: 'UA-CUR-1', registeredAt: '2026-09-19T09:00:00Z', shiftId: 'S' };
      },
      async closeShift() { return { fiscalNumber: 'Z', shiftId: 'S', closedAt: '2026-09-19T20:00:00Z', receiptsCount: 1, total: 1060 }; },
    };
    const payId = await recordPayment(
      { folioId, amount: 1060, method: 'cash', invoiceId: inv.invoiceId }, { prro: till });
    assert.ok(payId, 'з ключем гривнева готівка мусить пройти');
    assert.strictEqual(seen.length, 1, 'каса мусить отримати чек');
    assert.strictEqual(seen[0].currency, 'UAH',
      `чек поїхав у ${seen[0].currency} — валюта береться з фоліо, не з константи`);
    assert.strictEqual(seen[0].total, 1060);
    assert.strictEqual(seen[0].outsideVatBase, 60, 'збір і тут поза базою ПДВ');

    // Документ: мова — від КРАЇНИ обʼєкта, і формат числа несе саме UAH.
    const language = await documentLanguage('uah_p');
    assert.strictEqual(language, 'uk', 'мова документа українського обʼєкта');
    const locale = localeForLanguage(language);
    assert.strictEqual(locale, 'uk-UA', 'локаль документа — українська, не англійська (У4)');
    const doc = buildInvoiceDocument({
      number: 'UA-1', issueDate: '2026-09-19', status: 'issued', currency: 'UAH', locale,
      seller: { name: 'Готель на Дніпрі' }, buyer: null, lines: [],
      taxTotals: [{ vat_rate: 20, gross_amount: 1000, net_amount: 833.33, tax_amount: 166.67 }],
    });
    assert.ok(doc.formatMoney(1060).includes('UAH'),
      `документ надрукував «${doc.formatMoney(1060)}» — гривня мусить бути названа`);
    assert.strictEqual(doc.labels.invoice, 'Рахунок-фактура');
    assert.strictEqual(doc.formatDate('2026-09-19'), '19.09.2026');

    // І жодного сліду чужої валюти на всьому шляху цього готелю.
    const foreign = await sql.rows<any>(
      "SELECT id, currency FROM invoices WHERE organization_id = ? AND currency <> 'UAH'", [UA_ORG]);
    assert.strictEqual(foreign.length, 0,
      `${foreign.length} документ(ів) українського готелю вийшли не в гривні`);
    console.log('  ok  UAH проходить увесь шлях: фоліо → фактура → каса → документ');
  });

  console.log('фактура рахує ті гроші, у яких узято бронь');
} finally {
  await cleanup();
}
