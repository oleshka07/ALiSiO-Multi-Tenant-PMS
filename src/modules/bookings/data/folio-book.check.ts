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
 * Сцена ганяється і на СПРАВЖНЬОМУ Postgres (AGENTS §7), не лише на SQLite:
 *
 *   DB_DRIVER=postgres DATABASE_URL=… node src/modules/bookings/data/folio-book.check.ts
 *
 * Це не формальність. На SQLite зовнішні ключі не перевіряються, тож рядок
 * `fin_operations` висів на статті `ec_accommodation`, якої в цій організації
 * не існувало — сцена була зелена на базі, де половина її ж даних не звʼязана.
 * На Postgres вона падала цілком. Тому стаття тепер сіється явно.
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
const { recalcPaymentStatusFromFolio } = await import('./payment-status.repo.ts');
const { createPaymentOperation, deletePaymentOperation } = await import('../../finance/api/payment-bridge.ts');
// Ручна проводка у Фінансах — тим самим писачем, яким її заводить екран
// операцій, а не своїм INSERT: сцена має тиснути на живий шлях (урок Р8.10).
const { createOperationInTx } = await import('../../finance/api/operations.handlers.ts');

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
  //
  // Броні знімаються В КОНТЕКСТІ ОРЕНДАРЯ, і це не косметика (INC-014).
  // `reservations` під політикою; без контексту `DELETE` не бачить жодного
  // рядка й прибирає НУЛЬ — мовчки, бо «нічого не видалено» це не помилка. А
  // ключ `fk_reservations_organization_id_4` НЕ каскадний, тож наступний
  // `DELETE FROM organizations` падає, і падає не там, де причина.
  //
  // На SQLite і під суперкористувачем цього не видно: політик там немає, тож
  // прибирання «працювало» рівно тому, що обходило їх. Побачив це CI після
  // того, як `check:pg` перевели на роль застосунку.
  await runWithOrganization(ORG, async () => {
    await sql.run("DELETE FROM reservations WHERE id LIKE '__folbook__%'", []);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await cleanup();
await sql.run("INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, 'CZK')",
  [ORG, 'Folio book', 'folbook']);

const PROP = '__folbook__prop';

/**
 * Бронь на 5000 із фоліо, у якому нараховано проживання на всю суму.
 *
 * Ночі — СВОЇ в кожної броні, а не одні спільні на всіх. Раніше всі стояли в
 * одному номері на 2–4 листопада, тобто засів описував стан, якого не буває:
 * четверо гостей у одній кімнаті на ті самі ночі. Це нікому не заважало рівно
 * доти, доки заборону тримала лише уважність коду; обмеження
 * `no_double_booking` (INC-045) відмовило на другій броні першим же прогоном
 * `check:pg`. Сцена про ФОЛІО — номер і дати їй байдужі, важлива лише сума, —
 * тож виправлено засів, а не обмеження.
 *
 * Вікна суміжні й не перетинаються: [02,04), [04,06), … — виїзд і заїзд в один
 * день це не та сама ніч. Номер лишається один: на нього є ЗОВНІШНІЙ КЛЮЧ, і
 * вигаданий `${id}_unit` упав би на `fk_reservations_unit_id`.
 */
let stayNo = 0;
/** Наступне вільне вікно з двох ночей: 11-02, 11-04, 11-06 … */
function nextWindow(): { checkIn: string; checkOut: string } {
  const day = 2 + stayNo++ * 2;
  const dd = (n: number) => String(n).padStart(2, '0');
  return { checkIn: `2026-11-${dd(day)}`, checkOut: `2026-11-${dd(day + 2)}` };
}
async function seedStay(id: string): Promise<string> {
  const { checkIn, checkOut } = nextWindow();
  await sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, 2, 2, 'checked_in', 'unpaid', ?, 'CZK')`,
    [id, ORG, PROP, '__folbook__unit', '__folbook__guest', checkIn, checkOut, TOTAL]);
  const folioId = await createFolio({ reservationId: id, payerKind: 'guest', payerName: 'Eva Nová' });
  await addCharges([{
    folioId, reservationId: id, serviceDate: checkIn, kind: 'lodging',
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
    // Стаття, на яку `createPaymentOperation` вішає готівку. Організація тут
    // зроблена руками, тож типових статей у неї немає — а на Postgres це
    // ЗОВНІШНІЙ КЛЮЧ, і сцена падала цілком. На SQLite ключі не перевіряються,
    // тож гейт був зелений і на базі, де рядок висів у порожнечі.
    //
    // Ідентифікатор ВЛАСНИЙ, а стала величина — `code` (INC-025/INC-028). Тут
    // стояв літеральний `'ec_accommodation'` із `ON CONFLICT DO NOTHING`, тобто
    // фікстура сама відтворювала ваду, від якої лікувались: на базі з іншим
    // готелем стаття належала ЙОМУ, а сцена тихо працювала на чужому рядку.
    // Після переходу на резолвер за кодом вона ще й перестала знаходитись —
    // `requireCategory` відмовив названо, і саме так ця стара фікстура впала.
    await sql.run(
      `INSERT INTO expense_categories (id, organization_id, code, name, std_group, pnl_line)
       VALUES ('__folbook__ec', ?, 'accommodation', 'Accommodation', 'Revenue', 'Accommodation')`,
      [ORG]);

    // ── СЦЕНА А: 3000 наперед ЧЕРЕЗ ФОЛІО ────────────────────────────────
    const a = '__folbook__a';
    const folioA = await seedStay(a);
    await recordPayment({ folioId: folioA, amount: PREPAID, method: 'cash' });
    // Той самий перерахунок, у який упирається картка, — не свій UPDATE поруч.
    // Доти сцена рахувала слово сама (`statusFromFolio` + `UPDATE`), тобто
    // повторювала логіку писача замість того, щоб її перевіряти: зламати
    // `recalcPaymentStatusFromFolio` можна було, лишивши сцену зеленою.
    await recalcPaymentStatusFromFolio(a);
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

    // ── СЦЕНА В: ПОРОЖНЄ фоліо і борг ──────────────────────────────────
    //
    // Фоліо існує, але в ньому НІЧОГО: ні нарахувань, ні оплат. Так буває
    // щоразу, коли `ensureReservationFolio` завело книгу, а записати в неї
    // платіж не вдалося (сцена Г нижче) — і так буває, коли рецепція
    // відкрила вкладку «Фінанси» й нічого не нарахувала.
    //
    // `reservationBalance` каже `hasFolio: true` від самої НАЯВНОСТІ рядка,
    // тож борг виходить 0, і боржник із `unpaid` на 5000 виходить у двері під
    // політикою `blocking`. Порожня книга не каже «нічого не винен» — вона не
    // каже нічого, і це різні речі.
    const c = '__folbook__c';
    const winC = nextWindow();
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, 2, 2, 'checked_in', 'unpaid', ?, 'CZK')`,
      [c, ORG, PROP, '__folbook__unit', '__folbook__guest', winC.checkIn, winC.checkOut, TOTAL]);
    await createFolio({ reservationId: c, payerKind: 'guest', payerName: 'Eva Nová' });
    const seenC = await asSeen(c);
    console.log('  В (порожнє фоліо):', JSON.stringify(seenC));
    say(seenC.allowed === false,
      `В: боржник із порожнім фоліо ВИХОДИТЬ у двері під blocking (борг показано ${seenC.owed})`);
    say(seenC.owed === TOTAL,
      `В: борг показано ${seenC.owed}, а не сплачено нічого з ${TOTAL} — порожня книга не означає «нічого не винен»`);

    // ── СЦЕНА Г: німецький обʼєкт без TSE ──────────────────────────────
    //
    // `recordPayment` для DE без `fiscal_de` ВІДМОВЛЯЄ навмисно: готівка й
    // термінал там досі в старій касі, поки не ввімкнено фіскальний модуль.
    // Місток це проковтував (`catch` із самим `console.error`), і виходило
    // найгірше з обох: гроші лишались лише в `fin_operations`, фоліо
    // лишалось ПОРОЖНІМ — а порожнє фоліо (сцена В) відчиняє виселення.
    const DE_PROP = '__folbook__de';
    await sql.run(
      "INSERT INTO properties (id, organization_id, name, slug, country, checkout_balance_policy) VALUES (?, ?, 'Haus', 'folbook-de', 'DE', 'blocking')",
      [DE_PROP, ORG]);
    await sql.run("INSERT INTO categories (id, property_id, name, type) VALUES ('__folbook__decat', ?, 'Zimmer', 'resort')", [DE_PROP]);
    await sql.run("INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES ('__folbook__deut', ?, '__folbook__decat', 'Doppel', 'DBL')", [DE_PROP]);
    await sql.run("INSERT INTO units (id, unit_type_id, property_id, category_id, name, code) VALUES ('__folbook__deunit', '__folbook__deut', ?, '__folbook__decat', '201', '201')", [DE_PROP]);
    const d = '__folbook__d';
    await sql.run(
      `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, status, payment_status, total_price, currency)
       VALUES (?, ?, ?, ?, ?, '2026-11-02', '2026-11-04', 2, 2, 'checked_in', 'unpaid', ?, 'CZK')`,
      [d, ORG, DE_PROP, '__folbook__deunit', '__folbook__guest', TOTAL]);
    await createPaymentOperation({
      reservationId: d, amount: PREPAID, method: 'cash',
      paymentSubtype: 'deposit', source: 'manual', status: 'completed',
    }).catch((e: any) => { console.log('  Г: місток відмовив:', e.message.slice(0, 60)); });

    // Скільки книг завела бронь — через ФАСАД, не своїм SQL до `fin_folios`:
    // гейт меж це вже ловив на прибиранні цієї ж сцени.
    const deFolios = { n: (await reservationFolioSummary(d)).folios.length };
    const seenD = await sql.row<any>('SELECT payment_status, total_price FROM reservations WHERE id = ?', [d]);
    const decisionD = await decideCheckout(sql, {
      organizationId: ORG, propertyId: DE_PROP, reservationId: d,
      paymentStatus: seenD.payment_status, totalPrice: Number(seenD.total_price),
    });
    const allowedD = decisionD === 'not_found' ? null : decisionD.allowed;
    console.log(`  Г (DE без TSE):    фоліо ${Number(deFolios?.n)}, статус ${seenD.payment_status}, виселення дозволене: ${allowedD}`);
    say(allowedD === false,
      'Г: німецький готель без TSE — боржник ВИХОДИТЬ у двері, бо по собі лишилось порожнє фоліо');
    say(Number(deFolios?.n) === 0,
      `Г: по відмові фіскальної варти лишилось ${Number(deFolios?.n)} порожнє(і) фоліо — книга, у якій нічого немає і ніколи не буде`);
    // Відмова мусить ДОХОДИТИ до оператора названою, а не лягати в лог: для
    // цілого сегмента (DE без TSE) це постійний стан, а не рідкісний збій, і
    // мовчазне розходження книг неприпустиме (інваріант 13).
    const deReport = await createPaymentOperation({
      reservationId: d, amount: 100, method: 'cash',
      paymentSubtype: 'partial', source: 'manual', status: 'completed',
    }).catch(() => null);
    say(deReport != null && deReport.folioRecorded === false && Boolean(deReport.folioRefusal),
      `Г: місток не сказав, що фоліо відмовило — оператор бачить 201 і не знає нічого (${JSON.stringify(deReport)})`);

    // ── СЦЕНА Д: видалення платежу не лишає грошей у книзі ───────────────
    //
    // `fin_folio_payments` не має видалення ЗА ЗАДУМОМ: помилковий клік
    // виправляється зустрічним рядком. Але видалення операції в Фінансах
    // чистило лише `fin_operations`, а перерахунок читав фоліо, бачив там
    // гроші й лишав слово `paid`. Стан «гроші є в одній книзі й немає в
    // іншій» виникав із нормальної дії оператора, не з падіння.
    const e = '__folbook__e';
    await seedStay(e);
    const opE = await createPaymentOperation({
      reservationId: e, amount: TOTAL, method: 'cash',
      paymentSubtype: 'full', source: 'manual', status: 'completed',
    });
    const paidE = await asSeen(e);
    say(paidE.status === 'paid', `Д: після повної оплати слово «${paidE.status}», мало бути paid`);
    await deletePaymentOperation(opE.operationId);
    const afterDelE = await asSeen(e);
    const folioE = (await reservationFolioSummary(e)).totals;
    console.log('  Д (видалення):    ', JSON.stringify(afterDelE), 'фоліо:', JSON.stringify(folioE));
    say(Number(folioE.paid) === 0,
      `Д: у фоліо лишилось ${folioE.paid} після видалення платежу — гроші є в одній книзі й немає в іншій`);
    say(afterDelE.status !== 'paid',
      `Д: слово лишилось «${afterDelE.status}» після видалення платежу`);
    say(afterDelE.owed === TOTAL,
      `Д: борг ${afterDelE.owed}, а нараховано ${TOTAL} і нічого не сплачено`);

    // ── СЦЕНА Ж: видалення РУЧНОЇ проводки не чіпає книгу гостя (Р10.6) ──
    //
    // Пара мусить бути симетричною: створення ручної проводки у Фінансах у
    // фоліо нічого не додає (Д21) — отже, її видалення звідти нічого й не
    // знімає. Доти реверс знімав із фоліо БУДЬ-ЯКИЙ дохід із `reservation_id`,
    // а відрізнити свій платіж від чужого було нічим: `source` не розрізняє,
    // місток теж пише 'manual'.
    //
    // Числа навмисно всі різні (інваріант 26): нараховано 5000, гість заплатив
    // 3000, бухгалтер помилково завів 1200, лишилось 2000. Якщо діра є —
    // у фоліо стане 1800, борг 3200; жодне з цих чисел не збігається з
    // очікуваними 3000 і 2000.
    const WRONG_ENTRY = 1200;
    const g = '__folbook__g';
    await seedStay(g);
    await createPaymentOperation({
      reservationId: g, amount: PREPAID, method: 'cash',
      paymentSubtype: 'deposit', source: 'manual', status: 'completed',
    });
    const beforeManual = await asSeen(g);
    say(beforeManual.owed === REST,
      `Ж: до ручної проводки борг ${beforeManual.owed}, мав бути ${REST}`);
    // Ручна проводка бухгалтера: дохід по броні, заведений у Фінансах. У книгу
    // гостя вона НЕ пише — це проводка обліку, не платіж гостя (Д21).
    const manualId = await createOperationInTx(ORG, {
      op_type: 'income',
      account_to_id: '__folbook__acc',
      amount: WRONG_ENTRY,
      currency: 'CZK',
      paid_at: '2026-11-03',
      category_id: '__folbook__ec',
      reservation_id: g,
      status: 'completed',
      comment: 'помилкова ручна проводка',
    }, null);
    const afterManual = (await reservationFolioSummary(g)).totals;
    say(Number(afterManual.paid) === PREPAID,
      `Ж: ручна проводка ЗМІНИЛА книгу гостя (${afterManual.paid} замість ${PREPAID}) — а вона туди не пише`);

    await deletePaymentOperation(manualId);
    const afterManualDel = await asSeen(g);
    const folioG = (await reservationFolioSummary(g)).totals;
    console.log('  Ж (ручна проводка):', JSON.stringify(afterManualDel), 'фоліо:', JSON.stringify(folioG));
    say(Number(folioG.paid) === PREPAID,
      `Ж: видалення ручної проводки забрало з книги гостя чужі гроші — у фоліо ${folioG.paid}, мало лишитись ${PREPAID}`);
    say(afterManualDel.owed === REST,
      `Ж: борг на виселенні ${afterManualDel.owed}, мав лишитись ${REST} — гість не винен нічого понад решту`);
    say(afterManualDel.status === 'partial',
      `Ж: слово «${afterManualDel.status}», мало лишитись partial`);

    // Виселення з боргом під `blocking` — відмова, і в обох сценах однаково.
    say(seenA.allowed === false && seenB.allowed === false,
      'виселення з боргом мало бути відмовлене політикою blocking');

    // ── Доплата решти закриває бронь, теж однаково ───────────────────────
    await recordPayment({ folioId: folioA, amount: REST, method: 'cash' });
    await recalcPaymentStatusFromFolio(a);
    const finalA = await asSeen(a);
    say(finalA.status === 'paid' && finalA.owed === 0 && finalA.allowed === true,
      `А: після доплати ${JSON.stringify(finalA)} — мало бути paid, борг 0, виселення дозволене`);
    console.log('  А після доплати:', JSON.stringify(finalA));
  });
} finally {
  await cleanup();
}

// ── Продакшн-картка, а не її переказ у гейті (Р8.10) ─────────────────────
//
// Сцена А кличе спільний перерахунок — але картка рахує слово У БРАУЗЕРІ й
// шле його PATCH-ом, тож повернути `FolioPanel` до «завжди paid» можна було,
// лишивши всі сцени вище зеленими. Тому — твердження про сам файл картки, як
// у `price-calendar.repo.check`: тіло PATCH будується зі `statusFromFolio`, і
// слово там не зашите літералом.
{
  const fs = await import('node:fs');
  const card = fs.readFileSync('src/components/booking/card/FolioPanel.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p1: string) => p1 + ' '.repeat(m.length - p1.length));
  const say = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };
  say(/const\s+word\s*=\s*statusFromFolio\(/.test(card),
    'картка більше не рахує слово через statusFromFolio — гейт про це мовчав би');
  say(/payment_status:\s*word\b/.test(card),
    'картка шле PATCH не тим словом, яке порахувала');
  say(!/payment_status:\s*'(paid|partial|unpaid)'/.test(card),
    'у картці зашите слово статусу літералом — саме так виглядала стара поведінка');
}

if (fails.length) {
  console.log(`\nfolio-book: ${fails.length} червоних`);
  for (const f of fails) console.log(`  ЧЕРВОНЕ  ${f}`);
  process.exit(1);
}
console.log('\nfolio-book: фоліо і каса дають ОДИН стан броні, один борг на виселенні й одне попадання у фільтр');
