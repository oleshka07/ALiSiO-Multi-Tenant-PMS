/**
 * Аркуші дня — аркуш ОДНОГО будинку, не рахунку.
 *
 *   node src/modules/day-sheets/data/day-sheets.scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * «У домі», «сніданок» і «ключі» фільтрувались лише `r.organization_id`.
 * Це аркуш, який рецепція друкує на початку зміни: у готелі з двома
 * будинками він зводив в один папір гостей обох — і кухня другого готувала
 * сніданки на чужу кількість, а ключі видавали на номери, яких у цьому
 * будинку немає.
 *
 * Ціна помилки тут вища за список у налаштуваннях: аркуш іде в роботу, а не
 * на екран (AGENTS інваріант 29 — межа проходить по даних).
 *
 * ── Числа ───────────────────────────────────────────────────────────────
 *
 * У домі 2 і 3 (сума 5), заїзд/виїзд 1 і 2 (сума 3). Жодна сума не дорівнює
 * жодному доданку — інакше «забув вісь» не відрізнити від «урахував»
 * (інваріант 26, друга половина). Сусідня організація має свого гостя в домі
 * того самого дня: твердження про вісь обʼєкта без осі орендаря порожнє.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-daysheets-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { houseList, breakfastList, keyList } = await import('./day-sheets.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

const DAY = '2026-11-10';

/** Гість сусідньої організації — інакше вісь орендаря не доведена. */
await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
  ['n_guest', neighbour.organizationId, 'N', 'N']);

/**
 * Проживання на добу `DAY`. Прямим SQL: репозиторій — це те, що перевіряють,
 * а засів через нього доводив би сам себе. `organization_id` названо явно
 * (інваріант 12), валюту — підзапитом від організації.
 */
const stay = async (id: string, organizationId: string, propertyId: string, unitId: string,
  guestId: string, checkIn: string, checkOut: string) =>
  sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                               check_in, check_out, nights, adults, status, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, 2, 2, 'confirmed',
             (SELECT default_currency FROM organizations WHERE id = ?))`,
    [id, organizationId, propertyId, unitId, guestId, checkIn, checkOut, organizationId],
  );

// У домі 10-го: А — двоє, Б — троє. Заїжджає 10-го: А — один, Б — двоє.
await stay('h_a1', fx.organizationId, fx.a.id, fx.a.unitIds[0], '__two_props__guest', '2026-11-09', '2026-11-12');
await stay('h_a2', fx.organizationId, fx.a.id, fx.a.unitIds[1], '__two_props__guest', DAY, '2026-11-12');
await stay('h_b1', fx.organizationId, fx.b.id, fx.b.unitIds[0], '__two_props__guest', '2026-11-08', '2026-11-12');
await stay('h_b2', fx.organizationId, fx.b.id, fx.b.unitIds[1], '__two_props__guest', DAY, '2026-11-12');
await stay('h_b3', fx.organizationId, fx.b.id, fx.b.unitIds[2], '__two_props__guest', DAY, '2026-11-12');
await stay('h_n1', neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0], 'n_guest', '2026-11-09', '2026-11-12');

await runWithOrganization(fx.organizationId, async () => {
  // ─── У домі ──────────────────────────────────────────────────────────────
  const houseA = await houseList(DAY, oneProperty(fx.a.id));
  assert.strictEqual(houseA.length, 2, `очікували 2 проживання обʼєкта А, отримали ${houseA.length}`);
  assert.deepStrictEqual(houseA.map((r) => r.reservation_id).sort(), ['h_a1', 'h_a2'],
    'в аркуші А опинились чужі проживання');

  const houseB = await houseList(DAY, oneProperty(fx.b.id));
  assert.strictEqual(houseB.length, 3, `очікували 3 проживання обʼєкта Б, отримали ${houseB.length}`);

  assert.strictEqual((await houseList(DAY, ALL_PROPERTIES)).length, 5,
    '«усі обʼєкти» мали дати 5 — і жодного чужого орендаря');

  // ─── Сніданок ────────────────────────────────────────────────────────────
  //
  // Та сама вибірка, інша межа доби: сніданок їдять уранці, тож заїзд СЬОГОДНІ
  // ще не снідає. Тому числа інші — і саме тому вісь перевіряється окремо.
  assert.strictEqual((await breakfastList(DAY, oneProperty(fx.a.id))).length, 1,
    'на сніданок обʼєкта А мав лишитись один — той, хто ночував');
  assert.strictEqual((await breakfastList(DAY, oneProperty(fx.b.id))).length, 1,
    'на сніданок обʼєкта Б мав лишитись один');
  assert.strictEqual((await breakfastList(DAY, ALL_PROPERTIES)).length, 2,
    '«усі обʼєкти» мали дати двох снідальників');

  // ─── Ключі ───────────────────────────────────────────────────────────────
  const keysA = await keyList(DAY, oneProperty(fx.a.id));
  assert.strictEqual(keysA.length, 1, `очікували 1 рух ключа в А, отримали ${keysA.length}`);
  assert.strictEqual(keysA[0].reservation_id, 'h_a2', 'в аркуші ключів А чужий рядок');

  assert.strictEqual((await keyList(DAY, oneProperty(fx.b.id))).length, 2,
    'обʼєкт Б мав дати два рухи ключа');
  assert.strictEqual((await keyList(DAY, ALL_PROPERTIES)).length, 3,
    '«усі обʼєкти» мали дати три рухи ключа');

  // Обʼєкт сусіда, названий нашою організацією, не віддає нічого.
  assert.strictEqual((await houseList(DAY, oneProperty(neighbour.propertyId))).length, 0,
    'проживання сусіда знайшлося в нашій організації');
});

// Вісь орендаря з другого боку.
await runWithOrganization(neighbour.organizationId, async () => {
  assert.strictEqual((await houseList(DAY, ALL_PROPERTIES)).length, 1, 'сусід побачив не своє проживання');
});

console.log('  ok  у домі 2/3/5, сніданок 1/1/2, ключі 1/2/3; чужий орендар — нуль');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('day-sheets.scope: усі перевірки пройдено');
