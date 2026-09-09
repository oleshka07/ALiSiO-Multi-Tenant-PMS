/**
 * Календар віджета показує зайнятість СВОГО обʼєкта (INC-034, друга половина).
 *
 *   node src/app/api/public/availability/availability-scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `/api/public/availability` бере `unit_id` або `unit_type_id` прямо з адреси і
 * до цієї правки не звіряв їх ні з чим, крім орендаря, якого встановлює
 * `withSite`. Тобто віджет, вбудований на сайті будинку А, підставивши в адресу
 * номер будинку Б того самого рахунку, діставав його календар: коли в сусідньому
 * готелі гості, а коли порожньо.
 *
 * Половину того самого шва вже закрито записом (INC-034: сайт обʼєкта А
 * ПРОДАВАВ номер обʼєкта Б). Читання лишалось відкритим — а календар це те, з
 * чого продаж починається, і публічний він за побудовою: жодного логіна, лише
 * ключ сайту в адресі.
 *
 * ── І чому це не лише вісь обʼєкта ──────────────────────────────────────
 *
 * Запити тут не називають ОРЕНДАРЯ взагалі — його тримають політики Postgres.
 * На SQLite політик немає, а SQLite це вся розробка і кожен стенд без Postgres
 * (AGENTS §7). Тому третє твердження нижче питає номер СУСІДНЬОЇ ОРГАНІЗАЦІЇ:
 * до правки воно віддавало її дати, і це вже не «показав чужий будинок свого
 * рахунку», а публічний маршрут, який віддає дані чужої компанії.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Вирішальних осей дві, і фікстура несе обидві: два обʼєкти в одному рахунку
 * (спільна фікстура) і сусідній рахунок поруч.
 *
 * Ночі рознесені числами, які не складаються ні в що знайоме: 3 у себе, 5 у
 * сусіднього будинку, 7 у чужого рахунку. Жодна сума не дорівнює жодному
 * доданку (8, 10, 12, 15), тож «узяв зайве» не сховається за збігом, а
 * повідомлення називає, ЧИЇ саме дати приїхали.
 *
 * Вікно запиту (листопад) навмисно не перетинається з бронями самої фікстури
 * (вересень): тоді число зайнятих дат — це рівно те, що засіяла перевірка, і
 * «3» не треба виводити відніманням.
 *
 * Зустрічна вісь стоїть під кожним «порожньо»: той самий сайт, спитавши СВІЙ
 * номер, отримує свої 3 дати. Без неї «чужих дат немає» було б істинним і на
 * маршруті, який завжди віддає порожньо.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-availability-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { GET } = await import('./route.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const NIGHTS_A = 3;
const NIGHTS_B = 5;
const NIGHTS_NEIGHBOUR = 7;

const WINDOW_FROM = '2026-11-01';
const WINDOW_TO = '2026-12-01';

/** Бронь на `nights` ночей від `day` листопада — щоб число ночей було видно очима. */
const stay = async (
  id: string, organizationId: string, propertyId: string, unitId: string,
  unitTypeId: string, guestId: string, day: number, nights: number,
) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  await sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, unit_type_id, guest_id,
                               check_in, check_out, nights, adults, total_price, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, 1000, 'confirmed')`,
    [id, organizationId, propertyId, unitId, unitTypeId, guestId,
      `2026-11-${pad(day)}`, `2026-11-${pad(day + nights)}`, nights],
  );
};

await runWithOrganization(fx.organizationId, async () => {
  // Сайт бронювання на КОЖНОМУ обʼєкті: без другого сайту твердження «сайт А
  // не бачить Б» не має пари й нічого не розрізняє.
  for (const [slug, propertyId] of [
    ['__avail__site_a', fx.a.id], ['__avail__site_b', fx.b.id],
  ] as const) {
    await sql.run(
      `INSERT INTO booking_sites (id, organization_id, property_id, name, slug, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [slug, fx.organizationId, propertyId, `Site ${propertyId}`, slug]);
  }

  await stay('__avail__res_a', fx.organizationId, fx.a.id, fx.a.unitIds[0],
    fx.a.unitTypeIds[0], '__two_props__guest', 5, NIGHTS_A);
  await stay('__avail__res_b', fx.organizationId, fx.b.id, fx.b.unitIds[0],
    fx.b.unitTypeIds[0], '__two_props__guest', 10, NIGHTS_B);
});

await runWithOrganization(neighbour.organizationId, async () => {
  await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    ['__avail__guest_n', neighbour.organizationId, 'Сусід', 'Сусідов']);
  await stay('__avail__res_n', neighbour.organizationId, neighbour.propertyId, neighbour.unitIds[0],
    neighbour.unitTypeId, '__avail__guest_n', 20, NIGHTS_NEIGHBOUR);
});

const sums = [NIGHTS_A + NIGHTS_B, NIGHTS_A + NIGHTS_NEIGHBOUR, NIGHTS_B + NIGHTS_NEIGHBOUR,
  NIGHTS_A + NIGHTS_B + NIGHTS_NEIGHBOUR];
say([NIGHTS_A, NIGHTS_B, NIGHTS_NEIGHBOUR].every((n) => !sums.includes(n))
  && new Set([NIGHTS_A, NIGHTS_B, NIGHTS_NEIGHBOUR]).size === 3,
  `ночі несумісні: свій ${NIGHTS_A}, сусідній будинок ${NIGHTS_B}, чужий рахунок ${NIGHTS_NEIGHBOUR}`);

/** Скільки дат календар назвав зайнятими — і статус, бо «404» це не «порожньо». */
const booked = async (site: string, params: Record<string, string>) => {
  const query = new URLSearchParams({ site_id: site, from: WINDOW_FROM, to: WINDOW_TO, ...params });
  const res = await GET({ url: `http://local/api/public/availability?${query}` } as never);
  const body = await res.json() as { bookedDates?: string[] };
  return { status: res.status, dates: body.bookedDates || [] };
};

// ── Сайт обʼєкта А, номер обʼєкта А: зустрічна вісь ────────────────────────

const ownUnit = await booked('__avail__site_a', { unit_id: fx.a.unitIds[0] });
say(ownUnit.dates.length === NIGHTS_A,
  `свій номер на сайті свого обʼєкта: ${NIGHTS_A} зайнятих дат, отримали ${ownUnit.dates.length}`);

// ── Сайт обʼєкта А, номер обʼєкта Б: те, через що правка ───────────────────

const otherUnit = await booked('__avail__site_a', { unit_id: fx.b.unitIds[0] });
say(otherUnit.dates.length === 0,
  `номер сусіднього будинку на сайті обʼєкта А — порожньо, отримали ${otherUnit.dates.length} дат`);

// ── Сайт обʼєкта А, номер ЧУЖОГО РАХУНКУ ──────────────────────────────────

const alienUnit = await booked('__avail__site_a', { unit_id: neighbour.unitIds[0] });
say(alienUnit.dates.length === 0,
  `номер чужого рахунку на сайті обʼєкта А — порожньо, отримали ${alienUnit.dates.length} дат`);

// ── Той самий номер на СВОЄМУ сайті: доказ, що дати взагалі є ──────────────
//
// Без цього «порожньо» вище було б істинним і тоді, коли засів не ліг.

const otherOnItsOwnSite = await booked('__avail__site_b', { unit_id: fx.b.unitIds[0] });
say(otherOnItsOwnSite.dates.length === NIGHTS_B,
  `той самий номер на сайті свого обʼєкта: ${NIGHTS_B} дат, отримали ${otherOnItsOwnSite.dates.length}`);

// ── Друга гілка маршруту: тип номера, а не номер ───────────────────────────
//
// Вона питає базу двома запитами, і вісь треба в обох: перший відбирає номери
// типу, другий читає їхні броні. Тип обʼєкта Б, спитаний із сайту А, не мусить
// дати нічого — а свій тип мусить дати рівно свої дати.

const ownType = await booked('__avail__site_a', { unit_type_id: fx.a.unitTypeIds[0] });
say(ownType.dates.length === NIGHTS_A,
  `свій тип номера на сайті свого обʼєкта: ${NIGHTS_A} дат, отримали ${ownType.dates.length}`);

const otherType = await booked('__avail__site_a', { unit_type_id: fx.b.unitTypeIds[0] });
say(otherType.dates.length === 0,
  `тип сусіднього будинку на сайті обʼєкта А — порожньо, отримали ${otherType.dates.length} дат`);

const alienType = await booked('__avail__site_a', { unit_type_id: neighbour.unitTypeId });
say(alienType.dates.length === 0,
  `тип номера чужого рахунку на сайті обʼєкта А — порожньо, отримали ${alienType.dates.length} дат`);

// ── Невідомий сайт лишається 404 ──────────────────────────────────────────
//
// Правка звужує читання і не сміє переписати відмову: «такого сайту немає» і
// «на цьому сайті все вільне» — різні відповіді (інваріант 13).

const noSite = await booked('__avail__site_missing', { unit_id: fx.a.unitIds[0] });
say(noSite.status === 404, `невідомий ключ сайту — 404, отримали ${noSite.status}`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\navailability-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`availability-scope: свій номер ${NIGHTS_A} дат, сусідній будинок і чужий рахунок — порожньо`);
assert.ok(true);
