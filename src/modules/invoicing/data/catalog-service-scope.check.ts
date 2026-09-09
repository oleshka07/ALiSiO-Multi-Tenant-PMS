/**
 * Послуга лягає в рахунок лише СВОГО обʼєкта — з його ціною і його ПДВ (INC-036).
 *
 *   node src/modules/invoicing/data/catalog-service-scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `postCatalogService` читає фоліо запитом, у якому обʼєкт УЖЕ обчислено —
 * `COALESCE(r.property_id, f.property_id) AS property_id`, і двадцятьма рядками
 * нижче він же обирає мову документа. А послугу звіряло лише з рахунком:
 *
 *   SELECT s.price, s.vat_code … FROM additional_services s
 *     JOIN properties p ON p.id = s.property_id
 *    WHERE s.id = ? AND p.organization_id = ?
 *
 * Два звірені значення, між собою не звірені ЖОДНОГО разу. Наслідок не
 * косметичний: у нарахування їдуть `price` і `vat_code` ЧУЖОГО обʼєкта — тобто
 * ставка чужої юрисдикції (інваріант 22), — тоді як мова документа береться
 * від обʼєкта фоліо. Один рахунок склеюється з двох податкових режимів.
 *
 * ── Чому дві сцени мало, і третя не косметична ──────────────────────────
 *
 * `fin_folios.property_id` НУЛЬОВИЙ, `reservations` підставляється через
 * `LEFT JOIN`, а `createFolio` приймає обидва як `null` — фоліо без броні й без
 * обʼєкта це досяжний стан (події, рахунок компанії). Вузьке
 * `AND s.property_id = ?` на такому фоліо відмовило б у КОЖНІЙ послузі, і це
 * виглядало б як «функція зникла» — рівно та поломка, про яку AGENTS §7.
 *
 * Тому третя сцена стереже саме її: фоліо без обʼєкта відмовляє ПОІМЕННО
 * (`folio_without_property`), а не мовчить і не «отже, будь-яка послуга».
 * Це інваріант 13 і рішення 3 контролера від 09.09 дослівно: «не знаю» — це
 * названий стан, а не дозвіл.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Одна організація, ДВА обʼєкти (спільна фікстура): орендар тут ні до чого —
 * варта рахунку працює, і саме тому вада прожила. Ціни послуг РІЗНІ і
 * несумісні (70 проти 900): з однаковими «нарахували 70» було б істинним і на
 * зламаному коді, а так чуже число видно в сумі рахунку.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-catalog-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { createFolio } = await import('./folio.repo.ts');
const { postCatalogService } = await import('./stay-charges.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const PRICE_A = 70;
const PRICE_B = 900;

await runWithOrganization(fx.organizationId, async () => {
  // Ставка ПДВ — інакше кожна сцена впала б у `no_tax_rate`, і твердження про
  // обʼєкт було б порожнім: відмова є, але не та.
  await sql.run(
    `INSERT INTO fin_tax_rates (id, organization_id, code, rate, valid_from)
     VALUES (?, ?, ?, ?, ?)`,
    ['__cat_scope__rate', fx.organizationId, 'standard', 21, '2000-01-01']);
  for (const [id, prop, name, price] of [
    ['__cat_scope__svc_a', fx.a.id, 'Вода А', PRICE_A],
    ['__cat_scope__svc_b', fx.b.id, 'Вода Б', PRICE_B],
  ] as const) {
    await sql.run(
      `INSERT INTO additional_services (id, property_id, name, price, currency, vat_code, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [id, prop, name, price, 'EUR', 'standard']);
  }
});

const svcA = '__cat_scope__svc_a';
const svcB = '__cat_scope__svc_b';
const DATE = '2026-09-09';

/** Фоліо броні обʼєкта А — обʼєкт приходить із броні через `COALESCE`. */
const folioA = await runWithOrganization(fx.organizationId, () =>
  createFolio({ reservationId: fx.a.reservationIds[0] }));

const post = (folioId: string, serviceId: string) =>
  runWithOrganization(fx.organizationId, () => postCatalogService({
    folioId, reservationId: null, serviceId, quantity: 1, serviceDate: DATE,
  }));

const charged = (folioId: string) => runWithOrganization(fx.organizationId, () =>
  sql.rows<{ description: string; total_gross: number }>(
    'SELECT description, total_gross FROM fin_folio_items WHERE folio_id = ?', [folioId]));

// ── 0. Вісь не вироджена — перевіряється числами, а не оком ───────────────
//
// Реєстр `check-fixture-axes` тримає ці два літерали окремо; тут те саме
// стверджується під час прогону, бо реєстр лічить ТЕКСТ, а рівність чисел —
// властивість. Якщо ціни зрівняти, «нарахували свою» стане істинним і на
// зламаному коді, і решта файла перестане щось означати.
say(PRICE_A !== PRICE_B, `ціни послуг двох обʼєктів різні (${PRICE_A} проти ${PRICE_B})`);

// ── 1. Своя послуга проходить — зустрічна половина, без неї решта порожня ──

const own = await post(folioA, svcA);
say(!('reason' in own), `послуга ВЛАСНОГО обʼєкта нарахована (${'reason' in own ? own.reason : 'ок'})`);

const afterOwn = await charged(folioA);
say(afterOwn.length === 1 && Number(afterOwn[0].total_gross) === PRICE_A,
  `у рахунку рівно один рядок на ${PRICE_A} (знайшли ${afterOwn.map((c) => c.total_gross).join(', ') || 'нічого'})`);

// ── 2. Чужа послуга — відмова, і в рахунку НІЧОГО не додалось ──────────────

const alien = await post(folioA, svcB);
say('reason' in alien && alien.reason === 'no_service',
  `послуга ЧУЖОГО обʼєкта відмовлена як «no_service» (${'reason' in alien ? alien.reason : 'НАРАХОВАНА'})`);

const afterAlien = await charged(folioA);
say(afterAlien.length === 1,
  `після відмови в рахунку досі один рядок, не два (${afterAlien.length})`);
say(!afterAlien.some((c) => Number(c.total_gross) === PRICE_B),
  `ціна чужого обʼєкта (${PRICE_B}) у рахунок не потрапила`);

// ── 3. Фоліо БЕЗ обʼєкта: названа відмова, не «отже, будь-яка послуга» ─────
//
// Це не крайовий випадок заради повноти: саме сюди веде найдешевша правка
// (вузьке `AND s.property_id = ?`), і саме так вона ламає подію й рахунок
// компанії — мовчки, без жодної помилки в логах.

const folioNoProperty = await runWithOrganization(fx.organizationId, () =>
  createFolio({ reservationId: null, propertyId: null, label: 'Подія без обʼєкта' }));

const orphan = await post(folioNoProperty, svcA);
say('reason' in orphan && orphan.reason === 'folio_without_property',
  `фоліо без обʼєкта відмовляє ПОІМЕННО (${'reason' in orphan ? orphan.reason : 'НАРАХУВАЛО мовчки'})`);

const orphanCharges = await charged(folioNoProperty);
say(orphanCharges.length === 0,
  `у фоліо без обʼєкта не нараховано нічого (${orphanCharges.length})`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\ncatalog-service-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log('catalog-service-scope: у рахунок іде послуга свого обʼєкта; фоліо без обʼєкта відмовляє поіменно');
assert.ok(true);
