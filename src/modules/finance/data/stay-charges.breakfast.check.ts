/**
 * Whether breakfast is carved out of a booking's total, the booking decides.
 *
 *   node src/modules/finance/data/stay-charges.breakfast.check.ts
 *
 * The property's channel rule is a guess keyed on the booking's SOURCE, and
 * for the pilot it happens to be right — every current tariff includes
 * breakfast. The two cases where it lies are already on the table:
 *
 *   the Appartements: «zzgl. FRST 15,00 € / Person» — breakfast is bought on
 *   top, never inside the price. The rule would carve 15 € out of a night
 *   that contains none: lodging drops below what the room costs, and 3 €
 *   move from 7 % into 19 % VAT. On a German return that is a wrong filing,
 *   not a rounding slip;
 *
 *   a direct rate sold without breakfast — same arithmetic, same damage.
 *
 * So reservations.breakfast_included overrides the rule, and NULL — the state
 * every existing booking is in — means "follow the rule", which keeps every
 * old folio meaning exactly what it meant.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { postStayCharges } = await import('./stay-charges.repo.ts');
const { createFolio } = await import('./folio.repo.ts');

const sql = getSql();
const ORG = 'org_frst';

async function cleanup() {
  await sql.run('DELETE FROM fin_folio_items WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_folios WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM channel_rate_rules WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_tax_rates WHERE organization_id = ?', [ORG]);
  await sql.run("DELETE FROM reservations WHERE id LIKE 'frst_%'", []);
  await sql.run("DELETE FROM units WHERE id LIKE 'frst_%'", []);
  await sql.run("DELETE FROM unit_types WHERE id LIKE 'frst_%'", []);
  await sql.run("DELETE FROM categories WHERE id LIKE 'frst_%'", []);
  await sql.run("DELETE FROM guests WHERE id LIKE 'frst_%'", []);
  await sql.run("DELETE FROM properties WHERE id LIKE 'frst_%'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run('INSERT INTO organizations(id, name, slug, language) VALUES (?,?,?,?)',
  [ORG, 'Frühstück', 'fruehstueck', 'de']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['frst_p', ORG, 'Haus', 'haus', 'DE']);
    await sql.run('INSERT INTO categories(id, property_id, name, type) VALUES (?,?,?,?)',
      ['frst_c', 'frst_p', 'Zimmer', 'hotel']);
    await sql.run('INSERT INTO unit_types(id, property_id, category_id, name, code) VALUES (?,?,?,?,?)',
      ['frst_t', 'frst_p', 'frst_c', 'DZ', 'DZ']);
    await sql.run('INSERT INTO units(id, unit_type_id, property_id, category_id, name, code) VALUES (?,?,?,?,?,?)',
      ['frst_u', 'frst_t', 'frst_p', 'frst_c', '111', '111']);
    await sql.run('INSERT INTO guests(id, organization_id, first_name, last_name) VALUES (?,?,?,?)',
      ['frst_g', ORG, 'Anna', 'Weber']);
    for (const [code, rate] of [['reduced', 7], ['standard', 19]] as const) {
      await sql.run('INSERT INTO fin_tax_rates(id, organization_id, code, rate, valid_from) VALUES (?,?,?,?,?)',
        [`frst_r_${code}`, ORG, code, rate, '2020-01-01']);
    }
    // The pilot's actual rule: breakfast inside every price, split 12 + 3.
    await sql.run(
      `INSERT INTO channel_rate_rules
         (id, organization_id, property_id, channel, includes_breakfast,
          breakfast_food_price, breakfast_drinks_price,
          lodging_tax_code, food_tax_code, drinks_tax_code, markup_percent)
       VALUES (?,?,?,?, TRUE, ?,?, 'reduced','reduced','standard', 0)`,
      ['frst_rule', ORG, 'frst_p', null, 12, 3]);

    const post = async (id: string, total: number, flag: number | null) => {
      await sql.run(
        `INSERT INTO reservations(id, organization_id, property_id, unit_id, guest_id,
                                  check_in, check_out, nights, adults, children, infants,
                                  status, payment_status, source, total_price, currency,
                                  commission_amount, breakfast_included)
         VALUES (?,?,?,?,?, '2026-09-10','2026-09-11',1,1,0,0,'confirmed','unpaid','direct',?, 'EUR',0,?)`,
        [id, ORG, 'frst_p', 'frst_u', 'frst_g', total, flag]);
      const folio = await createFolio({ reservationId: id, payerKind: 'guest' });
      const result: any = await postStayCharges({ reservationId: id, folioId: folio });
      assert.ok(!('reason' in result), `нарахування відмовило: ${JSON.stringify(result)}`);
      return result.lines as any[];
    };
    const byKind = (lines: any[], kind: string) => lines.find((l) => l.kind === kind);

    // ── NULL: бронь мовчить — діє правило, як і до цієї колонки ─────────────
    const asRule = await post('frst_null', 188.05, null);
    assert.strictEqual(byKind(asRule, 'lodging').totalGross, 173.05, '188,05 − 12 − 3');
    assert.ok(byKind(asRule, 'breakfast_food'), 'правило каже «входить» — їжі нема');
    console.log('  ok  NULL → за правилом: 173,05 + 12 + 3');

    // ── FALSE: апартаменти. Вся сума — проживання, 19 % не існує ────────────
    const apartment = await post('frst_false', 45, 0);
    assert.strictEqual(apartment.length, 1, `мав бути один рядок, а їх ${apartment.length}`);
    assert.strictEqual(byKind(apartment, 'lodging').totalGross, 45,
      'з 45 € вирізали сніданок, якого там немає');
    assert.strictEqual(byKind(apartment, 'lodging').vatRate, 7);
    assert.ok(!apartment.some((l) => l.vatRate === 19),
      '3 € переїхали в 19 % — неправильна декларація, а не косметика');
    console.log('  ok  FALSE → 45,00 повністю проживання, 7 %, жодного рядка на 19 %');

    // ── TRUE поверх правила, що каже «ні» ───────────────────────────────────
    await sql.run("UPDATE channel_rate_rules SET includes_breakfast = FALSE WHERE id = 'frst_rule'", []);
    const soldWith = await post('frst_true', 188.05, 1);
    assert.strictEqual(byKind(soldWith, 'lodging').totalGross, 173.05,
      'бронь продана зі сніданком — правило каналу не має права це стерти');
    assert.strictEqual(byKind(soldWith, 'breakfast_drinks').vatRate, 19);
    console.log('  ok  TRUE → вирізає 12 + 3, навіть коли правило каже «ні»');

    // ── середній голос: тип номера ──────────────────────────────────────────
    // Апартаменти пілота: правило готелю каже «входить» (бо всі готельні
    // тарифи зі сніданком), а прайс ЦЬОГО типу — «zzgl. FRST». Бронь мовчить,
    // тип відповідає.
    await sql.run("UPDATE channel_rate_rules SET includes_breakfast = TRUE WHERE id = 'frst_rule'", []);
    // FALSE, not 0: the column is BOOLEAN on Postgres, and an integer literal
    // in the SQL text is refused there — exactly the class check-boolean-flags
    // documents. FALSE reads as 0 on SQLite, so one spelling serves both.
    await sql.run(
      `INSERT INTO unit_types(id, property_id, category_id, name, code, breakfast_included)
       VALUES ('frst_t2','frst_p','frst_c','Appartement','AP',FALSE)`, []);
    await sql.run(
      `INSERT INTO units(id, unit_type_id, property_id, category_id, name, code)
       VALUES ('frst_u2','frst_t2','frst_p','frst_c','112','112')`, []);

    const postOn = async (id: string, unitId: string, total: number, flag: number | null) => {
      await sql.run(
        `INSERT INTO reservations(id, organization_id, property_id, unit_id, guest_id,
                                  check_in, check_out, nights, adults, children, infants,
                                  status, payment_status, source, total_price, currency,
                                  commission_amount, breakfast_included)
         VALUES (?,?,?,?,?, '2026-09-10','2026-09-11',1,1,0,0,'confirmed','unpaid','direct',?, 'EUR',0,?)`,
        [id, ORG, 'frst_p', unitId, 'frst_g', total, flag]);
      const folio = await createFolio({ reservationId: id, payerKind: 'guest' });
      const result: any = await postStayCharges({ reservationId: id, folioId: folio });
      assert.ok(!('reason' in result), `нарахування відмовило: ${JSON.stringify(result)}`);
      return result.lines as any[];
    };

    const viaType = await postOn('frst_type', 'frst_u2', 45, null);
    assert.strictEqual(viaType.length, 1,
      'тип каже «окремо», бронь мовчить — а сніданок все одно вирізали');
    assert.strictEqual(byKind(viaType, 'lodging').totalGross, 45);
    console.log('  ok  бронь мовчить → відповідає тип: 45,00 без вирізання');

    // Бронь сильніша за тип: у апартаментах продали ЗІ сніданком у ціні.
    const overType = await postOn('frst_over', 'frst_u2', 60, 1);
    assert.strictEqual(byKind(overType, 'lodging').totalGross, 45,
      'бронь каже «входить» — 60 − 12 − 3 = 45, тип не має права це стерти');
    assert.ok(byKind(overType, 'breakfast_food'));
    console.log('  ok  бронь сильніша за тип: 60,00 → 45 + 12 + 3');
  });
} finally {
  await cleanup();
}

console.log('сніданок вирішує бронь; правило каналу — лише коли бронь мовчить');
