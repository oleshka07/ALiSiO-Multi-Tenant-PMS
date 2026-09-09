/**
 * Сайти бронювання — про ОДИН будинок. Пошук — по рахунку, але НАЗИВАЄ будинок.
 *
 *   node src/modules/bookings/data/sites-and-search.scope.check.ts
 *
 * ── Дві різні відповіді на одне питання, і обидві правильні ─────────────
 *
 * Не кожен читач мусить звузитись. Різницю робить те, ЩО людина робить із
 * відповіддю.
 *
 * **Список сайтів** їде у випадний список джерел форми броні. Рецепція будинку
 * А бачила там сайти будинку Б і могла приписати бронь чужому сайту — а
 * джерело це комісія, звітність і атрибуція. Тут відповідь одна: звузити.
 *
 * **Пошук** — навпаки. Портьє набирає прізвище, і бронь може бути в іншому
 * будинку; звузити означало б «не знайдено» на річ, яка є. Тому пошук
 * лишається по рахунку — але тоді він ЗОБОВʼЯЗАНИЙ сказати, який це будинок.
 * Саме цю умову я поставила для `searchUnits`, і `searchBookings` її не
 * виконував: у підказці стояли код каналу і номер кімнати, будинку не було.
 * Два однойменні гості в двох будинках давали два однакові рядки.
 *
 * ── Числа ───────────────────────────────────────────────────────────────
 *
 * Сайти: 2 в А, 3 в Б (сума 5) — жодна сума не дорівнює доданку (§26). Плюс
 * один ВИДАЛЕНИЙ сайт у Б, щоб `status != 'deleted'` лишалось живим
 * твердженням, а не збігом.
 *
 * Пошук: один гість «Новак» у КОЖНОМУ будинку — гість і дати однакові, тож
 * рядки різняться рівно тим, про що твердження, і нічим іншим. І друге
 * значення тієї ж осі: у сусіда будинок ОДИН, і тоді назва не додається — без
 * цієї пари «називає завжди» і «називає, коли це щось розрізняє» були б
 * нерозрізненні.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-sites-search-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { widgetSiteSourcesOf } = await import('./lists.repo.ts');
const { searchBookings } = await import('./booking-search.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

const site = async (id: string, propertyId: string) => sql.run(
  `INSERT INTO booking_sites (id, organization_id, property_id, name, slug, status)
   VALUES (?, (SELECT organization_id FROM properties WHERE id = ?), ?, ?, ?, 'active')`,
  [id, propertyId, propertyId, id, id]);

// Сайти 2/3 — і один видалений у Б, щоб «status != deleted» лишалось живим
// твердженням, а не збігом.
await site('site_a1', fx.a.id);
await site('site_a2', fx.a.id);
await site('site_b1', fx.b.id);
await site('site_b2', fx.b.id);
await site('site_b3', fx.b.id);
await site('site_n1', neighbour.propertyId);
await sql.run(
  `INSERT INTO booking_sites (id, organization_id, property_id, name, slug, status)
   VALUES (?, (SELECT organization_id FROM properties WHERE id = ?), ?, ?, ?, 'deleted')`,
  ['site_b_dead', fx.b.id, fx.b.id, 'site_b_dead', 'site_b_dead']);

// ── Пошук: ОДНЕ прізвище у двох будинках ────────────────────────────────────
const guest = async (id: string, organizationId: string, last: string) => sql.run(
  'INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
  [id, organizationId, 'Ева', last]);
await guest('g_a', fx.organizationId, 'Новак');
await guest('g_b', fx.organizationId, 'Новак');
await guest('g_n', neighbour.organizationId, 'Новак');

const stay = async (id: string, organizationId: string, propertyId: string, unitId: string, guestId: string) =>
  sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                               check_in, check_out, nights, adults, currency)
     VALUES (?, ?, ?, ?, ?, '2026-12-01', '2026-12-02', 1, 2,
             (SELECT default_currency FROM organizations WHERE id = ?))`,
    [id, organizationId, propertyId, unitId, guestId, organizationId]);
await stay('srch_a', fx.organizationId, fx.a.id, fx.a.unitIds[0], 'g_a');
await stay('srch_b', fx.organizationId, fx.b.id, fx.b.unitIds[0], 'g_b');
await stay('srch_n', neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0], 'g_n');

await runWithOrganization(fx.organizationId, async () => {
  const org = fx.organizationId;

  // ─── Сайти: звужуються ───────────────────────────────────────────────────
  assert.strictEqual((await widgetSiteSourcesOf(org, oneProperty(fx.a.id))).length, 2,
    'очікували 2 сайти обʼєкта А');
  assert.strictEqual((await widgetSiteSourcesOf(org, oneProperty(fx.b.id))).length, 3,
    'очікували 3 сайти обʼєкта Б — видалений не рахується');
  assert.strictEqual((await widgetSiteSourcesOf(org, ALL_PROPERTIES)).length, 5,
    '«усі обʼєкти» мали дати 5 сайтів і жодного чужого орендаря');
  assert.strictEqual((await widgetSiteSourcesOf(org, oneProperty(neighbour.propertyId))).length, 0,
    'сайт сусіда видно нашим рахунком');

  // ─── Пошук: НЕ звужується, але називає будинок ───────────────────────────
  const hits = await searchBookings('Новак', org);
  assert.strictEqual(hits.length, 2,
    `пошук мав знайти обидві броні рахунку, знайшов ${hits.length}`);

  // Головне твердження — саме перше: будинок НАЗВАНО. Друге (підказки різні)
  // слабше, і це чесно сказати: коди кімнат у фікстурі різні (`A1-1`/`B1-1`),
  // тож рядки розрізнялись би й без назви будинку. Вагу несе перше — портьє
  // мусить бачити, ЯКИЙ це будинок, а не лише що рядки не однакові.
  const said = hits.map((h) => String(h.subtitle ?? ''));
  assert.ok(said.every((sub) => sub.includes(fx.a.name) || sub.includes(fx.b.name)),
    `підказка пошуку не називає будинок: ${JSON.stringify(said)}`);
  assert.strictEqual(new Set(said).size, 2,
    `дві броні різних будинків дали однакові підказки: ${JSON.stringify(said)}`);
  assert.ok(said.some((s) => s.includes(fx.a.name)) && said.some((s) => s.includes(fx.b.name)),
    'у підказках названо не обидва будинки');
});

// Вісь орендаря з другого боку — і ДРУГЕ значення осі «чи розрізняє будинок».
//
// У сусіда один будинок, тож називати його в кожному рядку було б шумом. Це не
// приємна дрібниця, а друга половина твердження: без цієї пари «називає
// будинок завжди» і «називає, коли це щось розрізняє» були б нерозрізненні
// (§26).
await runWithOrganization(neighbour.organizationId, async () => {
  assert.strictEqual((await widgetSiteSourcesOf(neighbour.organizationId, ALL_PROPERTIES)).length, 1,
    'сусід побачив не свій сайт');
  const one = await searchBookings('Новак', neighbour.organizationId);
  assert.strictEqual(one.length, 1, 'сусід знайшов не свою бронь');
  const neighbourName = String((await sql.row<{ name: string }>(
    'SELECT name FROM properties WHERE id = ?', [neighbour.propertyId]))?.name ?? '');
  assert.ok(neighbourName.length > 0, 'не прочитали назву обʼєкта сусіда — твердження було б порожнім');
  assert.ok(!String(one[0].subtitle ?? '').includes(neighbourName),
    `готель з одним будинком не має бачити його назву в кожному рядку: ${one[0].subtitle}`);
});

console.log('  ok  сайти 2/3/5 (видалений не рахується); пошук 2 по рахунку і КОЖЕН рядок називає будинок');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('sites-and-search.scope: звузити або назвати — і сказано, що саме');
