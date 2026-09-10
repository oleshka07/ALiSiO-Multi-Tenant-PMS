/**
 * Канал продажу видаляється, коли ЙОГО будинок ним не користується.
 *
 *   node src/modules/bookings/data/source-usage.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * Перед видаленням джерела хендлер рахував броні з таким `source` по ВСЬОМУ
 * рахунку. Але `booking_sources` належить будинку, а `reservations.source` —
 * це код-рядок (`direct`), не посилання: два будинки мають кожен свій рядок з
 * тим самим кодом. Тому «Прямі» будинку А не видалялись, поки будинок Б мав
 * хоч одну пряму бронь, — відмова, причину якої оператор не може усунути, бо
 * причина в чужому будинку.
 *
 * Напрямок помилки безпечний (відмовляє зайве, а не дозволяє), тому це не
 * дірка — це заблокована дія. Ціна названа в інваріанті 29 як «звичайна
 * акуратність», і саме тому воно чекало, поки закінчаться справжні читачі.
 *
 * ── Числа, і вони виміряні, а не вгадані ────────────────────────────────
 *
 * Перша редакція цієї сцени казала «у будинку А жодної `direct`» — і була
 * неправа: `reservations.source` має `DEFAULT 'direct'`, а спільна фікстура
 * сіє 2 броні в А і 3 в Б, тобто вони всі прямі. Числа нижче взяті з бази,
 * а не з голови.
 *
 * Три пари, кожна про своє:
 *
 *   `ota_zeta` — код є в ОБОХ будинках, ужитий лише в Б (3 броні). Відповідь
 *     для А — **0** (видаляти можна), стара давала **3** (відмова). Це САМ
 *     дефект, і нуль проти трьох арифметично несумісні.
 *   `direct` — код у обох, ужитий у обох: А = 2, Б = 6. Тут стара редакція
 *     давала обом **8**, тобто число, якого не має жоден будинок окремо.
 *   `web` — лише в А, ужитий двічі: відповідь 2, тобто варта не перестала
 *     вартувати, коли її звузили.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-source-usage-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { sourceUsageCount } = await import('./source-usage.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

// `booking_sources` НЕ має `organization_id`: до орендаря — лише через будинок.
const source = async (id: string, propertyId: string, code: string) => sql.run(
  'INSERT INTO booking_sources (id, property_id, name, code) VALUES (?, ?, ?, ?)',
  [id, propertyId, code, code]);
await source('bs_a_direct', fx.a.id, 'direct');
await source('bs_b_direct', fx.b.id, 'direct');   // ТОЙ САМИЙ код у другому будинку
await source('bs_a_zeta', fx.a.id, 'ota_zeta');   // і ще один такий самий, ужитий лише в Б
await source('bs_b_zeta', fx.b.id, 'ota_zeta');
await source('bs_a_web', fx.a.id, 'web');
await source('bs_n_direct', neighbour.propertyId, 'direct');

await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
  ['su_guest', fx.organizationId, 'S', 'U']);
await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
  ['su_guest_n', neighbour.organizationId, 'N', 'N']);

const stay = async (id: string, organizationId: string, propertyId: string, unitId: string,
  guestId: string, src: string) =>
  sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, source,
                               check_in, check_out, nights, adults, currency)
     VALUES (?, ?, ?, ?, ?, ?, '2026-12-01', '2026-12-02', 1, 2,
             (SELECT default_currency FROM organizations WHERE id = ?))`,
    [id, organizationId, propertyId, unitId, guestId, src, organizationId]);

// Фікстура вже дала 2 прямі броні в А і 3 в Б (DEFAULT 'direct'). Додаємо:
// три `ota_zeta` у Б і жодної в А; дві `web` у А; три `direct` у Б.
for (const i of [0, 1, 2]) {
  await stay(`su_b_z${i}`, fx.organizationId, fx.b.id, fx.b.unitIds[i], 'su_guest', 'ota_zeta');
  await stay(`su_b_d${i}`, fx.organizationId, fx.b.id, fx.b.unitIds[i], 'su_guest', 'direct');
}
await stay('su_a_web1', fx.organizationId, fx.a.id, fx.a.unitIds[0], 'su_guest', 'web');
await stay('su_a_web2', fx.organizationId, fx.a.id, fx.a.unitIds[1], 'su_guest', 'web');
await stay('su_n_d1', neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0],
  'su_guest_n', 'direct');

await runWithOrganization(fx.organizationId, async () => {
  const org = fx.organizationId;

  // ── САМ ДЕФЕКТ: нуль проти трьох ─────────────────────────────────────────
  //
  // `ota_zeta` заведено в обох будинках, але користується ним лише Б. Джерело
  // будинку А не використовує ніхто, тож воно видаляється. Стара редакція
  // бачила три броні будинку Б і відмовляла — оператору будинку А, за броні,
  // яких він не бачить і на які не впливає.
  assert.strictEqual(await sourceUsageCount(org, fx.a.id, 'ota_zeta'), 0,
    'канал «ota_zeta» будинку А не використовує жодна його бронь — видалення мало бути дозволене');
  assert.strictEqual(await sourceUsageCount(org, fx.b.id, 'ota_zeta'), 3,
    'канал «ota_zeta» будинку Б використовують три його броні');

  // ── Той самий код, ужитий В ОБОХ: числа різні, і жодне не дорівнює сумі ──
  //
  // 2 і 6 при сумі 8. Стара редакція давала обом будинкам 8 — число, якого не
  // має жоден із них окремо.
  assert.strictEqual(await sourceUsageCount(org, fx.a.id, 'direct'), 2,
    'прямих броней будинку А — дві (їх сіє сама фікстура)');
  assert.strictEqual(await sourceUsageCount(org, fx.b.id, 'direct'), 6,
    'прямих броней будинку Б — шість: три від фікстури і три додані тут');

  // ── Варта не перестала вартувати ─────────────────────────────────────────
  assert.strictEqual(await sourceUsageCount(org, fx.a.id, 'web'), 2,
    'канал «web» будинку А використовують дві броні — видалення має бути відмовлене');
  assert.strictEqual(await sourceUsageCount(org, fx.b.id, 'web'), 0,
    'у будинку Б каналу «web» немає, і його броні тут ні до чого');

  // ── Межа орендаря лишилась на місці ──────────────────────────────────────
  assert.strictEqual(await sourceUsageCount(org, neighbour.propertyId, 'direct'), 0,
    'бронь сусіда порахована нашим рахунком');
});

// Той самий код у сусіда — його власна одиниця, і вона не наша.
await runWithOrganization(neighbour.organizationId, async () => {
  assert.strictEqual(await sourceUsageCount(neighbour.organizationId, neighbour.propertyId, 'direct'), 1,
    'сусід мав побачити свою одну пряму бронь');
});

console.log('  ok  ota_zeta А = 0 (видаляється), Б = 3; direct 2 і 6 при сумі 8; web А = 2; сусід — своя одна');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('source-usage: лічильник рахує броні ТОГО будинку, чиє джерело видаляють');
