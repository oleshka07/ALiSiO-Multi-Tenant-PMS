/**
 * Фоліо — ЄДИНА книга проживання (В3, рішення власника 07.09).
 *
 *   node src/modules/bookings/data/folio-book.check.ts
 *
 * Дві сцени, які мусять дати ОДНАКОВИЙ результат, бо для готелю це одне й те
 * саме: гість заплатив 3000 наперед із 5000, решту доплатить на виселенні.
 * Різниця лише в тому, куди рецепція клацнула:
 *
 *   А — «Оплата» на вкладці Фінанси картки (гроші лягають у фоліо);
 *   Б — «Прийняти оплату» готівкою (гроші лягають у фінансову операцію).
 *
 * Сьогодні друга не проходить, і саме через це власник відкрив В3: дві книги,
 * які не знають одна про одну, дали видиму розбіжність — бронь, оплачена
 * половиною, у фільтр «частково» не потрапляє, а бронь зі станом `partial`
 * показує на виселенні ПОВНИЙ борг замість решти.
 *
 * Три числа звіряються, і кожне — те, що бачить людина:
 *   1. `payment_status` броні (його читає фільтр списку і варта заселення);
 *   2. борг на виселенні (`decideCheckout` — те саме число, що на екрані);
 *   3. чи бронь у фільтрі «частково».
 *
 * Осі (інваріант 26). Сума НЕ ділиться навпіл: 3000 із 5000, тож «половина»,
 * «уся сума» і «решта» — три різні числа (3000 / 5000 / 2000), і жодне
 * альтернативне прочитання не збігається з очікуваним. Політика виселення
 * взята `blocking`, бо на `none` борг не дивляться взагалі й твердження 2
 * було б беззмістовним.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { openFolio: createFolio, addCharges } = await import('@invoicing/kernel');
const { recordPayment, reservationFolioSummary } = await import('@invoicing/kernel');
const { decideCheckout } = await import('./checkout.repo.ts');
const { statusFromFolio } = await import('../domain/folio-payment.ts');
const { createPaymentOperation } = await import('../../finance/api/payment-bridge.ts');

const sql = getSql();
const ORG = '__folbook__org';
const TOTAL = 5000;
const PREPAID = 3000;
const REST = TOTAL - PREPAID;   // 2000 — і це не половина від 5000

async function cleanup() {
  // Прибирає КАСКАД від організації: `fin_folios`, `fin_folio_items`,
  // `fin_folio_payments`, `fin_operations`, `finance_accounts` — усі висять на
  // `organizations(id) ON DELETE CASCADE`. Свій SQL до чужих таблиць тут був би
  // пробоєм межі (`check-boundaries`), і гейт це одразу й сказав: сцена
  // модуля bookings не має права ходити в таблиці invoicing навіть на
  // прибиранні.
  await sql.run("DELETE FROM reservations WHERE id LIKE '__folbook__%'", []);
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')",
  [ORG, 'Folio book', 'folbook']);

const PROP = '__folbook__prop';

/** Бронь на 5000 із фоліо, у якому нараховано проживання на всю суму. */
async function seedStay(id: string): Promise<string> {
  await sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency)
     VALUES (?, ?, ?, ?, ?, '2026-11-02', '2026-11-04', 2, 2, 'checked_in', 'unpaid', ?, 'CZK')`,
    [id, ORG, PROP, '__folbook__unit', '__folbook__guest', TOTAL]);
  const folioId = await createFolio({ reservationId: id, payerKind: 'guest', payerName: 'Eva Nová' });
  await addCharges([{
    folioId, reservationId: id, serviceDate: '2026-11-02', kind: 'lodging',
    description: 'Проживання', quantity: 2, unitPriceGross: TOTAL / 2, totalGross: TOTAL, vatRate: 12,
  }]);
  return folioId;
}

/** Те, що бачить людина: слово броні, борг на виселенні, попадання у фільтр. */
async function asSeen(id: string) {
  const row = await sql.row<any>('SELECT payment_status, total_price FROM reservations WHERE id = ?', [id]);
  const decision = await decideCheckout(sql, {
    organizationId: ORG, propertyId: PROP, reservationId: id,
    paymentStatus: row.payment_status, totalPrice: Number(row.total_price),
  });
  const inFilter = await sql.row<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reservations WHERE id = ? AND payment_status = 'partial'", [id]);
  return {
    status: String(row.payment_status),
    owed: decision === 'not_found' ? 'not_found' : decision.balance,
    allowed: decision === 'not_found' ? null : decision.allowed,
    inPartialFilter: Number(inFilter?.n) === 1,
  };
}

const fails: string[] = [];
try {
  await runWithOrganization(ORG, async () => {
    await sql.run(
      "INSERT INTO properties (id, organization_id, name, slug, country, checkout_balance_policy) VALUES (?, ?, 'House', 'folbook', 'CZ', 'blocking')",
      [PROP, ORG]);
    await sql.run("INSERT INTO categories (id, property_id, name, type) VALUES ('__folbook__cat', ?, 'Rooms', 'resort')", [PROP]);
    await sql.run("INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES ('__folbook__ut', ?, '__folbook__cat', 'Double', 'DBL')", [PROP]);
    await sql.run("INSERT INTO units (id, unit_type_id, property_id, category_id, name, code) VALUES ('__folbook__unit', '__folbook__ut', ?, '__folbook__cat', '101', '101')", [PROP]);
    await sql.run("INSERT INTO guests (id, organization_id, first_name, last_name) VALUES ('__folbook__guest', ?, 'Eva', 'Nová')", [ORG]);
    // Каса готелю. Без жодного рядка тут `createPaymentOperation` кидає
    // «income requires account_to_id», і сцена доводила б прогалину засіву
    // (`provision-org.mjs` рахунків не створює — передано у звіті), а не те,
    // про що вона написана.
    await sql.run(
      "INSERT INTO finance_accounts (id, organization_id, name, type, currency) VALUES ('__folbook__acc', ?, 'Каса', 'cash', 'CZK')",
      [ORG]);

    // ── СЦЕНА А: 3000 наперед ЧЕРЕЗ ФОЛІО ────────────────────────────────
    const a = '__folbook__a';
    const folioA = await seedStay(a);
    await recordPayment({ folioId: folioA, amount: PREPAID, method: 'cash' });
    // Той самий перерахунок, що робить картка після оплати.
    const summaryA = await reservationFolioSummary(a);
    const wordA = statusFromFolio(summaryA);
    if (wordA) await sql.run('UPDATE reservations SET payment_status = ? WHERE id = ?', [wordA, a]);
    const seenA = await asSeen(a);
    console.log('  А (через фоліо):', JSON.stringify(seenA));

    // ── СЦЕНА Б: 3000 наперед ЧЕРЕЗ КАСУ ─────────────────────────────────
    const b = '__folbook__b';
    await seedStay(b);
    await createPaymentOperation({
      reservationId: b, amount: PREPAID, method: 'cash',
      paymentSubtype: 'deposit', source: 'manual', status: 'completed',
    });
    const seenB = await asSeen(b);
    console.log('  Б (через касу):  ', JSON.stringify(seenB));

    // ── Твердження ───────────────────────────────────────────────────────
    const say = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

    say(seenA.status === 'partial', `А: слово броні «${seenA.status}», а заплачено частину — має бути partial`);
    say(seenA.owed === REST, `А: на виселенні борг ${seenA.owed}, а лишилось ${REST}`);
    say(seenA.inPartialFilter, 'А: броні немає у фільтрі «частково»');

    say(seenB.status === 'partial', `Б: слово броні «${seenB.status}», а заплачено частину — має бути partial`);
    say(seenB.owed === REST, `Б: на виселенні борг ${seenB.owed}, а лишилось ${REST} — каса не потрапила у фоліо`);
    say(seenB.inPartialFilter, 'Б: броні немає у фільтрі «частково»');

    say(seenA.status === seenB.status && seenA.owed === seenB.owed
        && seenA.inPartialFilter === seenB.inPartialFilter && seenA.allowed === seenB.allowed,
      `дві книги розійшлися: через фоліо ${JSON.stringify(seenA)}, через касу ${JSON.stringify(seenB)}`);

    // Альтернативні прочитання, з якими 2000 не збігається (інваріант 26).
    say(seenA.owed !== TOTAL, 'А: борг дорівнює ВСІЙ сумі — це «статус partial → винен усе», а не рахунок');
    say(seenA.owed !== PREPAID, 'А: борг дорівнює ВНЕСКУ — переплутано сплачене з боргом');

    // Виселення з боргом під `blocking` — відмова, і в обох сценах однаково.
    say(seenA.allowed === false && seenB.allowed === false,
      'виселення з боргом мало бути відмовлене політикою blocking');

    // ── Доплата решти закриває бронь, теж однаково ───────────────────────
    await recordPayment({ folioId: folioA, amount: REST, method: 'cash' });
    const closedA = statusFromFolio(await reservationFolioSummary(a));
    if (closedA) await sql.run('UPDATE reservations SET payment_status = ? WHERE id = ?', [closedA, a]);
    const finalA = await asSeen(a);
    say(finalA.status === 'paid' && finalA.owed === 0 && finalA.allowed === true,
      `А: після доплати ${JSON.stringify(finalA)} — мало бути paid, борг 0, виселення дозволене`);
    console.log('  А після доплати:', JSON.stringify(finalA));
  });
} finally {
  await cleanup();
}

if (fails.length) {
  console.log(`\nfolio-book: ${fails.length} червоних`);
  for (const f of fails) console.log(`  ЧЕРВОНЕ  ${f}`);
  process.exit(1);
}
console.log('\nfolio-book: фоліо і каса дають ОДИН стан броні, один борг на виселенні й одне попадання у фільтр');
