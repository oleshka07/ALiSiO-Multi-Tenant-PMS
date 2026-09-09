/**
 * Зали, доповнення й події — списки ОДНОГО обʼєкта.
 *
 *   node src/modules/events/data/events.scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `event_spaces`, `event_bookings` і `event_addons` — серед таблиць із НУЛЕМ
 * названих читань (інвентар INC-029). Три списки модуля фільтрувались лише
 * `organization_id`, хоч `property_id` у кожній таблиці є і `NOT NULL`:
 * готель із двома будинками бачив у списку залів обидва, а «події на тиждень»
 * зводили розклад двох різних адрес в один аркуш.
 *
 * Це не витік між орендарями — це друга вісь усередині одного рахунку, і
 * саме її оператор бачить очима.
 *
 * ── Чому окремий файл, а не сцена в `events.repo.check.ts` ──────────────
 *
 * Той сусід ганяє РОБОЧУ базу розробника і прибирає за собою `DELETE`-ами по
 * своїй організації. Спільна фікстура має фіксовані id, тож другий запуск
 * зіткнувся б сам із собою на `UNIQUE`. Тут — своя тимчасова база, як у решти
 * сцен осі обʼєкта.
 *
 * ── Числа ───────────────────────────────────────────────────────────────
 *
 * Зали 2 і 3 (сума 5), доповнення 1 і 2 (сума 3), події 2 і 4 (сума 6). Жодна
 * сума не дорівнює жодному доданку — інакше «забув вісь» не відрізнити від
 * «урахував» (інваріант 26, друга половина). Сусідня організація має свій
 * зал і свою подію: твердження про вісь обʼєкта без осі орендаря порожнє.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-events-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const events = await import('./events.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

/** Зал, доповнення й подія — прямим SQL: репозиторій це те, що перевіряють. */
const space = async (id: string, organizationId: string, propertyId: string) =>
  sql.run(
    `INSERT INTO event_spaces (id, organization_id, property_id, name, code)
     VALUES (?, ?, ?, ?, ?)`,
    [id, organizationId, propertyId, id, id],
  );
const addon = async (id: string, organizationId: string, propertyId: string) =>
  sql.run(
    `INSERT INTO event_addons (id, organization_id, property_id, name, kind, price_gross)
     VALUES (?, ?, ?, ?, 'flat', 100)`,
    [id, organizationId, propertyId, id],
  );
const booking = async (id: string, organizationId: string, propertyId: string, spaceId: string, day: number) =>
  sql.run(
    `INSERT INTO event_bookings (id, organization_id, property_id, space_id, event_date,
                                 time_from, time_to, persons, customer_name)
     VALUES (?, ?, ?, ?, ?, '10:00', '12:00', 10, ?)`,
    [id, organizationId, propertyId, spaceId, `2026-10-${String(day).padStart(2, '0')}`, id],
  );

// Обʼєкт А: 2 зали, 1 доповнення, 2 події. Обʼєкт Б: 3 / 2 / 4.
for (const i of [1, 2]) await space(`a_space_${i}`, fx.organizationId, fx.a.id);
for (const i of [1, 2, 3]) await space(`b_space_${i}`, fx.organizationId, fx.b.id);
await addon('a_addon_1', fx.organizationId, fx.a.id);
for (const i of [1, 2]) await addon(`b_addon_${i}`, fx.organizationId, fx.b.id);
for (const i of [1, 2]) await booking(`a_ev_${i}`, fx.organizationId, fx.a.id, 'a_space_1', i);
for (const i of [1, 2, 3, 4]) await booking(`b_ev_${i}`, fx.organizationId, fx.b.id, 'b_space_1', 10 + i);

// Сусід — свій зал, своє доповнення, своя подія.
await space('n_space_1', neighbour.organizationId, neighbour.propertyId);
await addon('n_addon_1', neighbour.organizationId, neighbour.propertyId);
await booking('n_ev_1', neighbour.organizationId, neighbour.propertyId, 'n_space_1', 20);

await runWithOrganization(fx.organizationId, async () => {
  // ─── Зали ────────────────────────────────────────────────────────────────
  const spacesA = await events.listSpaces(oneProperty(fx.a.id));
  assert.strictEqual(spacesA.length, 2, `очікували 2 зали обʼєкта А, отримали ${spacesA.length}`);
  assert.ok(spacesA.every((s) => s.property_id === fx.a.id), 'у списку залів А є чужий обʼєкт');

  const spacesB = await events.listSpaces(oneProperty(fx.b.id));
  assert.strictEqual(spacesB.length, 3, `очікували 3 зали обʼєкта Б, отримали ${spacesB.length}`);

  assert.strictEqual((await events.listSpaces(ALL_PROPERTIES)).length, 5,
    '«усі обʼєкти» мали дати 5 залів — і жодного чужого орендаря');

  // Знятий із продажу зал не зникає з осі: `all: true` розширює вибірку по
  // ІНШІЙ осі, і область має лишитись на місці.
  await sql.run('UPDATE event_spaces SET is_active = FALSE WHERE id = ?', ['a_space_2']);
  assert.strictEqual((await events.listSpaces(oneProperty(fx.a.id))).length, 1,
    'неактивний зал лишився в звичайному списку');
  assert.strictEqual((await events.listSpaces(oneProperty(fx.a.id), { all: true })).length, 2,
    'екран налаштувань не побачив неактивного залу свого обʼєкта');
  assert.strictEqual((await events.listSpaces(oneProperty(fx.b.id), { all: true })).length, 3,
    '`all` розширив вибірку ще й по осі обʼєкта');
  await sql.run('UPDATE event_spaces SET is_active = TRUE WHERE id = ?', ['a_space_2']);

  // ─── Доповнення ──────────────────────────────────────────────────────────
  assert.strictEqual((await events.listAddons(oneProperty(fx.a.id))).length, 1,
    'обʼєкт А мав віддати одне доповнення');
  assert.strictEqual((await events.listAddons(oneProperty(fx.b.id))).length, 2,
    'обʼєкт Б мав віддати два доповнення');
  assert.strictEqual((await events.listAddons(ALL_PROPERTIES)).length, 3,
    '«усі обʼєкти» мали дати 3 доповнення');

  // ─── Події ───────────────────────────────────────────────────────────────
  const evA = await events.listBookings(oneProperty(fx.a.id));
  assert.strictEqual(evA.length, 2, `очікували 2 події обʼєкта А, отримали ${evA.length}`);
  const evB = await events.listBookings(oneProperty(fx.b.id));
  assert.strictEqual(evB.length, 4, `очікували 4 події обʼєкта Б, отримали ${evB.length}`);
  assert.strictEqual((await events.listBookings(ALL_PROPERTIES)).length, 6,
    '«усі обʼєкти» мали дати 6 подій');

  // Фільтр дат діє ВСЕРЕДИНІ області, а не замість неї.
  assert.strictEqual((await events.listBookings(oneProperty(fx.b.id), { from: '2026-10-13' })).length, 2,
    'фільтр дат зрізав область або область зрізала фільтр');
  assert.strictEqual((await events.listBookings(oneProperty(fx.a.id), { from: '2026-10-13' })).length, 0,
    'події обʼєкта Б знайшлися в області обʼєкта А');

  // Обʼєкт сусіда, названий нашою організацією, не віддає нічого.
  assert.strictEqual((await events.listSpaces(oneProperty(neighbour.propertyId))).length, 0,
    'зал сусіда знайшовся в нашій організації');
  assert.strictEqual((await events.listBookings(oneProperty(neighbour.propertyId))).length, 0,
    'подія сусіда знайшлася в нашій організації');
});

// Вісь орендаря з другого боку: сусід бачить рівно своє.
await runWithOrganization(neighbour.organizationId, async () => {
  assert.strictEqual((await events.listSpaces(ALL_PROPERTIES)).length, 1, 'сусід побачив не свій зал');
  assert.strictEqual((await events.listAddons(ALL_PROPERTIES)).length, 1, 'сусід побачив не своє доповнення');
  assert.strictEqual((await events.listBookings(ALL_PROPERTIES)).length, 1, 'сусід побачив не свою подію');
});

console.log('  ok  зали 2/3/5, доповнення 1/2/3, події 2/4/6; чужий орендар — нуль');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('events.scope: усі перевірки пройдено');
