/**
 * Ставка ПДВ береться за БУДИНКОМ, а спільний набір не застосовується мовчки
 * до будинку іншої країни (INC-038, Д54).
 *
 *   node src/modules/invoicing/data/tax-rates.property-axis.check.ts
 *
 * ── Що ламається ────────────────────────────────────────────────────────
 *
 * `fin_tax_rates` не має `property_id` узагалі: набір ставок один на РАХУНОК.
 * `postStayCharges` читає його `WHERE organization_id = ?` і кладе ставку
 * ЧИСЛОМ на нарахування (інваріант 18) — тобто в документ, який їде державі.
 *
 * Готель із будинком у Чехії і будинком у Німеччині під одним рахунком
 * дістає ОДНУ таблицю ставок. Німецький рахунок виходить із чеськими 21 %
 * замість 19 %, без жодної помилки в лозі. Це інваріант 8 (мовчазного дефолту
 * не буває) та інваріант 22 (юрисдикція — модуль, ядро нейтральне) одночасно,
 * і продукт заявлений під Європу І Україну, тож випадок не гіпотетичний.
 *
 * ── Форма правки, і одна її частина — не з Д54 дослівно ──────────────────
 *
 * Д54 каже: спільний набір застосовується, тільки якщо «країна будинку
 * збігається з країною РАХУНКУ». **Колонки країни в `organizations` не існує**
 * — я перевірила схему на гілці робіт, там є `legal_address`, `vat_no`,
 * `is_vat_payer`, але не `country`. Юрисдикцію в цьому коді визначає
 * `properties.country`: саме її читає `documentLanguage()`, і саме там
 * написано, що юрисдикція не належить готелю як конторі.
 *
 * Тому «країна рахунку» береться так, як цей код УЖЕ бере «власне рахунку»,
 * коли факт лежить лише на будинках: `getOrgIdentity` читає телефон
 * `FROM properties … ORDER BY created_at LIMIT 1`. Країна рахунку — країна
 * НАЙСТАРШОГО будинку. Це не вигадане правило, а наявний у сусідньому файлі
 * взірець; підміна названа у звіті, бо дослівне прочитання Д54 нездійсненне.
 *
 * Напрямок помилки при цьому безпечний: правило вміє лише ВІДМОВИТИ, ніколи
 * не підставити чужу ставку.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Вирішальна вісь — КРАЇНА будинку, тож у фікстурі два будинки з різними
 * країнами (CZ і DE) і `created_at`, виставлений ЯВНО: «найстарший» не можна
 * лишати на розсуд роздільної здатності часу.
 *
 * Друга вісь — наявність власного набору: той самий німецький будинок спершу
 * ВІДМОВЛЯЄ (свого немає, спільний чужий), потім, зі своїм набором, проходить
 * зі СВОЇМ числом. Ставки 21 і 19 — не сплутати, і жодна не є половиною іншої.
 *
 * Чеський будинок проходить в обох станах: без нього «німецький відмовив» було
 * б істинне й на коді, який відмовляє завжди.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-tax-axis-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { postStayCharges } = await import('./stay-charges.repo.ts');
const { createFolio } = await import('./folio.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const TOTAL = 200;
const CZ_REDUCED = 21;   // спільний набір — чеський
const DE_REDUCED = 19;   // власний набір німецького будинку
say(CZ_REDUCED !== DE_REDUCED && CZ_REDUCED !== 2 * DE_REDUCED,
  `ставки несумісні: спільна ${CZ_REDUCED} %, власна німецька ${DE_REDUCED} %`);

await runWithOrganization(fx.organizationId, async () => {
  // Країни — і `created_at` ЯВНО, бо «країна рахунку» береться від найстаршого
  // будинку. Лишити це на роздільну здатність часу означало б фікстуру, у якої
  // вирішальна вісь визначається випадком.
  await sql.run("UPDATE properties SET country = 'CZ', created_at = '2020-01-01T00:00:00Z' WHERE id = ?", [fx.a.id]);
  await sql.run("UPDATE properties SET country = 'DE', created_at = '2024-01-01T00:00:00Z' WHERE id = ?", [fx.b.id]);

  // Спільний набір рахунку — чеський. Ставки для проживання і для напоїв, бо
  // правило каналу нижче ділить суму на три рядки.
  for (const [code, rate] of [['reduced', CZ_REDUCED], ['standard', CZ_REDUCED + 2]] as const) {
    await sql.run(
      'INSERT INTO fin_tax_rates (id, organization_id, code, rate, valid_from) VALUES (?, ?, ?, ?, ?)',
      [`__tx__shared_${code}`, fx.organizationId, code, rate, '2020-01-01']);
  }
});

const post = async (id: string, propertyId: string, unitId: string) =>
  runWithOrganization(fx.organizationId, async () => {
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                                 check_in, check_out, nights, adults, total_price, currency,
                                 status, source)
       VALUES (?, ?, ?, ?, ?, '2026-10-10', '2026-10-11', 1, 2, ?, 'EUR', 'confirmed', 'direct')`,
      [id, fx.organizationId, propertyId, unitId, '__two_props__guest', TOTAL]);
    const folioId = await createFolio({ reservationId: id, payerKind: 'guest' });
    return await postStayCharges({ reservationId: id, folioId }) as
      { lines?: { kind: string; vatRate: number }[]; reason?: string; property?: string; country?: string };
  });

// ── Чеський будинок: спільний набір його, він проходить ───────────────────

const cz = await post('__tx__res_cz', fx.a.id, fx.a.unitIds[0]);
say(!cz.reason, `будинок країни спільного набору проходить (${cz.reason ?? 'без відмови'})`);
say((cz.lines || []).find((l) => l.kind === 'lodging')?.vatRate === CZ_REDUCED,
  `і бере спільну ставку ${CZ_REDUCED} %, отримали ${(cz.lines || []).find((l) => l.kind === 'lodging')?.vatRate}`);

// ── Німецький будинок БЕЗ свого набору: названа відмова, не чужа ставка ───

const deSilent = await post('__tx__res_de', fx.b.id, fx.b.unitIds[0]);
say(deSilent.reason === 'no_tax_rate_for_property',
  `будинок іншої країни ВІДМОВЛЯЄ поіменно, отримали «${deSilent.reason ?? 'нічого — ставка приїхала мовчки'}»`);
say(String(deSilent.property || '').includes('Property B'),
  `відмова називає будинок («${deSilent.property ?? '—'}»)`);
say(String(deSilent.country || '') === 'DE',
  `і його країну («${deSilent.country ?? '—'}») — інакше оператор не знає, що заводити`);
say(!(deSilent.lines || []).some((l) => l.vatRate === CZ_REDUCED),
  'і жодного рядка з чеською ставкою в німецькому документі не зʼявилось');

// ── Той самий будинок зі СВОЇМ набором: проходить зі своїм числом ─────────

await runWithOrganization(fx.organizationId, async () => {
  for (const [code, rate] of [['reduced', DE_REDUCED], ['standard', DE_REDUCED]] as const) {
    await sql.run(
      'INSERT INTO fin_tax_rates (id, organization_id, property_id, code, rate, valid_from) VALUES (?, ?, ?, ?, ?, ?)',
      [`__tx__de_${code}`, fx.organizationId, fx.b.id, code, rate, '2020-01-01']);
  }
});

const deOwn = await post('__tx__res_de2', fx.b.id, fx.b.unitIds[1]);
say(!deOwn.reason, `зі своїм набором німецький будинок проходить (${deOwn.reason ?? 'без відмови'})`);
say((deOwn.lines || []).find((l) => l.kind === 'lodging')?.vatRate === DE_REDUCED,
  `і бере СВОЮ ставку ${DE_REDUCED} %, а не спільну ${CZ_REDUCED} % — отримали ${(deOwn.lines || []).find((l) => l.kind === 'lodging')?.vatRate}`);

// ── Чеський будинок після цього не змінився ──────────────────────────────
//
// Старшинство «будинок перед рахунком» не сміє переливатись на сусіда: поява
// набору в Б не має права торкнутись А.

const czAgain = await post('__tx__res_cz2', fx.a.id, fx.a.unitIds[1]);
say((czAgain.lines || []).find((l) => l.kind === 'lodging')?.vatRate === CZ_REDUCED,
  `чеський будинок і далі на ${CZ_REDUCED} %, отримали ${(czAgain.lines || []).find((l) => l.kind === 'lodging')?.vatRate}`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\ntax-rates.property-axis: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`tax-rates.property-axis: CZ ${CZ_REDUCED} % зі спільного, DE відмовляє поіменно і бере ${DE_REDUCED} % зі свого`);
assert.ok(true);
