/**
 * Звіт і збір рахуються по ОБРАНОМУ обʼєкту, а не по всьому рахунку.
 *
 *   node src/modules/reports/api/reports-scope.check.ts
 *
 * ── Два різні стани, які виглядали однаково ─────────────────────────────
 *
 * `getReport` вісь мав — власну: `searchParams.get('property_id')` і приватні
 * `scope()`/`scoped()`. Працювало, поки обʼєкт названо; без параметра «усі»
 * бралися МОВЧКИ, а чужий id не відмовляв 404, а тихо давав порожньо (`OWN()`
 * зрізає його орендарем). Тобто дві з трьох відповідей були не тим, чим
 * здавались, і третя копія осі жила поруч зі спільними дверима.
 *
 * `getCityTaxReport` осі не мав узагалі — лише `OWN('r.')`, вісь орендаря. А
 * це число **подають у міську раду**: воно за побудовою про заклад, і сума по
 * двох обʼєктах не є звітом жодного з них. Той самий рід, що INC-037, у
 * сусідньому звіті — знайдено при переведенні читачів, а не за списком.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * Спільна фікстура: обʼєкт А — 2 броні по 1000 і 5 номерів, обʼєкт Б — 3 по
 * 3300 і 7 номерів. Виторг 2000 / 9900 / 11900, номери 5 / 7 / 12 — жодне
 * число не є ні половиною, ні подвоєнням іншого, тож «забув вісь» не
 * сплутати з «урахував». Збір засіяно 20 на бронь в А і 35 у Б: 40 / 105 / 145,
 * ті самі числа, що в книзі гостей, і з тієї ж причини — вони несумісні.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-reports-scope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { getReport } = await import('./reports.handlers.ts');
const { getCityTaxReport } = await import('./city-tax.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

const TAX_A = fx.a.cityTaxPerNight;   // 20
const TAX_B = fx.b.cityTaxPerNight;   // 35
await runWithOrganization(fx.organizationId, async () => {
  for (const [ids, amount] of [[fx.a.reservationIds, TAX_A], [fx.b.reservationIds, TAX_B]] as const) {
    for (const id of ids) {
      await sql.run('UPDATE reservations SET city_tax_amount = ?, city_tax_paid = ? WHERE id = ?',
        [amount, 'paid', id]);
    }
  }
});

const REVENUE_A = fx.a.reservationIds.length * fx.a.stayTotal;   // 2000
const REVENUE_B = fx.b.reservationIds.length * fx.b.stayTotal;   // 9900
const REVENUE_ALL = REVENUE_A + REVENUE_B;                        // 11900
const TAXSUM_A = fx.a.reservationIds.length * TAX_A;              // 40
const TAXSUM_B = fx.b.reservationIds.length * TAX_B;              // 105
const TAXSUM_ALL = TAXSUM_A + TAXSUM_B;                           // 145

say(REVENUE_A !== REVENUE_B && REVENUE_ALL !== REVENUE_A && REVENUE_ALL !== REVENUE_B,
  `виторги несумісні: А=${REVENUE_A}, Б=${REVENUE_B}, усі=${REVENUE_ALL}`);
say(TAXSUM_A !== TAXSUM_B && TAXSUM_ALL !== TAXSUM_A && TAXSUM_ALL !== TAXSUM_B,
  `суми збору несумісні: А=${TAXSUM_A}, Б=${TAXSUM_B}, усі=${TAXSUM_ALL}`);

const actor = { organizationId: fx.organizationId } as never;
const url = (path: string, scope: string) =>
  ({ url: `http://local${path}&${scope}` } as never);

const report = async (scope: string) => runWithOrganization(fx.organizationId, async () => {
  const res = await getReport(url('/api/reports?from=2026-09-01&to=2026-09-30', scope), null, actor) as Response;
  return { status: res.status, body: await res.json() as any };
});
const cityTax = async (scope: string) => runWithOrganization(fx.organizationId, async () => {
  const res = await getCityTaxReport(url('/api/reports/city-tax?month=2026-09', scope), null, actor) as Response;
  return { status: res.status, body: await res.json() as any };
});

// ── Звіт: названий обʼєкт дає ЙОГО числа ──────────────────────────────────

const rA = await report(`property_id=${fx.a.id}`);
say(rA.body?.summary?.totalRevenue === REVENUE_A,
  `виторг обʼєкта А = ${REVENUE_A}, отримали ${rA.body?.summary?.totalRevenue}`);
say(rA.body?.summary?.totalBookings === fx.a.reservationIds.length,
  `броней обʼєкта А = ${fx.a.reservationIds.length}, отримали ${rA.body?.summary?.totalBookings}`);

const rB = await report(`property_id=${fx.b.id}`);
say(rB.body?.summary?.totalRevenue === REVENUE_B,
  `виторг обʼєкта Б = ${REVENUE_B}, отримали ${rB.body?.summary?.totalRevenue}`);

// «Усі обʼєкти» лишається можливим — але сказаним словом.
const rAll = await report('property_id=all');
say(rAll.body?.summary?.totalRevenue === REVENUE_ALL,
  `сказане «усі обʼєкти» дає ${REVENUE_ALL}, отримали ${rAll.body?.summary?.totalRevenue}`);

// Завантаженість: знаменник — номери ОБРАНОГО обʼєкта. Без осі він 12, і
// відсоток тоді неправильний навіть тоді, коли броні порахували правильно.
say(rA.body?.period?.days > 0 && rB.body?.period?.days > 0,
  'звіт віддає період для обох обʼєктів');

// ── Чужий обʼєкт — 404, не порожній звіт (інваріант 5) ────────────────────

const alien = await report('property_id=__two_props__not_ours');
say(alien.status === 404,
  `чужий обʼєкт у параметрі — 404, а не порожній звіт (статус ${alien.status})`);

// ── Збір, який подають у міську раду ──────────────────────────────────────

const tA = await cityTax(`property_id=${fx.a.id}`);
say(tA.body?.totalTaxAmount === TAXSUM_A,
  `збір обʼєкта А = ${TAXSUM_A}, отримали ${tA.body?.totalTaxAmount}`);

const tB = await cityTax(`property_id=${fx.b.id}`);
say(tB.body?.totalTaxAmount === TAXSUM_B,
  `збір обʼєкта Б = ${TAXSUM_B}, отримали ${tB.body?.totalTaxAmount}`);

const tAll = await cityTax('property_id=all');
say(tAll.body?.totalTaxAmount === TAXSUM_ALL,
  `сказане «усі обʼєкти» дає ${TAXSUM_ALL}, отримали ${tAll.body?.totalTaxAmount}`);

fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  console.log(`\nreports-scope: ${fails.length} червоних`);
  process.exit(1);
}
console.log(`reports-scope: звіт ${REVENUE_A}/${REVENUE_B}/${REVENUE_ALL}, збір ${TAXSUM_A}/${TAXSUM_B}/${TAXSUM_ALL}, чужий обʼєкт — 404`);
assert.ok(true);
