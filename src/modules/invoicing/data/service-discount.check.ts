/**
 * Знижка на ПОСЛУГУ успадковує ставку свого рядка (0142, Д62).
 *
 *   node src/modules/invoicing/data/service-discount.check.ts
 *
 * ── Дві половини в ОДНІЙ сцені, і це не для стислості ───────────────────
 *
 * Перша: сума зменшилась рівно на знижку. Друга: ставка рядка знижки
 * дорівнює ставці батьківського.
 *
 * Друге без першого — це не знижка (нічого не зменшилось). Перше без другого
 * — правильна загальна сума і НЕПРАВИЛЬНИЙ податок: у документі держави сума
 * за ставкою перестає дорівнювати сумі рядків цієї ставки. Саме тому вони
 * поруч, а не в двох сценах: перша половина зелена й тоді, коли друга зламана,
 * і навпаки.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * * ДВІ послуги з РІЗНИМИ ставками (10 % і 21 %): з однією «успадкувала»
 *   не відрізнити від «узяла сталу», «узяла ставку сусіда» і «узяла нуль»;
 * * суми теж РІЗНІ (200 і 500) і знижки різні (10 % і фіксована 50), тож
 *   жодне очікуване число не сходиться з альтернативним прочитанням;
 * * ставки самі по собі не кратні одна одній.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-svc-discount-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const folio = await import('./folio.repo.ts');

const sql = getSql();
const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const ORG = '__sd_org';
const PROP = '__sd_prop';
const GUEST = '__sd_guest';
// Ставки РІЗНІ й не кратні: 10 і 21. Суми теж різні.
const VAT_LOW = 10;
const VAT_HIGH = 21;
const SUM_SPA = 200;
const SUM_DINNER = 500;
const PERCENT = 10;
const FIXED = 50;

await runWithOrganization(ORG, async () => {
  for (const t of ['fin_folio_items', 'fin_folios', 'reservations', 'guests', 'properties']) {
    await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]).catch(() => undefined);
  }
});
await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]).catch(() => undefined);
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'Discount', ORG]);

const state = await runWithOrganization(ORG, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug, country) VALUES (?, ?, ?, ?, ?)',
    [PROP, ORG, 'House', 'house', 'CZ']);
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    [GUEST, ORG, 'G', 'One']);
  await sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, guest_id, check_in, check_out,
                               nights, adults, total_price, currency, status, source)
     VALUES (?, ?, ?, ?, '2026-11-01', '2026-11-02', 1, 1, 700, 'CZK', 'confirmed', 'direct')`,
    ['__sd_r1', ORG, PROP, GUEST]);
  const f = await folio.createFolio({ reservationId: '__sd_r1' });
  await folio.addCharges([
    { id: '__sd_spa', folioId: f, reservationId: '__sd_r1', serviceDate: '2026-11-01',
      kind: 'service', description: 'Sauna', quantity: 1,
      unitPriceGross: SUM_SPA, totalGross: SUM_SPA, vatRate: VAT_LOW, source: 'service' },
    { id: '__sd_dinner', folioId: f, reservationId: '__sd_r1', serviceDate: '2026-11-01',
      kind: 'service', description: 'Večeře', quantity: 1,
      unitPriceGross: SUM_DINNER, totalGross: SUM_DINNER, vatRate: VAT_HIGH, source: 'service' },
  ]);
  return { f };
});

const folioTotal = async () => runWithOrganization(ORG, async () => {
  const r = await sql.row<{ total: number }>(
    `SELECT COALESCE(SUM(total_gross), 0) AS total FROM fin_folio_items
      WHERE organization_id = ? AND folio_id = ?`, [ORG, state.f]);
  return Math.round(Number(r?.total ?? 0) * 100) / 100;
});
const lineOf = async (id: string) => runWithOrganization(ORG, () => sql.row<any>(
  `SELECT total_gross, vat_rate, kind, description, discount_of_item_id
     FROM fin_folio_items WHERE id = ? AND organization_id = ?`, [id, ORG]));

const before = await folioTotal();
say(before === SUM_SPA + SUM_DINNER, `до знижки на фоліо ${SUM_SPA + SUM_DINNER}: отримали ${before}`);

// ── 1. Відсоткова знижка на ПЕРШУ послугу (ставка 10 %) ──────────────────
const d1 = await runWithOrganization(ORG, () => folio.discountCharge({ itemId: '__sd_spa', percent: PERCENT }));
const row1 = await lineOf(d1);
const after1 = await folioTotal();

say(after1 === before - (SUM_SPA * PERCENT) / 100,
  `сума зменшилась рівно на знижку (${(SUM_SPA * PERCENT) / 100}): ${before} → ${after1}`);
say(Number(row1?.vat_rate) === VAT_LOW,
  `ставка рядка знижки = ставці ЙОГО рядка (${VAT_LOW} %), отримали ${row1?.vat_rate}`);
say(Number(row1?.vat_rate) !== VAT_HIGH,
  `і це НЕ ставка сусідньої послуги (${VAT_HIGH} %) — вісь не вироджена`);
say(row1?.discount_of_item_id === '__sd_spa',
  `знижка знає, від чого вона: ${row1?.discount_of_item_id}`);
say(String(row1?.description).startsWith('Sauna'),
  `опис від батьківського рядка, мовою документа: «${row1?.description}»`);

// ── 2. Фіксована знижка на ДРУГУ послугу (ставка 21 %) ───────────────────
const d2 = await runWithOrganization(ORG, () => folio.discountCharge({ itemId: '__sd_dinner', amount: FIXED }));
const row2 = await lineOf(d2);
const after2 = await folioTotal();

say(after2 === after1 - FIXED, `фіксована знижка ${FIXED}: ${after1} → ${after2}`);
say(Number(row2?.vat_rate) === VAT_HIGH,
  `і вона взяла ставку СВОГО рядка (${VAT_HIGH} %), отримали ${row2?.vat_rate}`);

// ── 3. Сума ЗА СТАВКОЮ дорівнює сумі рядків цієї ставки ──────────────────
//
// Те, заради чого друга половина й існує: саме це звіряє держава.
const byRate = await runWithOrganization(ORG, () => sql.rows<any>(
  `SELECT vat_rate, SUM(total_gross) AS total FROM fin_folio_items
    WHERE organization_id = ? AND folio_id = ? GROUP BY vat_rate ORDER BY vat_rate`,
  [ORG, state.f]));
const low = byRate.find((r: any) => Number(r.vat_rate) === VAT_LOW);
const high = byRate.find((r: any) => Number(r.vat_rate) === VAT_HIGH);
say(byRate.length === 2, `ставок у фоліо дві, не три: ${byRate.length}`);
say(Math.round(Number(low?.total)) === SUM_SPA - (SUM_SPA * PERCENT) / 100,
  `під ${VAT_LOW} %: ${SUM_SPA} − ${(SUM_SPA * PERCENT) / 100} = ${SUM_SPA - (SUM_SPA * PERCENT) / 100}, отримали ${low?.total}`);
say(Math.round(Number(high?.total)) === SUM_DINNER - FIXED,
  `під ${VAT_HIGH} %: ${SUM_DINNER} − ${FIXED} = ${SUM_DINNER - FIXED}, отримали ${high?.total}`);

// ── 4. Чого знижка не робить ─────────────────────────────────────────────
const tooBig = await runWithOrganization(ORG, async () => {
  try { await folio.discountCharge({ itemId: '__sd_spa', amount: SUM_SPA + 1 }); return 'проїхало!'; }
  catch (e) { return String((e as Error).message); }
});
say(/cannot exceed/i.test(tooBig), `знижка більша за рядок — відмова: «${tooBig}»`);

const onDiscount = await runWithOrganization(ORG, async () => {
  try { await folio.discountCharge({ itemId: d1, percent: 5 }); return 'проїхало!'; }
  catch (e) { return String((e as Error).message); }
});
say(/itself a discount/i.test(onDiscount), `знижка на знижку — відмова: «${onDiscount}»`);

const bothNamed = await runWithOrganization(ORG, async () => {
  try { await folio.discountCharge({ itemId: '__sd_dinner', percent: 5, amount: 10 }); return 'проїхало!'; }
  catch (e) { return String((e as Error).message); }
});
say(/not both and not neither/i.test(bothNamed), `і відсоток, і сума разом — відмова: «${bothNamed}»`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\nservice-discount: ${fails.length} червоних`);
  process.exit(1);
}
console.log('service-discount: сума зменшилась рівно на знижку І ставка успадкована');
assert.ok(true);
