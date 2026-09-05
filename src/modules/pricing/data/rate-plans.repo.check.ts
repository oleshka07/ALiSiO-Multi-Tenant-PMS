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
 * І четверте, Блок 2.1 (сцена 7): тариф, заведений у вендора, видалити не
 * можна (`mapped`) — але його можна ЗНЯТИ З ПРОДАЖУ, і тоді дзеркало
 * лишається, ціна зникає для всіх (`priceNights` → `missing`), а в чергу
 * лягає координата на кожну пару до горизонту — канал закриє ночі (И14).
 * Повернення в продаж — та сама дорога назад.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24); сцена 7 —
 * теж: `isActive` у патчі мовчки ігнорувався, тариф лишався в продажу.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { createRatePlan, updateRatePlan, listRatePlans, deleteRatePlan } = await import('./rate-plans.repo.ts');
const { propertyRatePlans } = await import('./property-rate-plans.ts');
const { priceNights } = await import('./nightly-price.ts');
const { clipToHorizon } = await import('@channels/outbox');

const sql = getSql();
const A = '__rpw__a';
const B = '__rpw__b';
const PROP = (org: string) => `${org}_prop`;
const UT = (org: string) => `${org}_ut`;

async function cleanup() {
  await sql.run("DELETE FROM cm_outbox WHERE connection_id = '__rpw_conn'");
  await sql.run("DELETE FROM cm_mappings WHERE connection_id = '__rpw_conn'");
  await sql.run("DELETE FROM cm_connections WHERE id = '__rpw_conn'");
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

  // ── 6. Видалення: лише чистий тариф, лише свій ────────────────────────
  //
  // 02.09.2026: на беті тариф ліг не на той обʼєкт (селектор обʼєкта на
  // екрані «Тарифи» без підпису, дефолт — перший за датою створення), а
  // прибрати його не було чим. Видаляти можна те, на що ніхто не спирається:
  // є ціни → `has_prices`, заведено у вендора → `mapped`, є бронювання →
  // `in_use`. Кожна відмова названа, бо мовчазне «не вийшло» тут — це
  // тариф-привид, який канал далі бачить продаваним.
  await runWithOrganization(A, () => assert.rejects(() => deleteRatePlan(bb.id), /has_prices/,
    'під тарифом є ціна — не видаляється, і причина названа'));
  await runWithOrganization(B, () => assert.rejects(() => deleteRatePlan(bar.id), /not found/i,
    'чужий орендар не видаляє — «not found», не 403'));
  assert.strictEqual((await sql.rows('SELECT id FROM rate_plans WHERE id = ?', [bar.id])).length, 1, 'BAR на місці після чужої спроби');

  await sql.run(
    `INSERT INTO cm_connections (id, organization_id, property_id, provider, webhook_token, webhook_secret)
     VALUES ('__rpw_conn', ?, ?, 'test', '__rpw_wt', '__rpw_ws')`,
    [A, PROP(A)],
  );
  await sql.run(
    `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, remote_id)
     VALUES ('__rpw_map', ?, '__rpw_conn', 'rate_plan', ?, ?, 'remote-bar')`,
    [A, bar.id, UT(A)],
  );
  await runWithOrganization(A, () => assert.rejects(() => deleteRatePlan(bar.id), /mapped/,
    'тариф заведено у вендора — не видаляється: дзеркало лишилось би без оригіналу'));
  await sql.run('DELETE FROM cm_mappings WHERE id = ?', ['__rpw_map']);

  await sql.run(
    `INSERT INTO cm_outbox (id, organization_id, connection_id, kind, unit_type_id, rate_plan_id, stay_date, stay_date_to)
     VALUES ('__rpw_out', ?, '__rpw_conn', 'rate', ?, ?, '2026-11-22', '2026-11-22')`,
    [A, UT(A), bar.id],
  );
  await runWithOrganization(A, () => deleteRatePlan(bar.id));
  assert.strictEqual((await sql.rows('SELECT id FROM rate_plans WHERE id = ?', [bar.id])).length, 0, 'чистий тариф видалено');
  assert.strictEqual((await sql.rows('SELECT id FROM cm_outbox WHERE rate_plan_id = ?', [bar.id])).length, 0,
    'координати черги видаленого тарифу прибрано разом із ним — батчер не шукатиме тариф, якого немає');
  assert.deepStrictEqual((await runWithOrganization(A, () => listRatePlans(PROP(A)))).map((p) => p.code), ['BB'], 'у списку лишився лише BB');
  console.log('  ok  видалення: чистий свій тариф — так; з цінами, заведений у вендора, чужий — названа відмова');

  // ── 7. Зняти з продажу: дзеркало лишається, ціна зникає, черга до горизонту ─
  //
  // BB заведено у вендора (мапінг на `__rpw_conn`), під ним ціна 120 на
  // 2026-11-22 (сцена 5). Дві осі (інваріант 26): той самий рядок ціни дає
  // 120 при `isActive: true` і `missing` при `false` — константа не пройде.
  // Координата — від сьогодні до горизонту, рівно та, що кладе `noteRatesChanged`
  // (`clipToHorizon`), і рівно на пару з дзеркала; без дзеркала нема кому
  // адресувати.
  const D = '2026-11-22';
  const today = new Date().toISOString().slice(0, 10);
  const span = clipToHorizon(today, null, today)!;
  await sql.run(
    `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, remote_id)
     VALUES ('__rpw_map_bb', ?, '__rpw_conn', 'rate_plan', ?, ?, 'remote-bb')`,
    [A, bb.id, UT(A)],
  );
  await sql.run("DELETE FROM cm_outbox WHERE connection_id = '__rpw_conn'");
  const quote = () => runWithOrganization(A, () => priceNights({ unitTypeId: UT(A), checkIn: D, nights: 1, adults: 2, ratePlanId: bb.id }));
  assert.strictEqual((await quote()).nights[0]?.price, 120, 'до зняття: ціна тарифу на дату є');

  const off = await runWithOrganization(A, () => updateRatePlan(bb.id, { isActive: false }));
  assert.strictEqual(off.isActive, false, 'писач мав зняти тариф з продажу, а не проігнорувати поле');
  const listedOff = await runWithOrganization(A, () => listRatePlans(PROP(A)));
  assert.strictEqual(listedOff.find((p) => p.id === bb.id)?.isActive, false, 'у списку екрана тариф є — і видно, що знятий');
  assert.ok(!(await runWithOrganization(A, () => propertyRatePlans(PROP(A)))).some((p) => p.id === bb.id),
    'читач каналу знятого тарифу не бачить — у каталог він більше не йде');
  const gone = await quote();
  assert.deepStrictEqual(gone.missing, [D], 'ціна знятого тарифу не існує (інваріант 17) — навіть та, що лежить у календарі');
  assert.strictEqual(gone.ratePlanRetired, true, 'і причина названа: тариф знято з продажу, а не «ціни немає»');
  const coords = await sql.rows<any>(
    "SELECT unit_type_id, rate_plan_id, stay_date, stay_date_to FROM cm_outbox WHERE connection_id = '__rpw_conn' AND kind = 'rate'",
  );
  assert.deepStrictEqual(
    coords.map((c) => ({ ut: String(c.unit_type_id), rp: String(c.rate_plan_id), from: String(c.stay_date).slice(0, 10), to: String(c.stay_date_to).slice(0, 10) })),
    [{ ut: UT(A), rp: bb.id, from: span.from, to: span.to }],
    'зняття кладе РІВНО одну координату: пара з дзеркала, від сьогодні до горизонту',
  );
  assert.strictEqual((await sql.rows('SELECT id FROM cm_mappings WHERE id = ?', ['__rpw_map_bb'])).length, 1, 'дзеркало лишилось — є кому адресувати «закрито»');
  await runWithOrganization(B, () => assert.rejects(() => updateRatePlan(bb.id, { isActive: true }), /not found/i, 'чужий орендар не повертає в продаж'));

  await sql.run("DELETE FROM cm_outbox WHERE connection_id = '__rpw_conn'");
  const on = await runWithOrganization(A, () => updateRatePlan(bb.id, { isActive: true }));
  assert.strictEqual(on.isActive, true);
  const back = await quote();
  assert.deepStrictEqual(back.missing, [], 'повернутий у продаж — ціна знову є');
  assert.strictEqual(back.nights[0]?.price, 120, 'та сама ціна з календаря, не нова');
  assert.ok((await runWithOrganization(A, () => propertyRatePlans(PROP(A)))).some((p) => p.id === bb.id), 'і читач каналу знову бачить');
  assert.strictEqual((await sql.rows("SELECT id FROM cm_outbox WHERE connection_id = '__rpw_conn' AND kind = 'rate'")).length, 1,
    'повернення теж кладе координату до горизонту — канал має відкрити ночі, а не чекати наступної ціни');
  console.log('  ok  зняти з продажу: дзеркало лишається, ціна зникає для всіх, координата на пару до горизонту; повернення — назад');

  // ── 8. Режим ціни — за номер чи за особу — обирає готель; замок після заведення ─
  //
  // Блок 2.2: у вендора режим тарифу задає набір опцій заселеності, а набір
  // опцій після створення не переробити (виміряно: PUT з options — 422 або
  // нуль змін). Тому режим обирається при створенні й ЗАМИКАЄТЬСЯ, щойно
  // тариф заведено (є в дзеркалі); без вибору — «за особу», як заводились усі
  // тарифи досі. BB заведено у вендора (дзеркало зі сцени 7). Дві осі
  // (інваріант 26): обидва режими в одній сцені.
  const room = await runWithOrganization(A, () => createRatePlan({
    propertyId: PROP(A), name: 'Room rate', code: 'ROOM', currency: 'USD', mealPlan: null, childExtraGross: null, sellMode: 'per_room',
  }));
  assert.strictEqual(room.sellMode, 'per_room', 'режим «за номер» мав зберегтись');
  const listedModes = await runWithOrganization(A, () => listRatePlans(PROP(A)));
  assert.strictEqual(listedModes.find((p) => p.id === bb.id)?.sellMode, 'per_person', 'без вибору — «за особу»: так заводились усі тарифи досі');
  assert.strictEqual(listedModes.find((p) => p.id === bb.id)?.mapped, true, 'екран має бачити, що тариф заведено у вендора');
  assert.strictEqual(listedModes.find((p) => p.id === room.id)?.mapped, false);
  await runWithOrganization(A, () => assert.rejects(
    () => createRatePlan({ propertyId: PROP(A), name: 'Bad', code: 'BAD', currency: 'USD', mealPlan: null, childExtraGross: null, sellMode: 'per_night' as never }),
    /sell_mode_invalid/, 'невідомий режим — відмова з назвою, не тихий дефолт',
  ));
  const flipped = await runWithOrganization(A, () => updateRatePlan(room.id, { sellMode: 'per_person' }));
  assert.strictEqual(flipped.sellMode, 'per_person', 'незаведений тариф міняє режим вільно');
  await runWithOrganization(A, () => assert.rejects(() => updateRatePlan(bb.id, { sellMode: 'per_room' }), /sell_mode_locked/,
    'заведений тариф: опції на тому боці не переробити — режим замкнений'));
  const sameMode = await runWithOrganization(A, () => updateRatePlan(bb.id, { sellMode: 'per_person', name: 'B&B' }));
  assert.strictEqual(sameMode.sellMode, 'per_person', 'той самий режим у запиті — не зміна, решта полів зберігається');
  console.log('  ok  режим ціни обирає готель; без вибору — за особу; заведений тариф режиму не міняє');

  console.log('rate-plans: тариф свого обʼєкта, код унікальний на обʼєкті, валюта замкнена ціною, видалення лише чистого, зняття з продажу закриває канал, режим ціни замкнений заведенням');
} finally {
  await cleanup();
}
