/**
 * Тарифи обʼєкта: створити, змінити — під орендарем, з унікальним кодом, без тихої зміни валюти.
 *
 *   node src/modules/pricing/data/rate-plans.repo.check.ts
 *
 * Форма тарифу — звичайна акуратність (інваріант 29). Але писач годує канал:
 * з тарифу береться валюта обʼєкта у вендора (`catalog-sync.ts`), а пара
 * «тип × тариф» — це адреса ціни (Ц10). Тому три речі тут залізні:
 *
 *   1. обʼєкт — лише свого орендаря; чужий → «not found», не «створено»;
 *   2. код унікальний у межах обʼєкта — названою відмовою, не 500;
 *   3. валюта не міняється, коли під тарифом уже є ціни: у вендора тариф
 *      заведено з валютою, і тиха зміна тут означала б ціни в іншій валюті
 *      на тому боці без жодної помилки.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { createRatePlan, updateRatePlan, listRatePlans } = await import('./rate-plans.repo.ts');
const { propertyRatePlans } = await import('./property-rate-plans.ts');

const sql = getSql();
const A = '__rpw__a';
const B = '__rpw__b';
const PROP = (org: string) => `${org}_prop`;
const UT = (org: string) => `${org}_ut`;

async function cleanup() {
  for (const org of [A, B]) {
    await sql.run('DELETE FROM price_calendar WHERE unit_type_id = ?', [UT(org)]);
    await sql.run('DELETE FROM rate_plans WHERE property_id = ?', [PROP(org)]);
    await sql.run('DELETE FROM unit_types WHERE id = ?', [UT(org)]);
    await sql.run('DELETE FROM categories WHERE property_id = ?', [PROP(org)]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}
async function seed(org: string) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP(org), org, org, PROP(org)]);
  await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [`${org}_cat`, PROP(org), 'Rooms', 'room']);
  await sql.run(
    `INSERT INTO unit_types (id, property_id, category_id, name, code, max_adults, max_children, max_occupancy, base_occupancy)
     VALUES (?, ?, ?, 'Double', 'DBL', 2, 0, 2, 2)`,
    [UT(org), PROP(org), `${org}_cat`],
  );
}

await cleanup();
await seed(A);
await seed(B);

try {
  // ── 1. Створення — лише на своєму обʼєкті ────────────────────────────
  const bar = await runWithOrganization(A, () => createRatePlan({
    propertyId: PROP(A), name: 'Best Available Rate', code: 'BAR', currency: 'USD', mealPlan: null, childExtraGross: null,
  }));
  assert.ok(bar.id, 'створений тариф має id');
  assert.deepStrictEqual(
    { name: bar.name, code: bar.code, currency: bar.currency, mealPlan: bar.mealPlan, isActive: bar.isActive },
    { name: 'Best Available Rate', code: 'BAR', currency: 'USD', mealPlan: null, isActive: true },
  );

  await runWithOrganization(A, () => assert.rejects(
    () => createRatePlan({ propertyId: PROP(B), name: 'X', code: 'X', currency: 'USD', mealPlan: null, childExtraGross: null }),
    /not found/i, 'чужий обʼєкт — «not found», не тариф у чужому готелі',
  ));
  assert.strictEqual((await sql.rows('SELECT id FROM rate_plans WHERE property_id = ?', [PROP(B)])).length, 0, 'у Б нічого не зʼявилось');
  console.log('  ok  тариф створюється лише на своєму обʼєкті');

  // ── 2. Код унікальний у межах обʼєкта — названо, не 500 ──────────────
  await runWithOrganization(A, () => assert.rejects(
    () => createRatePlan({ propertyId: PROP(A), name: 'Again', code: 'bar', currency: 'USD', mealPlan: null, childExtraGross: null }),
    /code_taken/, 'той самий код (без урахування регістру) — відмова з назвою',
  ));
  const barB = await runWithOrganization(B, () => createRatePlan({
    propertyId: PROP(B), name: 'BAR у Б', code: 'BAR', currency: 'EUR', mealPlan: null, childExtraGross: null,
  }));
  assert.ok(barB.id, 'той самий код на іншому обʼєкті — можна');
  console.log('  ok  код унікальний на обʼєкті, не на світі');

  // ── 3. Список і читач каналу бачать одне й те саме ────────────────────
  const bb = await runWithOrganization(A, () => createRatePlan({
    propertyId: PROP(A), name: 'Bed & Breakfast', code: 'BB', currency: 'USD', mealPlan: 'breakfast', childExtraGross: 15,
  }));
  const listed = await runWithOrganization(A, () => listRatePlans(PROP(A)));
  assert.deepStrictEqual(listed.map((p) => p.code), ['BAR', 'BB']);
  assert.strictEqual(listed[1].childExtraGross, 15);
  assert.strictEqual(listed[1].mealPlan, 'breakfast');
  assert.ok(listed.every((p) => p.pricedUnitTypes.length === 0), 'без цін — ні на якому типі; це видно, а не сховано');
  const forChannel = await runWithOrganization(A, () => propertyRatePlans(PROP(A)));
  assert.deepStrictEqual(forChannel.map((p) => p.code), ['BAR', 'BB'], 'читач каналу бачить обидва');
  assert.ok(forChannel.every((p) => p.sellable === false), 'і обидва — непродавані, доки немає ціни (інваріант 17)');
  assert.strictEqual((await runWithOrganization(B, () => listRatePlans(PROP(A)))).length, 0, 'чужий обʼєкт — порожньо');
  console.log('  ok  список і читач каналу згодні; без ціни тариф є, але не продається');

  // ── 4. Зміна: назва й ціна дитини; код — з тією ж унікальністю ────────
  const renamed = await runWithOrganization(A, () => updateRatePlan(bb.id, { name: 'Bed and Breakfast', childExtraGross: 20 }));
  assert.strictEqual(renamed.name, 'Bed and Breakfast');
  assert.strictEqual(renamed.childExtraGross, 20);
  await runWithOrganization(A, () => assert.rejects(() => updateRatePlan(bb.id, { code: 'BAR' }), /code_taken/));
  await runWithOrganization(B, () => assert.rejects(() => updateRatePlan(bb.id, { name: 'Чужими руками' }), /not found/i, 'чужий орендар не редагує'));
  assert.strictEqual((await runWithOrganization(A, () => listRatePlans(PROP(A))))[1].name, 'Bed and Breakfast');
  console.log('  ok  зміна назви й ціни дитини; чужий орендар — «not found»');

  // ── 5. Валюта: вільна, доки немає цін; замкнена, щойно вони є ─────────
  const eur = await runWithOrganization(A, () => updateRatePlan(bb.id, { currency: 'EUR' }));
  assert.strictEqual(eur.currency, 'EUR', 'без цін валюту можна змінити');
  await sql.run(
    `INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price) VALUES ('__rpw_pc', ?, ?, '2026-11-22', 120)`,
    [UT(A), bb.id],
  );
  await runWithOrganization(A, () => assert.rejects(() => updateRatePlan(bb.id, { currency: 'USD' }), /currency_locked/,
    'є ціна під тарифом — валюта замкнена: у вендора тариф уже заведено з нею'));
  const still = await runWithOrganization(A, () => listRatePlans(PROP(A)));
  assert.strictEqual(still[1].currency, 'EUR', 'валюта не змінилась');
  assert.deepStrictEqual(still[1].pricedUnitTypes, ['DBL'], 'а тип, під яким є ціна, названо');
  const same = await runWithOrganization(A, () => updateRatePlan(bb.id, { currency: 'EUR', name: 'B&B' }));
  assert.strictEqual(same.name, 'B&B', 'та сама валюта в запиті — не зміна, назва міняється');
  console.log('  ok  валюта вільна без цін і замкнена з цінами');

  console.log('rate-plans: тариф свого обʼєкта, код унікальний на обʼєкті, валюта замкнена ціною');
} finally {
  await cleanup();
}
