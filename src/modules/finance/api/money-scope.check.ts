/**
 * Гроші — по ОБʼЄКТУ: прогноз надходжень і звіт оплачених послуг (Д52, В11).
 *
 *   node src/modules/finance/api/money-scope.check.ts
 *
 * ── Чому саме ці два, а не «фінанси взагалі» ────────────────────────────
 *
 * Модуль фінансів переважно зведений: бізнес-юніти, нарахування, P&L — це
 * числа КОМПАНІЇ, і звужувати їх до будинку неправильно. Але два читачі
 * віддають не зведення, а **порядкові рядки**:
 *
 *   `getExpectedPayments` — бронь за бронню, з `guest_name` і `unit_name`;
 *   `getPaidServices`     — замовлення за замовленням, з тими самими полями.
 *
 * Оператор, який тримає обраним обʼєкт А, читав тут імена гостей і номерів
 * обʼєкта Б — і не мав як зрозуміти, що це не його. Це та сама межа, що в
 * AGENTS §29: вона проходить по ДАНИХ, не по екрану, і рядок із чужим номером
 * кімнати не стає зведенням від того, що лежить на фінансовому екрані.
 *
 * Рішення власника В11 (Д52) розвело дві відповіді навмисно: гість — по
 * рахунку (лояльність це властивість компанії), гроші — по обʼєкту (каса
 * стоїть у будинку, ПДВ і звітність у кожного свої).
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Спільна фікстура. Прогноз: у А дві неоплачені броні по 1000, у Б три по
 * 3300 — 2000 / 9900 / 11900, жодне не є половиною чи подвоєнням іншого.
 * Послуги: 1 замовлення в А і 2 в Б, ціни 70 і 900 — 70 / 1800 / 1870, і
 * «взяв сусідову ціну» тут видно сумою, а не лише лічильником.
 *
 * Чужий обʼєкт у параметрі — 404, а не порожній звіт: «даних немає» і «такого
 * обʼєкта немає» це різні відповіді (інваріанти 5 і 13).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-money-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { getExpectedPayments } = await import('./reports.handlers.ts');
const { getPaidServices } = await import('./paid-services.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const PRICE_A = 70;
const PRICE_B = 900;
const ORDERS_A = 1;
const ORDERS_B = 2;

await runWithOrganization(fx.organizationId, async () => {
  // Броні фікстури стоять у вересні; прогноз дивиться вперед від сьогодні,
  // тож дати зсуваються в майбутнє, а суми лишаються фікстурними.
  const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
  for (const ids of [fx.a.reservationIds, fx.b.reservationIds]) {
    for (const id of ids) {
      await sql.run(
        `UPDATE reservations SET status = 'confirmed', payment_status = 'unpaid',
                                 check_in = ?, check_out = ? WHERE id = ?`,
        [soon, later, id]);
    }
  }
  // Послуги і замовлення: своя послуга на кожному обʼєкті, ціни несумісні.
  let n = 0;
  for (const [prop, price, count, ids] of [
    [fx.a.id, PRICE_A, ORDERS_A, fx.a.reservationIds],
    [fx.b.id, PRICE_B, ORDERS_B, fx.b.reservationIds],
  ] as const) {
    const serviceId = `__money__svc_${prop}`;
    await sql.run(
      `INSERT INTO additional_services (id, property_id, name, price, currency, is_active)
       VALUES (?, ?, ?, ?, 'EUR', TRUE)`, [serviceId, prop, `Послуга ${prop}`, price]);
    for (let i = 0; i < count; i++) {
      n += 1;
      await sql.run(
        `INSERT INTO booking_service_orders (id, reservation_id, service_id, quantity, total_price, payment_status, service_date, created_at)
         VALUES (?, ?, ?, 1, ?, 'paid', ?, ?)`,
        [`__money__ord${n}`, ids[i], serviceId, price, '2026-09-09', '2026-09-09T10:00:00Z']);
    }
  }
});

const EXPECT_A = fx.a.reservationIds.length * fx.a.stayTotal;   // 2000
const EXPECT_B = fx.b.reservationIds.length * fx.b.stayTotal;   // 9900
const EXPECT_ALL = EXPECT_A + EXPECT_B;                          // 11900
const PAID_A = ORDERS_A * PRICE_A;                               // 70
const PAID_B = ORDERS_B * PRICE_B;                               // 1800
const PAID_ALL = PAID_A + PAID_B;                                // 1870

say(EXPECT_A !== EXPECT_B && EXPECT_ALL !== EXPECT_A && EXPECT_ALL !== EXPECT_B,
  `прогноз несумісний: А=${EXPECT_A}, Б=${EXPECT_B}, усі=${EXPECT_ALL}`);
say(PAID_A !== PAID_B && PAID_ALL !== PAID_A && PAID_ALL !== PAID_B,
  `оплачені послуги несумісні: А=${PAID_A}, Б=${PAID_B}, усі=${PAID_ALL}`);

const actor = { organizationId: fx.organizationId } as never;
const call = async (
  handler: (r: never, c: never, a: never) => Promise<Response>, url: string,
) => runWithOrganization(fx.organizationId, async () => {
  const res = await handler({ url, nextUrl: new URL(url) } as never, null as never, actor);
  return { status: res.status, body: await res.json() as any };
});

// ── Прогноз надходжень ─────────────────────────────────────────────────────

const expected = (scope: string) =>
  call(getExpectedPayments as never, `http://local/api/finance/expected-payments?property_id=${scope}`);

const eA = await expected(fx.a.id);
say(Math.round(eA.body?.summary?.total_expected) === EXPECT_A,
  `прогноз обʼєкта А = ${EXPECT_A}, отримали ${eA.body?.summary?.total_expected}`);
say(!(eA.body?.items || []).some((i: any) => String(i.unit_name || '').startsWith('B1-')),
  'у прогнозі обʼєкта А немає номерів обʼєкта Б');

const eB = await expected(fx.b.id);
say(Math.round(eB.body?.summary?.total_expected) === EXPECT_B,
  `прогноз обʼєкта Б = ${EXPECT_B}, отримали ${eB.body?.summary?.total_expected}`);

const eAll = await expected('all');
say(Math.round(eAll.body?.summary?.total_expected) === EXPECT_ALL,
  `сказане «усі обʼєкти» дає ${EXPECT_ALL}, отримали ${eAll.body?.summary?.total_expected}`);

const eAlien = await expected('__two_props__not_ours');
say(eAlien.status === 404, `чужий обʼєкт — 404, а не порожній прогноз (статус ${eAlien.status})`);

// ── Оплачені послуги ───────────────────────────────────────────────────────

const paid = (scope: string) =>
  call(getPaidServices as never, `http://local/api/finance/paid-services?property_id=${scope}`);

const pA = await paid(fx.a.id);
const sumOf = (b: any) => (b?.services || [])
  .reduce((s: number, r: any) => s + Number(r.total_price || 0), 0);
say(sumOf(pA.body) === PAID_A, `оплачені послуги обʼєкта А = ${PAID_A}, отримали ${sumOf(pA.body)}`);

const pB = await paid(fx.b.id);
say(sumOf(pB.body) === PAID_B, `оплачені послуги обʼєкта Б = ${PAID_B}, отримали ${sumOf(pB.body)}`);

const pAll = await paid('all');
say(sumOf(pAll.body) === PAID_ALL, `сказане «усі обʼєкти» дає ${PAID_ALL}, отримали ${sumOf(pAll.body)}`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\nmoney-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`money-scope: прогноз ${EXPECT_A}/${EXPECT_B}/${EXPECT_ALL}, послуги ${PAID_A}/${PAID_B}/${PAID_ALL}, чужий обʼєкт — 404`);
assert.ok(true);
