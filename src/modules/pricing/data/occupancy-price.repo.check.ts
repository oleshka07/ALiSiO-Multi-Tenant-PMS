/**
 * Матриця заселеності: нуль — не ціна (рецензія 2.0, розділ A п.2, 05.09.2026).
 *
 *   node src/modules/pricing/data/occupancy-price.repo.check.ts
 *
 * Обробник матриці приймав `price_gross >= 0` («0 is a real price — a free
 * night given to a partner is still a row»), і той самий нуль їхав у канал
 * ціною ночі — тим самим шляхом, що й нуль у календарі (INC-017). Правило
 * одне на всі писачі ціни (інваріант 17, Ц24): ціни немає — рядка немає;
 * нуль і відʼємне — відмова з назвою `price_not_positive`, як
 * `assertPositivePrice` у календарі. «Безкоштовна ніч партнеру» — це знижка
 * або нарахування на фоліо, не ціна нуль у джерелі, яке читає канал.
 *
 * Осі (інваріант 26): нуль і відʼємне відмовляють, додатне пише; те саме на
 * створенні й на зміні. Перевірка була ЧЕРВОНОЮ до зміни репозиторію.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { createPrice, updatePrice } = await import('./occupancy-price.repo.ts');

const sql = getSql();
const ORG = '__opr_check__';
const PROP = `${ORG}_prop`;
const UT = `${ORG}_dbl`;

async function cleanup() {
  await sql.run('DELETE FROM price_occupancy WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM unit_types WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM categories WHERE property_id = ?', [PROP]);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, ORG, ORG]);
await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, ORG, PROP]);
await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [`${ORG}_cat`, PROP, 'Rooms', 'room']);
await sql.run(
  `INSERT INTO unit_types (id, property_id, category_id, name, code, max_adults, max_children, max_occupancy, base_occupancy)
   VALUES (?, ?, ?, 'Double', 'DBL', 2, 0, 2, 2)`,
  [UT, PROP, `${ORG}_cat`],
);

try {
  await runWithOrganization(ORG, async () => {
    await assert.rejects(() => createPrice(PROP, { unit_type_id: UT, persons: 2, price_gross: 0 }), /price_not_positive/,
      'нуль у матриці записався — і поїде в канал ціною ночі (INC-017)');
    await assert.rejects(() => createPrice(PROP, { unit_type_id: UT, persons: 2, price_gross: -5 }), /price_not_positive/,
      'відʼємне у матриці — теж відмова з назвою');
    assert.strictEqual(await sql.row<any>('SELECT COUNT(*) AS n FROM price_occupancy WHERE organization_id = ?', [ORG]).then((r) => Number(r?.n)), 0,
      'після відмови рядків немає');

    const id = await createPrice(PROP, { unit_type_id: UT, persons: 2, price_gross: 100 });
    assert.ok(id, 'додатна ціна пишеться');
    await assert.rejects(() => updatePrice(id!, 0), /price_not_positive/, 'зміна на нуль — відмова, а не безкоштовна ніч у каналі');
    assert.strictEqual(await updatePrice(id!, 120), true, 'зміна на додатне проходить');
    const row = await sql.row<any>('SELECT price_gross FROM price_occupancy WHERE id = ?', [id]);
    assert.strictEqual(Number(row.price_gross), 120, 'і записана саме вона');
    console.log('  ok  матриця: нуль і відʼємне відмовляють з назвою, додатне пишеться — на створенні й на зміні');
  });
} finally {
  await cleanup();
}

console.log('occupancy-price.repo: нуль — не ціна і в матриці');
