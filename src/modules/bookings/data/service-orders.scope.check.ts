/**
 * Замовлення послуг на день — про ОДИН будинок, обома шляхами.
 *
 *   node src/modules/bookings/data/service-orders.scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * Екран замовлень (сауна, сніданки, трансфери на сьогодні) фільтрувався лише
 * орендарем. Готель із двома будинками бачив в одному списку замовлення обох —
 * разом з іменами гостей і номерами кімнат, — і персонал зміни йшов виконувати
 * чуже. Шлях до орендаря тут ДВА, і вісь обʼєкта теж мусить іти двома:
 * віджетне замовлення може не мати броні взагалі (заходень купує сауну без
 * проживання), тож його будинок — це будинок ПОСЛУГИ; гостьове завжди висить
 * на броні, і будинок береться від неї.
 *
 * ── Вісь, якої тут легко не помітити ────────────────────────────────────
 *
 * Якби обидва запити взяли якір від броні, віджетне замовлення без броні
 * зникло б зі списку — тихо, бо `LEFT JOIN` перетворився б на обмеження. Тому
 * в фікстурі Є таке замовлення (`w_a2`, без `reservation_id`), і воно
 * враховане в числі: 2 в А, а не 1.
 *
 * ── Числа ───────────────────────────────────────────────────────────────
 *
 * Віджетні: 2 в А, 3 в Б (сума 5). Гостьові: 1 в А, 2 в Б (сума 3). Набори
 * різні навмисно — інакше «переплутав два списки» було б зеленим; жодна сума
 * не дорівнює жодному доданку (§26).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-service-orders-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { widgetServiceOrdersOf, guestServiceOrdersOf } = await import('./service-orders.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

/** Засів — під орендарем того рахунку, якому рядок належить (див. lists.scope). */
const inOurs = <T>(fn: () => Promise<T>) => runWithOrganization(fx.organizationId, fn);
const inTheirs = <T>(fn: () => Promise<T>) => runWithOrganization(neighbour.organizationId, fn);
const forProperty = <T>(propertyId: string, fn: () => Promise<T>) =>
  (propertyId === neighbour.propertyId ? inTheirs(fn) : inOurs(fn));
const forOrg = <T>(organizationId: string, fn: () => Promise<T>) =>
  runWithOrganization(organizationId, fn);


const DAY = '2026-12-01';
const win = { period: 'day', dateParam: DAY, dateTo: DAY };

const service = async (id: string, propertyId: string) => forProperty(propertyId, () => sql.run(
  'INSERT INTO additional_services (id, property_id, name, price) VALUES (?, ?, ?, 100)',
  [id, propertyId, id]));
await service('sv_a', fx.a.id);
await service('sv_b', fx.b.id);
await service('sv_n', neighbour.propertyId);

const guest = async (id: string, organizationId: string) => forOrg(organizationId, () => sql.run(
  'INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
  [id, organizationId, 'G', id]));
await guest('so_guest', fx.organizationId);
await guest('so_guest_n', neighbour.organizationId);

const stay = async (id: string, organizationId: string, propertyId: string, unitId: string, guestId: string) =>
  forOrg(organizationId, () => sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                               check_in, check_out, nights, adults, currency)
     VALUES (?, ?, ?, ?, ?, ?, '2026-12-03', 2, 2,
             (SELECT default_currency FROM organizations WHERE id = ?))`,
    [id, organizationId, propertyId, unitId, guestId, DAY, organizationId]));
await stay('so_r_a', fx.organizationId, fx.a.id, fx.a.unitIds[0], 'so_guest');
await stay('so_r_b', fx.organizationId, fx.b.id, fx.b.unitIds[0], 'so_guest');
await stay('so_r_n', neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0], 'so_guest_n');

/** Віджетне: якір — ПОСЛУГА, броні може не бути взагалі. */
const widget = async (id: string, serviceId: string, reservationId: string | null) =>
  forProperty(serviceId === 'sv_n' ? neighbour.propertyId : fx.a.id, () => sql.run(
  `INSERT INTO booking_service_orders (id, service_id, reservation_id, service_date,
                                       quantity, unit_price, total_price, status, payment_status)
   VALUES (?, ?, ?, ?, 1, 100, 100, 'pending', 'paid')`,
  [id, serviceId, reservationId, DAY]));
/** Гостьове: якір — БРОНЬ, вона є завжди. */
const fromGuestPage = async (id: string, serviceId: string, reservationId: string) =>
  forProperty(serviceId === 'sv_n' ? neighbour.propertyId : fx.a.id, () => sql.run(
  `INSERT INTO service_orders (id, reservation_id, service_id, service_date,
                               quantity, total_price, status, payment_status)
   VALUES (?, ?, ?, ?, 1, 100, 'pending', 'paid')`,
  [id, reservationId, serviceId, DAY]));

// Віджетні 2/3, і одне з двох в А — БЕЗ броні (той самий заходень).
await widget('w_a1', 'sv_a', 'so_r_a');
await widget('w_a2', 'sv_a', null);
await widget('w_b1', 'sv_b', 'so_r_b');
await widget('w_b2', 'sv_b', null);
await widget('w_b3', 'sv_b', 'so_r_b');
await widget('w_n1', 'sv_n', 'so_r_n');
// Гостьові 1/2 — інші числа, ніж у віджетних.
await fromGuestPage('g_a1', 'sv_a', 'so_r_a');
await fromGuestPage('g_b1', 'sv_b', 'so_r_b');
await fromGuestPage('g_b2', 'sv_b', 'so_r_b');
await fromGuestPage('g_n1', 'sv_n', 'so_r_n');

await runWithOrganization(fx.organizationId, async () => {
  const org = fx.organizationId;

  // ─── Віджетні ────────────────────────────────────────────────────────────
  const wA = await widgetServiceOrdersOf(org, oneProperty(fx.a.id), win);
  assert.strictEqual(wA.length, 2, `очікували 2 віджетні замовлення обʼєкта А, отримали ${wA.length}`);
  // Друге з двох — БЕЗ броні. Якби якір узяли від броні, воно зникло б тихо.
  assert.ok(wA.some((o) => o.id === 'w_a2'),
    'замовлення без броні зникло — якір узято від броні, а не від послуги');

  assert.strictEqual((await widgetServiceOrdersOf(org, oneProperty(fx.b.id), win)).length, 3,
    'очікували 3 віджетні замовлення обʼєкта Б');
  assert.strictEqual((await widgetServiceOrdersOf(org, ALL_PROPERTIES, win)).length, 5,
    '«усі обʼєкти» мали дати 5 віджетних і жодного чужого орендаря');

  // ─── Гостьові ────────────────────────────────────────────────────────────
  assert.strictEqual((await guestServiceOrdersOf(org, oneProperty(fx.a.id), win)).length, 1,
    'очікували 1 гостьове замовлення обʼєкта А');
  assert.strictEqual((await guestServiceOrdersOf(org, oneProperty(fx.b.id), win)).length, 2,
    'очікували 2 гостьові замовлення обʼєкта Б');
  assert.strictEqual((await guestServiceOrdersOf(org, ALL_PROPERTIES, win)).length, 3,
    '«усі обʼєкти» мали дати 3 гостьові');

  // ─── Чужий обʼєкт нашою організацією — нуль обома шляхами ────────────────
  const foreign = oneProperty(neighbour.propertyId);
  assert.strictEqual((await widgetServiceOrdersOf(org, foreign, win)).length, 0,
    'віджетне замовлення сусіда видно нашим рахунком');
  assert.strictEqual((await guestServiceOrdersOf(org, foreign, win)).length, 0,
    'гостьове замовлення сусіда видно нашим рахунком');
});

// Вісь орендаря з другого боку — по одному своєму кожним шляхом.
await runWithOrganization(neighbour.organizationId, async () => {
  const n = neighbour.organizationId;
  assert.strictEqual((await widgetServiceOrdersOf(n, ALL_PROPERTIES, win)).length, 1,
    'сусід побачив не своє віджетне замовлення');
  assert.strictEqual((await guestServiceOrdersOf(n, ALL_PROPERTIES, win)).length, 1,
    'сусід побачив не своє гостьове замовлення');
});

console.log('  ok  віджетні 2/3/5 (одне без броні), гостьові 1/2/3; чужий орендар — по одному своєму');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('service-orders.scope: два шляхи, дві осі, одна відповідь');
