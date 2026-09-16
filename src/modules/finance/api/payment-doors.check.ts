/**
 * ОДНІ ГРОШІ — ОДНАКОВІ КНИГИ, ЯКИМИ Б ДВЕРИМА ВОНИ НЕ ЗАЙШЛИ.
 *
 *   node src/modules/finance/api/payment-doors.check.ts
 *   DB_DRIVER=postgres DATABASE_URL=… node …/payment-doors.check.ts
 *
 * ── Дефект, проти якого це написано (ревізія 16.09.2026) ────────────────
 *
 * Дверей у гроші двоє, і вони давали різне. Виміряно запуском на тій самій
 * фікстурі, тими самими 1000 готівкою:
 *
 *                      книга гостя   слово броні   каса
 *   екран фоліо        борг 0        unpaid        0 рядків
 *   рецепція           борг 0        paid          1 рядок, 1000
 *
 * Слово броні після оплати з фоліо ставив БРАУЗЕР окремим `PATCH`, який
 * вимагає `manage_bookings`; у бухгалтера цього права немає, тож у нього
 * оплата мовчки лишала бронь «не оплаченою». А каса не бачила рецепційної
 * готівки взагалі: у ролі `receptionist` немає `manage_payments`, тобто
 * ЄДИНІ доступні рецепції двері були ті, що в касу не пишуть.
 *
 * Гейт, який мав це ловити (`folio-book.check`), був зелений: його сцена А
 * кличе `recalcPaymentStatusFromFolio` САМА, окремим рядком, тобто стоїть на
 * місці браузера. Він доводив, що функція працює, а не що шлях її кличе —
 * AGENTS §3.2.1 дослівно. Тому тут двері викликаються так, як їх кличе
 * маршрут, і нічого не дораховується руками.
 *
 * ── Осі, по яких фікстура не вироджена (інваріант 26) ───────────────────
 *
 * 1. ДВОЄ дверей. З одними твердження зелене на будь-якому писачі.
 * 2. Готівка проти переказу: `transfer` закриває книгу гостя і НЕ лягає в
 *    касу (гроші прийдуть випискою). Без цієї осі «пиши все в касу» теж
 *    було б зеленим — і давало б подвійний рахунок тих самих грошей.
 * 3. Повна оплата проти часткової: 600 із 1000 — це `partial`, а не `paid`.
 *    Числа різні (1000 / 600 / 400), тож жодне альтернативне прочитання не
 *    збігається з очікуваним.
 * 4. Фоліо з бронню проти фоліо БЕЗ неї (зала): друге не має слова й не має
 *    від чого взяти валюту з обʼєктом — і не сміє через це падати.
 * 5. Документів у рахунку нуль / один / два — автозвʼязок платежу ставиться
 *    лише на однозначному.
 * 6. СЛІД у журналі броні — з обох дверей. Д81 постановив, що правка, якою
 *    рухають гроші, лишає рядок у «Історії змін», і рецепційні двері його
 *    лишають. Фоліо-двері не лишали: «одні двері — однакові книги» було б
 *    неправдою рівно на одну книгу, і питання «звідки на броні ці гроші»
 *    знову не мало б відповіді там, де його ставлять.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

if (process.env.DB_DRIVER !== 'postgres') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-doors-'));
  process.env.ALISIO_DATA_DIR = tmp;
}

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { createPaymentOperation, settleFolioPayment } = await import('./payment-bridge.ts');
const { reservationBalance } = await import('@invoicing/kernel');
// Двері модуля, не його нутрощі: `fin_folios` належить `@invoicing`, і гейт
// ходить туди тим самим фасадом, що й код (`check-boundaries`).
const folio = await import('@invoicing/kernel');

const sql = getSql();
const fx = await seedTwoProperties();
const ORG = fx.organizationId;
const PROP = fx.a.id;
const CHARGE = 1000;
const PART = 600;

const fails: string[] = [];
const say = (cond: boolean, what: string) => {
  if (cond) console.log(`  ok  ${what}`);
  else { fails.push(what); console.log(`  ЧЕРВОНЕ  ${what}`); }
};

/** Три книги однією відповіддю — рівно те, що бачить людина. */
async function books(reservationId: string) {
  const res = await sql.row<{ payment_status: string }>(
    'SELECT payment_status FROM reservations WHERE id = ? AND organization_id = ?', [reservationId, ORG]);
  const owed = await reservationBalance(reservationId);
  const till = await sql.row<{ n: number; s: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS s FROM fin_operations
      WHERE reservation_id = ? AND organization_id = ?`, [reservationId, ORG]);
  const linked = await sql.row<{ n: number }>(
    `SELECT COUNT(*) AS n FROM fin_operations
      WHERE reservation_id = ? AND organization_id = ? AND folio_payment_id IS NOT NULL`, [reservationId, ORG]);
  // Четверта книга — журнал броні. Саме там питають «звідки ці гроші», і
  // саме там рецепційні двері лишали рядок, а фоліо-двері — ні.
  const log = await sql.rows<{ details: string }>(
    `SELECT details FROM booking_activity_log
      WHERE reservation_id = ? AND organization_id = ? AND action = 'payment'`, [reservationId, ORG]);
  return {
    word: String(res?.payment_status ?? ''),
    owed: owed.balance,
    tillRows: Number(till?.n ?? 0),
    tillSum: Number(till?.s ?? 0),
    linked: Number(linked?.n ?? 0),
    logRows: log.length,
    logText: log.map((r) => String(r.details ?? '')).join(' | '),
  };
}

async function charge(reservationId: string, amount: number): Promise<string> {
  const folioId = await folio.ensureReservationFolio(reservationId);
  await folio.addCharges([{
    folioId, reservationId, serviceDate: fx.a.checkIns[0], kind: 'lodging',
    description: 'Проживання', guestName: null, unitCode: null,
    quantity: 1, unitPriceGross: amount, totalGross: amount, vatRate: 0, source: 'manual',
  }]);
  return folioId;
}

try {
  await runWithOrganization(ORG, async () => {
    const currency = String((await sql.row<{ currency: string }>(
      'SELECT currency FROM reservations WHERE id = ? AND organization_id = ?',
      [fx.a.reservationIds[0], ORG]))?.currency);

    // Каса й статті плану рахунків: без них двері відмовляють названо, і
    // сцена доводила б прогалину засіву, а не те, про що вона написана.
    await sql.run(
      `INSERT INTO finance_accounts (id, organization_id, name, type, currency, is_active, sort_order)
       VALUES (?,?,?,?,?,TRUE,1)`, ['__doors_cash', ORG, 'Каса', 'cash', currency]);
    for (const [id, code] of [['__doors_acc', 'accommodation'], ['__doors_oth', 'other_exp']]) {
      await sql.run(
        `INSERT INTO expense_categories (id, organization_id, code, name, std_group, pnl_line)
         VALUES (?,?,?,?,?,?)`, [id, ORG, code, code, 'Revenue', 'Accommodation']);
    }

    // ── 1. Двері фоліо: готівка ──────────────────────────────────────────
    const r1 = fx.a.reservationIds[0];
    const f1 = await charge(r1, CHARGE);
    await settleFolioPayment({ folioId: f1, amount: CHARGE, method: 'cash' });
    const a = await books(r1);
    say(a.owed === 0, `фоліо: борг ${a.owed}, мав бути 0`);
    say(a.word === 'paid', `фоліо: слово броні «${a.word}», мало бути paid`);
    say(a.tillRows === 1 && a.tillSum === CHARGE,
      `фоліо: у касі ${a.tillRows} рядк. на ${a.tillSum}, мав бути 1 на ${CHARGE}`);
    say(a.linked === 1, 'фоліо: рядок каси не називає платіж, який поклав (folio_payment_id)');
    say(a.logRows === 1, `фоліо: слід у журналі броні — ${a.logRows} рядк., мав бути 1 (Д81)`);
    say(a.logText.includes(String(CHARGE)) && a.logText.includes('cash'),
      `фоліо: слід називає суму і спосіб, отримали «${a.logText}»`);

    // ── 2. Двері рецепції: та сама готівка ───────────────────────────────
    const r2 = fx.a.reservationIds[1];
    await charge(r2, CHARGE);
    await createPaymentOperation({
      reservationId: r2, amount: CHARGE, method: 'cash',
      paymentSubtype: 'full', source: 'manual',
    });
    const b = await books(r2);
    say(b.owed === 0, `рецепція: борг ${b.owed}, мав бути 0`);
    say(b.word === 'paid', `рецепція: слово броні «${b.word}», мало бути paid`);
    say(b.tillRows === 1 && b.tillSum === CHARGE,
      `рецепція: у касі ${b.tillRows} рядк. на ${b.tillSum} — подвійний запис саме тут і виглядав би як 2 на ${CHARGE * 2}`);
    say(b.logRows === 1, `рецепція: слід у журналі броні — ${b.logRows} рядк., мав бути 1`);

    // ── 3. ОДНАКОВО ──────────────────────────────────────────────────────
    say(a.word === b.word && a.owed === b.owed && a.tillRows === b.tillRows && a.tillSum === b.tillSum
      && a.logRows === b.logRows,
      `двері дають різне: фоліо ${JSON.stringify(a)} проти рецепції ${JSON.stringify(b)}`);

    // ── 4. Часткова оплата: слово «частково», каса — рівно внесок ────────
    const r3 = fx.b.reservationIds[0];
    const f3 = await charge(r3, CHARGE);
    await settleFolioPayment({ folioId: f3, amount: PART, method: 'cash' });
    const c = await books(r3);
    say(c.word === 'partial', `частковий внесок: слово «${c.word}», мало бути partial`);
    say(c.owed === CHARGE - PART, `частковий внесок: борг ${c.owed}, мав бути ${CHARGE - PART}`);
    say(c.tillSum === PART, `частковий внесок: у касі ${c.tillSum}, мало бути ${PART}`);

    // ── 5. Переказ: книга закрита, каси НЕ торкаємось ────────────────────
    const r4 = fx.b.reservationIds[1];
    const f4 = await charge(r4, CHARGE);
    await settleFolioPayment({ folioId: f4, amount: CHARGE, method: 'transfer' });
    const d = await books(r4);
    say(d.owed === 0, `переказ: борг ${d.owed}, мав бути 0`);
    say(d.word === 'paid', `переказ: слово «${d.word}», мало бути paid`);
    say(d.tillRows === 0,
      `переказ: у касі ${d.tillRows} рядк. — гроші приходять випискою, і рядок тут це подвійний рахунок`);
    // Слід — ТАК, і саме тут видно, що він не про касу, а про гроші: рядка
    // каси немає, а гроші є, і на картці мусить бути видно звідки.
    say(d.logRows === 1, `переказ: слід у журналі — ${d.logRows} рядк., мав бути 1`);
    say(d.logText.includes('transfer'), `переказ: слід називає спосіб, отримали «${d.logText}»`);

    // ── 6. Фоліо без броні (зала): проходить і нічого не кидає ───────────
    const hall = await folio.openFolio({ reservationId: null, propertyId: PROP, label: 'Зала' });
    let hallOk = false;
    try {
      const res = await settleFolioPayment({ folioId: hall, amount: 500, method: 'cash' });
      hallOk = !!res.paymentId && res.operationId === null && res.reservationId === null;
    } catch (e: unknown) {
      hallOk = false;
      console.log(`      (зала кинула: ${(e as Error)?.message})`);
    }
    say(hallOk, 'фоліо без броні: оплата має пройти, слова й каси в неї немає');

    // ── 6a. Каса відмовила — платіж гостя ЛИШАЄТЬСЯ ──────────────────────
    //
    // Готель без активного рахунку в валюті броні: рядок каси не зʼявиться, і
    // це законна відмова. Але гроші вже в руках, тож книга гостя мусить їх
    // бачити, а причина — доїхати до оператора, а не в лог. Без цієї осі
    // «пиши в касу» зелене й на коді, який при відмові каси втрачає платіж.
    await sql.run('UPDATE finance_accounts SET is_active = FALSE WHERE id = ?', ['__doors_cash']);
    const r6 = fx.b.reservationIds[2];
    const f6 = await charge(r6, CHARGE);
    const noTill = await settleFolioPayment({ folioId: f6, amount: CHARGE, method: 'cash' });
    const e = await books(r6);
    say(!!noTill.paymentId && e.owed === 0,
      `каса відмовила — платіж гостя мусить лишитись (борг ${e.owed})`);
    say(noTill.operationId === null && !!noTill.tillRefusal,
      `і відмова названа, а не мовчазна (${noTill.tillRefusal ?? 'мовчання'})`);
    say(e.tillRows === 0, `у касі ${e.tillRows} рядк., мав бути 0`);
    await sql.run('UPDATE finance_accounts SET is_active = TRUE WHERE id = ?', ['__doors_cash']);

    // ── 7. Автозвʼязок платежу з документом ──────────────────────────────
    const r5 = fx.a.reservationIds[0];
    const f5 = await charge(r5, CHARGE);
    const issued = await folio.issueInvoice({ folioId: f5 });
    const paid5 = await settleFolioPayment({ folioId: f5, amount: CHARGE, method: 'transfer' });
    const link = (await folio.listPayments(f5)).find((x) => x.id === paid5.paymentId);
    say(String(link?.invoice_id ?? '') === issued.invoiceId,
      `один документ у рахунку — платіж називає його (${link?.invoice_id ?? 'порожньо'})`);

    // Два документи — вибір робить людина, не ця функція.
    await folio.addCharges([{
      folioId: f5, reservationId: r5, serviceDate: fx.b.checkIns[2], kind: 'manual',
      description: 'Бар', guestName: null, unitCode: null,
      quantity: 1, unitPriceGross: 200, totalGross: 200, vatRate: 0, source: 'manual',
    }]);
    const second = await folio.issueInvoice({ folioId: f5 });
    const paid6 = await settleFolioPayment({ folioId: f5, amount: 200, method: 'transfer' });
    const link2 = (await folio.listPayments(f5)).find((x) => x.id === paid6.paymentId);
    say(!link2?.invoice_id,
      `два документи в рахунку — платіж не обирає за людину (обрав ${link2?.invoice_id === second.invoiceId ? 'другий' : String(link2?.invoice_id)})`);
  });
} finally {
  if (process.env.DB_DRIVER !== 'postgres') {
    fs.rmSync(process.env.ALISIO_DATA_DIR as string, { recursive: true, force: true });
  }
}

if (fails.length) { console.error(`\npayment-doors: ${fails.length} червоних`); process.exit(1); }
console.log('payment-doors: обидві двері закривають книгу гостя, касу і слово броні однаково');
