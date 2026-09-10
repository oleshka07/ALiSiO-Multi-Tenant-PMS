/**
 * Банер тривог і борд прибирання — про ОДИН будинок.
 *
 *   node src/modules/dashboard/api/alerts.scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * Усі шість запитів `getAlerts` фільтрувались `OWN()` — це вісь ОРЕНДАРЯ
 * («усі обʼєкти цього рахунку»). Банер висить над робочим столом зміни, а
 * зміна працює в одному будинку: рецепція першого готелю бачила незаселені
 * заїзди другого і йшла їх шукати.
 *
 * ── Що НЕ переводиться, і чому ──────────────────────────────────────────
 *
 * Два перші запити — читання кандидатів на авто-архів і сам `UPDATE`, який
 * ставить `no_show`. Вони лишаються по ВСЬОМУ рахунку свідомо: це не показ, а
 * прибирання, і воно чіпляється до читання тривог, бо іншого регулярного
 * виклику в нього немає. Звузивши його до області, ми зробили б архівацію
 * другого будинку залежною від того, чи хтось відкрив дашборд із ним у шапці.
 * Сцена нижче це стверджує числом, а не покладається на коментар.
 *
 * ── Числа ───────────────────────────────────────────────────────────────
 *
 * Прострочені заїзди: 1 в А, 2 в Б (сума 3). Виїзди сьогодні: 2 в А, 1 в Б.
 * Брудні номери борду: 2 в А, 4 в Б (сума 6). Жодна сума не дорівнює жодному
 * доданку (інваріант 26, друга половина).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-alerts-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { todayFor, shiftDays } = await import('@core/hotel-day.ts');
const { getAlerts } = await import('./alerts.handlers.ts');
const { housekeepingBoard: rawBoard, cleaningHistory: rawHistory } = await import('@properties/kernel.ts');
const { housekeepingSummary: rawSummary } = await import('@properties/index.ts');
/**
 * Читачі прибирання — під орендарем, якого їм передали першим аргументом.
 * Сцена кличе їх у тілі модуля, а на Postgres під `alisio_app` без контексту
 * політика віддає порожнє: «борд обʼєкта А мав дати 5 номерів, отримали 0».
 */
const underTenant = <F extends (org: string, ...rest: never[]) => unknown>(fn: F): F =>
  ((org: string, ...rest: never[]) => runWithOrganization(org, () => fn(org, ...rest))) as F;
const housekeepingBoard = underTenant(rawBoard);
const cleaningHistory = underTenant(rawHistory);
const housekeepingSummary = underTenant(rawSummary);

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


await inTheirs(() => sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
  ['n_guest', neighbour.organizationId, 'N', 'N']));

const today = await todayFor(fx.organizationId);
const yesterday = shiftDays(today, -1);
const twoDaysAgo = shiftDays(today, -2);
const longAgo = shiftDays(today, -30);

const stay = async (id: string, organizationId: string, propertyId: string, unitId: string,
  guestId: string, checkIn: string, checkOut: string, status: string) =>
  forOrg(organizationId, () => sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id,
                               check_in, check_out, nights, adults, status, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 2, ?, (SELECT default_currency FROM organizations WHERE id = ?))`,
    [id, organizationId, propertyId, unitId, guestId, checkIn, checkOut, status, organizationId],
  ));

// Прострочені заїзди (confirmed, заїзд у минулому, але не старіші за тиждень):
// А — один, Б — двоє.
await stay('ov_a1', fx.organizationId, fx.a.id, fx.a.unitIds[0], '__two_props__guest', yesterday, today, 'confirmed');
await stay('ov_b1', fx.organizationId, fx.b.id, fx.b.unitIds[0], '__two_props__guest', yesterday, today, 'confirmed');
await stay('ov_b2', fx.organizationId, fx.b.id, fx.b.unitIds[1], '__two_props__guest', twoDaysAgo, today, 'confirmed');
// Сусід — свій прострочений заїзд: без осі орендаря твердження порожнє.
await stay('ov_n1', neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0], 'n_guest', yesterday, today, 'confirmed');

// Виїзди сьогодні (checked_in): А — двоє, Б — один.
await stay('dep_a1', fx.organizationId, fx.a.id, fx.a.unitIds[2], '__two_props__guest', twoDaysAgo, today, 'checked_in');
await stay('dep_a2', fx.organizationId, fx.a.id, fx.a.unitIds[3], '__two_props__guest', twoDaysAgo, today, 'checked_in');
await stay('dep_b1', fx.organizationId, fx.b.id, fx.b.unitIds[2], '__two_props__guest', twoDaysAgo, today, 'checked_in');

// Кандидати на авто-архів — старші за тиждень, по одному в кожному будинку.
await stay('old_a', fx.organizationId, fx.a.id, fx.a.unitIds[4], '__two_props__guest', longAgo, shiftDays(longAgo, 1), 'confirmed');
await stay('old_b', fx.organizationId, fx.b.id, fx.b.unitIds[3], '__two_props__guest', longAgo, shiftDays(longAgo, 1), 'confirmed');

const actor = { organizationId: fx.organizationId, user: { permissions: [] } } as never;
const req = (query: string) => new Request(`https://alisio.test/api/dashboard/alerts${query}`);
const alertsOf = async (query: string) => {
  const res = await getAlerts(req(query), null, actor);
  return await (res as unknown as Response).json() as { type: string; bookingId: string }[];
};

await runWithOrganization(fx.organizationId, async () => {
  const inA = await alertsOf(`?property_id=${fx.a.id}`);
  const overdueA = inA.filter((a) => a.type === 'overdue_arrival');
  assert.strictEqual(overdueA.length, 1,
    `очікували 1 прострочений заїзд обʼєкта А, отримали ${overdueA.length}`);
  assert.strictEqual(overdueA[0].bookingId, 'ov_a1', 'у банері А чужий заїзд');

  const inB = await alertsOf(`?property_id=${fx.b.id}`);
  assert.strictEqual(inB.filter((a) => a.type === 'overdue_arrival').length, 2,
    'обʼєкт Б мав дати два прострочені заїзди');

  const all = await alertsOf('?property_id=');
  assert.strictEqual(all.filter((a) => a.type === 'overdue_arrival').length, 3,
    '«усі обʼєкти» мали дати три — і жодного чужого орендаря');

  // Виїзди — інша сцена і інші числа, щоб «вісь працює» не трималось на
  // одному запиті з шести.
  assert.strictEqual(inA.filter((a) => a.type === 'today_departure').length, 2,
    'виїзди обʼєкта А');
  assert.strictEqual(inB.filter((a) => a.type === 'today_departure').length, 1,
    'виїзди обʼєкта Б');
});

// Авто-архів свідомо НЕ звужений областю: після виклику з областю обʼєкта А
// давня бронь обʼєкта Б теж мусить бути заархівована. Інакше архівація
// другого будинку залежала б від того, з яким обʼєктом у шапці відкрили
// дашборд, і не сталася б ніколи.
const archived = await inOurs(() => sql.rows<{ id: string }>(
  "SELECT id FROM reservations WHERE status = 'no_show' AND organization_id = ? ORDER BY id",
  [fx.organizationId]));
assert.deepStrictEqual(archived.map((r) => r.id), ['old_a', 'old_b'],
  'авто-архів звузився областю — тоді давні броні сусіднього будинку не архівуються ніколи');
// І не переліз через межу орендаря.
assert.strictEqual(
  (await inTheirs(() => sql.rows("SELECT id FROM reservations WHERE status = 'no_show' AND organization_id = ?",
    [neighbour.organizationId]))).length, 0,
  'авто-архів дістав чужого орендаря');

console.log('  ok  тривоги: прострочені 1/2/3, виїзди 2/1; авто-архів лишився по рахунку');

// ─── Борд прибирання і його лічильники ──────────────────────────────────────
// `UPDATE` без контексту на Postgres не падає — він мовчки чіпає НУЛЬ рядків
// (політика просто не бачить, що оновлювати). Тому кожне оновлення тут теж під
// орендарем свого рахунку: інакше сцена стверджувала б про брудні номери,
// яких ніхто не забруднив.
const dirty = (org: string, id: string) =>
  runWithOrganization(org, () => sql.run("UPDATE units SET cleaning_status = 'dirty' WHERE id = ?", [id]));
for (const id of fx.a.unitIds.slice(0, 2)) await dirty(fx.organizationId, id);
for (const id of fx.b.unitIds.slice(0, 4)) await dirty(fx.organizationId, id);
for (const id of neighbour.unitIds.slice(0, 3)) await dirty(neighbour.organizationId, id);

const boardA = await housekeepingBoard(fx.organizationId, oneProperty(fx.a.id));
assert.strictEqual(boardA.units.length, 5, `борд обʼєкта А мав дати 5 номерів, отримали ${boardA.units.length}`);
assert.strictEqual((await housekeepingBoard(fx.organizationId, oneProperty(fx.b.id))).units.length, 7,
  'борд обʼєкта Б мав дати 7 номерів');
assert.strictEqual((await housekeepingBoard(fx.organizationId, ALL_PROPERTIES)).units.length, 12,
  '«усі обʼєкти» мали дати 12 і жодного чужого орендаря');

assert.strictEqual((await housekeepingSummary(fx.organizationId, oneProperty(fx.a.id))).dirty, 2,
  'лічильник брудних обʼєкта А');
assert.strictEqual((await housekeepingSummary(fx.organizationId, oneProperty(fx.b.id))).dirty, 4,
  'лічильник брудних обʼєкта Б');
assert.strictEqual((await housekeepingSummary(fx.organizationId, ALL_PROPERTIES)).dirty, 6,
  'лічильник брудних по рахунку');

assert.strictEqual((await housekeepingBoard(neighbour.organizationId, ALL_PROPERTIES)).units.length, 4,
  'сусід побачив не свій борд');
assert.strictEqual((await housekeepingBoard(fx.organizationId, oneProperty(neighbour.propertyId))).units.length, 0,
  'обʼєкт сусіда, названий нашою організацією, віддав номери');

assert.strictEqual((await cleaningHistory(fx.organizationId, { scope: ALL_PROPERTIES })).length, 0,
  'журнал прибирання порожній — записів ще не робили');

console.log('  ok  борд 5/7/12, брудні 2/4/6; чужий орендар — нуль');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('alerts.scope: усі перевірки пройдено');
