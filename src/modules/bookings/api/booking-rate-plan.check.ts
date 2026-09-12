/**
 * Тариф на броні перевіряється ПИСАЧЕМ, а не лише котируванням.
 *
 *   node src/modules/bookings/api/booking-rate-plan.check.ts
 *
 * ── Клас, за який уже платили чотири рази ───────────────────────────────
 *
 * INC-201…203 і INC-205: читача полагодили, писач лишився відчиненим. Тут
 * рівно те саме, вп'яте. `/api/pricing/quote` звіряє тариф із платником
 * (`assertRatePlanForPayer`, INC-205) — тобто фірмову ціну не порахують
 * тому, кому вона не належить. Але саму БРОНЬ створює інший маршрут, і він
 * тарифу не бачив узагалі: `reservations.rate_plan_id` існував у схемі й не
 * мав жодного писача.
 *
 * Щойно форма дає обрати тариф, «звузити список на екрані» перестає бути
 * захистом: `ratePlanId` приходить із ТІЛА запиту, і хто знає ідентифікатор —
 * називає його сам.
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. ДВА тарифи: звичайний і ФІРМОВИЙ. З одним «фірмовий не для чужого»
 *    зелене й на коді, який відмовляє кожному тарифу.
 * 2. ДВІ фірми: власниця тарифу і стороння. Без другої «лише своя фірма»
 *    істинне й на коді, який пускає будь-яку названу.
 * 3. Платник-ФІЗОСОБА (фірми немає) — третій стан, не «фірма Б»: звичайний
 *    тариф йому можна, фірмовий — ні.
 * 4. Другий готель: тариф сусіда — 404, як і неіснуючий.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-booking-plan-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { createCompanyForTests } = await import('@companies/kernel.ts');
const { createReservationHandler } = await import('./reservations.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const ORG = fx.organizationId;

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

let OWNER = '';        // фірма, якій належить фірмовий тариф
let OUTSIDER = '';     // стороння фірма того самого готелю
let PLAIN_PLAN = '';   // звичайний тариф
let COMPANY_PLAN = ''; // фірмовий тариф
let ALIEN_PLAN = '';   // тариф СУСІДНЬОГО готелю

// `rate_plans` НЕ має `organization_id`: він досяжний через `property_id`
// (NAMING §2 — «або несе `organization_id`, або досяжна FK-ланцюгом до
// `properties`»). Саме тому двері звіряють орендаря джойном на `properties`.
const plan = (id: string, org: string, propertyId: string, code: string, name: string) =>
  runWithOrganization(org, () => sql.run(
    `INSERT INTO rate_plans (id, property_id, code, name, currency)
     VALUES (?, ?, ?, ?, 'EUR')`,
    [id, propertyId, code, name]));

await runWithOrganization(ORG, async () => {
  OWNER = await createCompanyForTests(ORG, { name: 'Фірма-власниця', business_id: '55550000' });
  OUTSIDER = await createCompanyForTests(ORG, { name: 'Стороння фірма', business_id: '66660000' });
});
PLAIN_PLAN = '__brp__plain';
COMPANY_PLAN = '__brp__corp';
ALIEN_PLAN = '__brp__alien';
await plan(PLAIN_PLAN, ORG, fx.a.id, 'PLAIN', 'Звичайний');
await plan(COMPANY_PLAN, ORG, fx.a.id, 'CORP', 'Фірмовий');

// Тариф СУСІДА — у ДРУГІЙ ОРГАНІЗАЦІЇ, не в другому будинку: вісь
// тут орендар, і будинок її не заміняє.
//
// Сусіда СІЮ МИ, а не шукаємо: `seedTwoProperties` заводить ДВА БУДИНКИ
// ОДНОГО рахунку і жодного сусіднього рахунку. Перша редакція шукала його
// запитом і не знаходила — тобто «тариф сусіда — 404» було зелене тому, що тарифу
// НЕ ІСНУВАЛО. Злом дверей (знятий орендар у SQL) лишався зеленим — це й є
// вироджена вісь з інваріанта 26, знайдена саме спробою завалити власний гейт.
const neighbour = await seedNeighbourOrganization();
await plan(ALIEN_PLAN, neighbour.organizationId, neighbour.propertyId, 'ALIEN', 'Сусідів');
// Контроль фікстури: тариф сусіда СПРАВДІ ІСНУЄ — інакше твердження нижче
// зелене з неправильної причини.
const alienExists = await runWithOrganization(neighbour.organizationId, () =>
  sql.row<{ id: string }>('SELECT id FROM rate_plans WHERE id = ?', [ALIEN_PLAN]));
say(!!alienExists, 'тариф сусіда заведено — вісь орендаря не порожня');

// Фірмовий тариф належить ВЛАСНИЦІ.
await runWithOrganization(ORG, () => sql.run(
  `INSERT INTO company_rate_plans (id, organization_id, company_id, rate_plan_id)
   VALUES (?, ?, ?, ?)`, ['__brp__link', ORG, OWNER, COMPANY_PLAN]));

const actorOf = (org: string) => ({ organizationId: org, user: { id: 'u', permissions: ['manage_bookings'] } } as never);
let seq = 0;
const book = (companyId: string | null, ratePlanId: string | null, unitIdx = 0) =>
  runWithOrganization(ORG, async () => {
    seq += 1;
    const res = await createReservationHandler({
      json: async () => ({
        unitId: fx.a.unitIds[unitIdx],
        checkIn: `2028-0${seq}-10`, checkOut: `2028-0${seq}-12`, nights: 2,
        adults: 1, children: 0, status: 'confirmed', source: 'direct', totalPrice: 500,
        firstName: 'Тариф', lastName: `Гість${seq}`,
        companyId, ratePlanId,
      }),
      url: 'http://local/api/bookings',
    } as never, null, actorOf(ORG));
    return { status: res.status, body: await res.json() as any };
  });

const planOf = (id: string) => runWithOrganization(ORG, async () => {
  const row = await sql.row<{ rate_plan_id: string | null }>(
    'SELECT rate_plan_id FROM reservations WHERE id = ?', [id]);
  return row?.rate_plan_id ?? null;
});

// ── 1. Контроль: звичайний тариф проходить і ЛЯГАЄ в рядок ────────────────
const plainOk = await book(null, PLAIN_PLAN);
say(plainOk.status === 201, `звичайний тариф без фірми — 201 (${plainOk.status}: ${JSON.stringify(plainOk.body).slice(0, 80)})`);
if (plainOk.status === 201) {
  say(await planOf(plainOk.body.id) === PLAIN_PLAN,
    `і тариф записано в бронь (${await planOf(plainOk.body.id)})`);
}

// ── 2. Фірмовий тариф СВОЄЇ фірми — можна ─────────────────────────────────
const mine = await book(OWNER, COMPANY_PLAN, 1);
say(mine.status === 201, `фірмовий тариф своєї фірми — 201 (${mine.status})`);
if (mine.status === 201) say(await planOf(mine.body.id) === COMPANY_PLAN, 'і він у рядку броні');

// ── 3. Фірмовий тариф СТОРОННЬОЇ фірми — 404 ──────────────────────────────
//
// Це і є та дірка: список на екрані його не покаже, але тіло запиту називає
// ідентифікатор саме.
const before = await runWithOrganization(ORG, () => sql.row<any>(
  'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', [ORG]));
const outsider = await book(OUTSIDER, COMPANY_PLAN, 2);
say(outsider.status === 404, `фірмовий тариф чужої фірми — 404 (${outsider.status})`);

// ── 4. І ФІЗОСОБІ фірмовий тариф теж не можна — третій стан ───────────────
const person = await book(null, COMPANY_PLAN, 3);
say(person.status === 404, `фірмовий тариф без фірми — 404 (${person.status})`);

// ── 5. Тариф СУСІДНЬОГО готелю — 404, як і неіснуючий ─────────────────────
const alien = await book(null, ALIEN_PLAN, 4);
say(alien.status === 404, `тариф сусіднього готелю — 404 (${alien.status})`);
const nothing = await book(null, 'rp_definitely_not_ours', 4);
say(nothing.status === 404, `неіснуючий тариф — 404 (${nothing.status})`);

// ── 6. Відмова НЕ ЛИШАЄ броні ─────────────────────────────────────────────
const after = await runWithOrganization(ORG, () => sql.row<any>(
  'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', [ORG]));
say(Number(before.n) === Number(after.n),
  `чотири відмови не лишили жодної броні (було ${before.n}, стало ${after.n})`);

// ── 7. Без тарифу — як і було ─────────────────────────────────────────────
const noPlan = await book(null, null, 4);
say(noPlan.status === 201, `бронь без тарифу — 201, як і досі (${noPlan.status})`);
if (noPlan.status === 201) say(await planOf(noPlan.body.id) === null, 'і колонка порожня');

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\nbooking-rate-plan: ${fails.length} червоних`); process.exit(1); }
console.log('booking-rate-plan: писач звіряє тариф із платником тими самими дверима, що й котирування');
