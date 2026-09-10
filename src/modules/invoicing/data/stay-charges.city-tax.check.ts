/**
 * Турзбір доходить до рахунку — окремим рядком і без ПДВ.
 *
 *   node src/modules/invoicing/data/stay-charges.city-tax.check.ts
 *
 * `fin_folio_items.kind` має значення `city_tax` від самого початку, і
 * `folio.repo.ts` його типізує. Писав його НІХТО: збір, який готель зібрав із
 * гостя, не з'являвся в жодному документі, який готель видає.
 *
 * Обидві гілки були неправильні, кожна по-своєму:
 *
 *   `city_tax_included = 0` (дефолт) — збір лежав колонкою броні, у фоліо не
 *   потрапляв. Гість платить, документа немає;
 *
 *   `city_tax_included = 1` — збір сидів усередині `total_price`, а
 *   `splitOtaAmount` ділив цю суму на проживання й сніданок. Тобто збір тихо
 *   оподатковувався ставкою ПРОЖИВАННЯ: 7 % на гроші, які взагалі не є
 *   виручкою готелю. У німецькій декларації це не заокруглення.
 *
 * Тут перевіряється рівно це: обидві гілки, нуль ПДВ на рядку, відсутність
 * шумового рядка при нулі, відмова замість від'ємного проживання, і мова
 * документа (інваріант 19) — бо рядок ЗАМОРОЖУЄТЬСЯ у фоліо.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { postStayCharges } = await import('./stay-charges.repo.ts');
const { createFolio } = await import('./folio.repo.ts');

const sql = getSql();
const ORG = 'org_ctax';

async function cleanup() {
  await sql.run('DELETE FROM fin_folio_items WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_folios WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM fin_tax_rates WHERE organization_id = ?', [ORG]);
  await sql.run("DELETE FROM reservations WHERE id LIKE 'ctax_%'", []);
  await sql.run("DELETE FROM units WHERE id LIKE 'ctax_%'", []);
  await sql.run("DELETE FROM unit_types WHERE id LIKE 'ctax_%'", []);
  await sql.run("DELETE FROM categories WHERE id LIKE 'ctax_%'", []);
  await sql.run("DELETE FROM guests WHERE id LIKE 'ctax_%'", []);
  await sql.run("DELETE FROM properties WHERE id LIKE 'ctax_%'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run('INSERT INTO organizations(id, name, slug, language) VALUES (?,?,?,?)',
  [ORG, 'Kurort', 'kurort', 'de']);

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['ctax_p', ORG, 'Haus', 'haus', 'DE']);
    await sql.run('INSERT INTO categories(id, property_id, name, type) VALUES (?,?,?,?)',
      ['ctax_c', 'ctax_p', 'Zimmer', 'hotel']);
    await sql.run('INSERT INTO unit_types(id, property_id, category_id, name, code) VALUES (?,?,?,?,?)',
      ['ctax_t', 'ctax_p', 'ctax_c', 'DZ', 'DZ']);
    await sql.run('INSERT INTO units(id, unit_type_id, property_id, category_id, name, code) VALUES (?,?,?,?,?,?)',
      ['ctax_u', 'ctax_t', 'ctax_p', 'ctax_c', '101', '101']);
    await sql.run('INSERT INTO guests(id, organization_id, first_name, last_name) VALUES (?,?,?,?)',
      ['ctax_g', ORG, 'Klaus', 'Weber']);
    // Без правила каналу: сніданок не вирізається, тож уся сума — проживання.
    // Так видно рівно один рух — турзбір, і нічого крім нього.
    await sql.run('INSERT INTO fin_tax_rates(id, organization_id, code, rate, valid_from) VALUES (?,?,?,?,?)',
      ['ctax_r', ORG, 'reduced', 7, '2020-01-01']);

    /** `included` пишеться 1/0: колонка BIGINT, а не BOOLEAN (інваріант 12). */
    const post = async (id: string, total: number, tax: number, included: number, propertyId = 'ctax_p') => {
      await sql.run(
        `INSERT INTO reservations(id, organization_id, property_id, unit_id, guest_id,
                                  check_in, check_out, nights, adults, children, infants,
                                  status, payment_status, source, total_price, currency,
                                  commission_amount, city_tax_amount, city_tax_included)
         VALUES (?,?,?,?,?, '2026-09-10','2026-09-12',2,2,0,0,'confirmed','unpaid','direct',?, 'EUR',0,?,?)`,
        [id, ORG, propertyId, 'ctax_u', 'ctax_g', total, tax, included]);
      const folio = await createFolio({ reservationId: id, payerKind: 'guest' });
      return await postStayCharges({ reservationId: id, folioId: folio }) as any;
    };

    /** Те, що справді лягло у фоліо — саме воно стає документом. */
    const rows = async (id: string) => await sql.rows<any>(
      `SELECT kind, description, total_gross, vat_rate FROM fin_folio_items
        WHERE reservation_id = ? ORDER BY kind`, [id]) as any[];

    // ── Збір поверх суми (дефолт кожної броні) ────────────────────────────
    const beside = await post('ctax_beside', 300, 60, 0);
    assert.ok(!('reason' in beside), `нарахування відмовило: ${JSON.stringify(beside)}`);
    const besideRows = await rows('ctax_beside');
    assert.strictEqual(besideRows.length, 2, 'мали бути проживання і збір');
    const besideLodging = besideRows.find((r) => r.kind === 'lodging');
    const besideTax = besideRows.find((r) => r.kind === 'city_tax');
    assert.strictEqual(Number(besideLodging.total_gross), 300,
      'збір поверх суми не міняє проживання');
    assert.ok(besideTax, 'збір мусить бути на рахунку — до цієї зміни його там не було ЖОДНОГО разу');
    assert.strictEqual(Number(besideTax.total_gross), 60);
    assert.strictEqual(Number(besideTax.vat_rate), 0,
      'збір не є виручкою готелю: вихідного ПДВ на ньому немає');
    assert.strictEqual(Number(beside.gross), 360, 'посталений підсумок — сума разом зі збором');
    assert.deepStrictEqual(beside.cityTax, { amount: 60, carvedOut: false });
    console.log('  ok  збір поверх суми: 300 проживання + 60 збору, 0 % на збір');

    // ── Збір усередині суми ───────────────────────────────────────────────
    //
    // Найдорожча з двох гілок: 60 € їхали в рядок проживання під 7 %.
    const inside = await post('ctax_inside', 300, 60, 1);
    assert.ok(!('reason' in inside), `нарахування відмовило: ${JSON.stringify(inside)}`);
    const insideRows = await rows('ctax_inside');
    const insideLodging = insideRows.find((r) => r.kind === 'lodging');
    const insideTax = insideRows.find((r) => r.kind === 'city_tax');
    assert.strictEqual(Number(insideLodging.total_gross), 240,
      '300 включали збір: проживання це 240, а не 300');
    assert.strictEqual(Number(insideTax.total_gross), 60);
    assert.strictEqual(Number(insideTax.vat_rate), 0,
      '60 € під 7 % — саме та помилка, заради якої цей файл написаний');
    assert.strictEqual(Number(inside.gross), 300,
      'сума броні не зросла: збір вирізали, а не додали');
    assert.deepStrictEqual(inside.cityTax, { amount: 60, carvedOut: true });
    console.log('  ok  збір усередині суми: 240 + 60, і жодного євро збору під ставкою проживання');

    // ── Нуля не буває на рахунку ──────────────────────────────────────────
    const none = await post('ctax_none', 300, 0, 0);
    assert.ok(!('reason' in none));
    assert.strictEqual((await rows('ctax_none')).length, 1,
      'готель без збору не отримує порожнього рядка «Kurtaxe 0»');
    assert.strictEqual(none.cityTax, undefined);
    console.log('  ok  нульовий збір не створює рядка');

    // ── Збір більший за суму — відмова, а не від'ємне проживання ──────────
    const broken = await post('ctax_over', 50, 60, 1);
    assert.ok('reason' in broken, 'мала бути відмова');
    assert.strictEqual(broken.reason, 'city_tax_exceeds_total');
    assert.strictEqual((await rows('ctax_over')).length, 0,
      'відмова не лишає по собі половини рахунку');
    console.log('  ok  збір більший за суму: відмова з назвою, нічого не посталено');

    // ── Мова документа, не оператора (інваріант 19) ───────────────────────
    //
    // Рядок ЗАМОРОЖУЄТЬСЯ у фоліо, тож слово обирається один раз і назавжди.
    assert.strictEqual(besideTax.description, 'Kurtaxe',
      'німецький обʼєкт — німецьке слово на документі');

    await sql.run('INSERT INTO properties(id, organization_id, name, slug, country) VALUES (?,?,?,?,?)',
      ['ctax_p2', ORG, 'Dům', 'dum', 'CZ']);
    // І СВОЇ ставки чеському будинку (INC-038, Д54). Спільний набір цього
    // рахунку — німецький, а німецька ставка на чеському документі це та сама
    // вада, від якої вісь заводили: до правки цей рядок був не потрібен, бо
    // 7 % їхали в чеську фактуру мовчки. Тепер без нього нарахування ВІДМОВИТЬ
    // поіменно — і саме так воно й має поводитись.
    await sql.run('INSERT INTO fin_tax_rates(id, organization_id, property_id, code, rate, valid_from) VALUES (?,?,?,?,?,?)',
      ['ctax_r_cz', ORG, 'ctax_p2', 'reduced', 12, '2020-01-01']);
    const cz = await post('ctax_cz', 300, 60, 0, 'ctax_p2');
    assert.ok(!('reason' in cz), `нарахування відмовило: ${JSON.stringify(cz)}`);
    const czTax = (await rows('ctax_cz')).find((r) => r.kind === 'city_tax');
    assert.strictEqual(czTax.description, 'Poplatek z pobytu',
      'чеський обʼєкт — чеське слово, хоч мова організації німецька');
    console.log('  ok  назва збору — мовою юрисдикції обʼєкта, не оператора');
  });
} finally {
  await cleanup();
}

console.log('турзбір: окремий рядок рахунку, нуль ПДВ, мовою документа');
