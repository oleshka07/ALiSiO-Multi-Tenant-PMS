/**
 * Броні, канали продажу, послуги і закриття — про ОДИН будинок.
 *
 *   node src/modules/bookings/data/lists.scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `listReservations` мав `?property_id=`, і він працював — але приклеювався
 * ЗА МЕЖАМИ літерала (`query += ' AND r.property_id = ?'`), не памʼятав вибір
 * оператора з куки, і на чужий id мовчки віддавав порожньо замість 404. Три
 * сусідні списки — канали продажу з комісіями, платні послуги з цінами і
 * закриття номерів — не мали осі взагалі: готель із двома будинками бачив у
 * кожному з них обидва.
 *
 * Канал продажу і його комісія належать БУДИНКУ: у двох готелів однієї
 * компанії різні договори з тим самим Booking, і показувати їх в одному
 * списку — це запросити правку не в тому рядку (інваріант 29: межа проходить
 * по даних, а комісія — це гроші).
 *
 * ── Чому сцена на репозиторії, а не на маршруті ─────────────────────────
 *
 * Усі чотири хендлери загорнуті у `withActor`, а той кличе `cookies()` — поза
 * запитом Next це виняток, тобто сцени на них не буває взагалі. Тому запити
 * переїхали в `lists.repo.ts`, а хендлер лишив собі розбір адреси в область.
 * Другу половину — що `?property_id=<чужий>` дає 404, а порожнє значення
 * означає «усі» — доводить `src/core/property-scope.check.ts`; тут доводиться
 * те, що з готовою областю запит віддає рядки ОДНОГО будинку.
 *
 * ── Числа ───────────────────────────────────────────────────────────────
 *
 * Броні 2 і 3 (сума 5 — це фікстура), канали 1 і 2 (3), послуги 2 і 1 (3),
 * закриття 1 і 3 (4). Жодна сума не дорівнює жодному доданку (інваріант 26).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-bookings-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { listReservationRows, listSourcesOf, listServicesOf, listBlocksOf } = await import('./lists.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

/**
 * Засів і читання — ПІД орендарем того рахунку, якому рядок належить.
 *
 * На SQLite політик немає, тож `sql.run(...)` у тілі сцени працює й без
 * контексту; на Postgres під `alisio_app` він відхиляється політикою, а
 * читання віддає порожнє. 10.09.2026 виміряно: 16 сцен ходили в базу до
 * контексту, і через це жодна не входила в `check:pg`.
 */
const inOurs = <T>(fn: () => Promise<T>) => runWithOrganization(fx.organizationId, fn);
const inTheirs = <T>(fn: () => Promise<T>) => runWithOrganization(neighbour.organizationId, fn);
/** Рядок будинку — під його рахунком, хай навіть будинок сусідський. */
const forProperty = <T>(propertyId: string, fn: () => Promise<T>) =>
  (propertyId === neighbour.propertyId ? inTheirs(fn) : inOurs(fn));


await inTheirs(() => sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
  ['n_guest', neighbour.organizationId, 'N', 'N']));
await inTheirs(() => sql.run(
  `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                             check_in, check_out, nights, adults, currency)
   VALUES (?, ?, ?, ?, ?, '2026-12-01', '2026-12-02', 1, 2,
           (SELECT default_currency FROM organizations WHERE id = ?))`,
  ['n_res', neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0], 'n_guest',
    neighbour.organizationId],
));

// `booking_sources` і `additional_services` НЕ мають `organization_id`: до
// орендаря вони дістаються лише через `property_id`. Саме тому обидві осі тут
// — це одна колонка, і сплутати їх найлегше.
const source = async (id: string, propertyId: string) => forProperty(propertyId, () => sql.run(
  'INSERT INTO booking_sources (id, property_id, name, code) VALUES (?, ?, ?, ?)',
  [id, propertyId, id, id]));
const service = async (id: string, propertyId: string) => forProperty(propertyId, () => sql.run(
  'INSERT INTO additional_services (id, property_id, name, price) VALUES (?, ?, ?, 100)',
  [id, propertyId, id]));
const block = async (id: string, organizationId: string, unitId: string) =>
  runWithOrganization(organizationId, () => sql.run(
    `INSERT INTO availability_blocks (id, organization_id, unit_id, date_from, date_to)
     VALUES (?, ?, ?, '2026-12-01', '2026-12-05')`,
    [id, organizationId, unitId]));

// Канали 1/2, послуги 2/1, закриття 1/3 — числа різні на кожній осі навмисно.
await source('s_a1', fx.a.id);
await source('s_b1', fx.b.id);
await source('s_b2', fx.b.id);
await source('s_n1', neighbour.propertyId);
await service('sv_a1', fx.a.id);
await service('sv_a2', fx.a.id);
await service('sv_b1', fx.b.id);
await service('sv_n1', neighbour.propertyId);
await block('bl_a1', fx.organizationId, fx.a.unitIds[0]);
for (const i of [0, 1, 2]) await block(`bl_b${i}`, fx.organizationId, fx.b.unitIds[i]);
await block('bl_n1', neighbour.organizationId, neighbour.unitIds[0]);

const noFilters = new URLSearchParams();
const bookings = (organizationId: string, scope: Parameters<typeof listSourcesOf>[1]) =>
  listReservationRows(organizationId, scope, noFilters);

await runWithOrganization(fx.organizationId, async () => {
  const org = fx.organizationId;

  // ─── Броні ───────────────────────────────────────────────────────────────
  assert.strictEqual((await bookings(org, oneProperty(fx.a.id))).length, 2,
    'очікували 2 броні обʼєкта А');
  assert.strictEqual((await bookings(org, oneProperty(fx.b.id))).length, 3,
    'очікували 3 броні обʼєкта Б');
  assert.strictEqual((await bookings(org, ALL_PROPERTIES)).length, 5,
    '«усі обʼєкти» мали дати 5 — і жодної чужого орендаря');

  // ─── Канали продажу ──────────────────────────────────────────────────────
  assert.strictEqual((await listSourcesOf(org, oneProperty(fx.a.id))).length, 1,
    'канал продажу обʼєкта А');
  assert.strictEqual((await listSourcesOf(org, oneProperty(fx.b.id))).length, 2,
    'канали продажу обʼєкта Б');
  assert.strictEqual((await listSourcesOf(org, ALL_PROPERTIES)).length, 3,
    '«усі обʼєкти» мали дати три канали');

  // ─── Послуги ─────────────────────────────────────────────────────────────
  assert.strictEqual((await listServicesOf(org, oneProperty(fx.a.id))).length, 2,
    'послуги обʼєкта А');
  assert.strictEqual((await listServicesOf(org, oneProperty(fx.b.id))).length, 1,
    'послуга обʼєкта Б');
  assert.strictEqual((await listServicesOf(org, ALL_PROPERTIES)).length, 3,
    '«усі обʼєкти» мали дати три послуги');

  // ─── Закриття номерів ────────────────────────────────────────────────────
  assert.strictEqual((await listBlocksOf(org, oneProperty(fx.a.id))).length, 1,
    'закриття обʼєкта А');
  assert.strictEqual((await listBlocksOf(org, oneProperty(fx.b.id))).length, 3,
    'закриття обʼєкта Б');
  assert.strictEqual((await listBlocksOf(org, ALL_PROPERTIES)).length, 4,
    '«усі обʼєкти» мали дати чотири закриття');

  // Обʼєкт сусіда, названий НАШОЮ організацією, не віддає нічого: вісь
  // орендаря лишилась на місці, а не замінилась віссю обʼєкта.
  const foreign = oneProperty(neighbour.propertyId);
  assert.strictEqual((await bookings(org, foreign)).length, 0, 'бронь сусіда видно нашим рахунком');
  assert.strictEqual((await listSourcesOf(org, foreign)).length, 0, 'канал сусіда видно нашим рахунком');
  assert.strictEqual((await listServicesOf(org, foreign)).length, 0, 'послугу сусіда видно нашим рахунком');
  assert.strictEqual((await listBlocksOf(org, foreign)).length, 0, 'закриття сусіда видно нашим рахунком');
});

// Вісь орендаря з другого боку — по одному в сусіда, і жодного нашого.
await runWithOrganization(neighbour.organizationId, async () => {
  const n = neighbour.organizationId;
  assert.strictEqual((await bookings(n, ALL_PROPERTIES)).length, 1, 'сусід побачив не свою бронь');
  assert.strictEqual((await listSourcesOf(n, ALL_PROPERTIES)).length, 1, 'сусід побачив не свій канал');
  assert.strictEqual((await listServicesOf(n, ALL_PROPERTIES)).length, 1, 'сусід побачив не свою послугу');
  assert.strictEqual((await listBlocksOf(n, ALL_PROPERTIES)).length, 1, 'сусід побачив не своє закриття');
});

console.log('  ok  броні 2/3/5, канали 1/2/3, послуги 2/1/3, закриття 1/3/4; чужий орендар — по одному своєму');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('bookings lists.scope: усі перевірки пройдено');
