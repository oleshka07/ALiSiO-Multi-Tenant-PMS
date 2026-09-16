/**
 * ГІСТЬ БАЧИТЬ ТОЙ САМИЙ БОРГ, ЩО Й РЕЦЕПЦІЯ.
 *
 *   node src/modules/guests/data/portal-balance.check.ts
 *
 * ── Дефект, проти якого це написано (ревізія 16.09.2026, П4) ────────────
 *
 * Гостьова сторінка рахувала залишок як `total_price − SUM(fin_operations)`.
 * Гість, який заплатив на стійці через рахунок (фоліо), у тій книзі не
 * зʼявлявся взагалі: сторінка показувала ПОВНИЙ борг, а на обʼєкті з
 * політикою `prepaid` перед ним ще й ставав платіжний шлагбаум — при
 * закритому рахунку. Те саме число на картці броні при цьому було правильне.
 *
 * Шлагбаум читає `isPaid`, а `isPaid` читає в тому числі `remaining <= 0` —
 * тобто це твердження і про двері, а не лише про цифру.
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. Три ДЖЕРЕЛА відповіді: книга гостя, каса, і «жодного платежу». Якби
 *    сцена мала лише перше, зеленим лишився б і код, який завжди відповідає
 *    з фоліо — а бронь без фоліо тоді показувала б нуль боргу кожному.
 * 2. Числа різні й несумісні: нараховано 1200, сплачено 400, борг 800, а
 *    `total_price` фікстури — 1000, тобто ЧЕТВЕРТЕ число. Нарахування
 *    навмисно НЕ дорівнює сумі броні: саме так виглядає стоя з послугою чи
 *    збором, і саме на цьому старе «total_price − каса» давало інший борг.
 * 3. Оплата переказом, а не готівкою: саме її не бачила каса, і саме на ній
 *    вада була видима.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-portal-bal-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const kernel = await import('@invoicing/kernel');
const { getPaymentsSummary } = await import('./guest-portal.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const ORG = fx.organizationId;
const CHARGED = 1200;
const PAID = 400;

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

await runWithOrganization(ORG, async () => {
  const totalPrice = fx.a.stayTotal;

  // ── 1. Бронь ведуть у рахунку: відповідає КНИГА ГОСТЯ ─────────────────
  const withFolio = fx.a.reservationIds[0];
  const folioId = await kernel.ensureReservationFolio(withFolio);
  await kernel.addCharges([{
    folioId, reservationId: withFolio, serviceDate: fx.a.checkIns[0], kind: 'lodging',
    description: 'Проживання', guestName: null, unitCode: null,
    quantity: 1, unitPriceGross: CHARGED, totalGross: CHARGED, vatRate: 0, source: 'manual',
  }]);
  await kernel.recordPayment({ folioId, amount: PAID, method: 'transfer' });

  const a = await getPaymentsSummary(withFolio, totalPrice);
  say(a.source === 'folio', `джерело відповіді — книга гостя, отримали «${a.source}»`);
  say(a.remaining === CHARGED - PAID,
    `борг ${a.remaining}, а нараховано ${CHARGED} і сплачено ${PAID} → ${CHARGED - PAID}`);
  say(a.total_paid === PAID, `сплачено ${a.total_paid}, мало бути ${PAID}`);
  say(a.remaining !== totalPrice,
    `борг дорівнює total_price (${totalPrice}) — це стара арифметика, книги гостя не видно`);

  // Рахунок закрито — шлагбаум мусить упасти (`remaining <= 0`).
  await kernel.recordPayment({ folioId, amount: CHARGED - PAID, method: 'transfer' });
  const closed = await getPaymentsSummary(withFolio, totalPrice);
  say(closed.remaining === 0, `закритий рахунок — борг 0, отримали ${closed.remaining}`);

  // ── 2. Бронь без рахунку: відповідає КАСА ─────────────────────────────
  const noFolio = fx.a.reservationIds[1];
  const b = await getPaymentsSummary(noFolio, totalPrice);
  say(b.source === 'ledger', `без книги гостя джерело — каса, отримали «${b.source}»`);
  say(b.remaining === totalPrice,
    `без жодного платежу гість винен усю суму (${totalPrice}), отримали ${b.remaining}`);

  // ── 3. Та сама бронь після готівки через касу ─────────────────────────
  await sql.run(
    `INSERT INTO fin_operations (id, organization_id, op_type, amount, amount_company, currency, paid_at, accrued_at, status, reservation_id, payment_subtype)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ['__pb_op', ORG, 'income', PAID, PAID, 'CZK', fx.a.checkIns[1], fx.a.checkIns[1], 'completed', noFolio, 'partial']);
  const c = await getPaymentsSummary(noFolio, totalPrice);
  say(c.source === 'ledger' && c.total_paid === PAID,
    `каса відповідає своїм числом: сплачено ${c.total_paid}`);
  say(c.remaining === totalPrice - PAID,
    `борг ${c.remaining}, мав бути ${totalPrice - PAID}`);
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`\nportal-balance: ${fails.length} червоних`); process.exit(1); }
console.log('portal-balance: гість бачить борг із книги гостя, а без неї — з каси');
