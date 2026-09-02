/**
 * Черга вихідних змін: що змінилося, а не на що.
 *
 *   node src/modules/channels/data/outbox.repo.check.ts
 *
 * ── Чому в черзі немає значень ──────────────────────────────────────────
 *
 * Рядок черги — це координата: «наявність типу X на дату D змінилась», а не
 * «наявність типу X на дату D тепер 3». Поточне число батчер читає з
 * джерела: наявність через `availabilityByDay()`, ціну через `priceNights()`
 * (інваріант 16).
 *
 * Інакше два записи за 40 секунд дали б дві відправки з РІЗНИМИ числами, і
 * яке з них доїде останнім — питання порядку в черзі, а не стану готелю. У
 * канал поїхало б застаріле, і виглядало б це як успіх.
 *
 * Схема це й тримає: колонки під значення тут просто немає.
 *
 * ── Дві смуги, бо так вимагає менеджер каналів ──────────────────────────
 *
 * «At Channex we like to receive updates for Availability and Rate &
 * Restrictions separately… We push these updates to the front of the queue»
 * — наявність має власний швидший шлях, і змішувати її з цінами означає
 * самим собі сповільнити найтерміновіше. Застаріла наявність продає номер,
 * якого немає; застаріла ціна — лише неправильні гроші.
 *
 * ── Осі заселеності в черзі немає, і це не спрощення ────────────────────
 *
 * `POST /restrictions` приймає `rates: [{occupancy, rate}, …]` — усі
 * заселеності одного тарифу за ОДИН виклик (INVENTORY §4.2). Рядок на
 * заселеність дав би втричі більше рядків і жодного зайвого виклику.
 *
 * ── Захоплення: чому не FOR UPDATE SKIP LOCKED ──────────────────────────
 *
 * Він Postgres-only, а розробка й одне завдання CI йдуть на SQLite. Тому
 * `UPDATE … SET claimed_at = ? WHERE … AND claimed_at IS NULL` і читання
 * позначених — працює в обох.
 *
 * Перевірка написана ДО таблиць і **була червоною** (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { enqueueChange, claimBatch, markSent, releaseFailed, pendingCount, queuedChanges, stuckChanges, retryStuck, retireChanges } =
  await import('./outbox.repo.ts');

const sql = getSql();
const A = '__ob_check__a';
const B = '__ob_check__b';

async function cleanup() {
  for (const org of [A, B]) {
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

async function seed(org: string) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
      [`${org}_prop`, org, org, `${org}_prop`]);
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider,
                                   webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [`${org}_conn`, org, `${org}_prop`, 'probe', `tok_${org}`, `sec_${org}`],
    );
  });
}

await cleanup();
await seed(A);
await seed(B);
const CONN = `${A}_conn`;

try {
  // ── Та сама координата двічі — один рядок черги ────────────────────────
  //
  // Готель посунув ціну, передумав і посунув ще раз. Черга каже «ця доба
  // змінилась», а не «змінилась двічі»: значення однаково читається з
  // джерела, тож другий рядок — це зайвий виклик до менеджера каналів із
  // ліміту 10 на хвилину.
  await runWithOrganization(A, async () => {
    await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: 'ut1', ratePlanId: 'rp1', date: '2026-10-10' });
    await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: 'ut1', ratePlanId: 'rp1', date: '2026-10-10' });
    assert.strictEqual(await pendingCount(CONN), 1,
      'та сама координата стала двома рядками — це зайвий виклик із ліміту 10/хв');
    console.log('  ok  повторна зміна тієї самої координати не двоїть чергу');
  });

  // ── Дедуплікацію тримає СХЕМА, а не порядок викликів ──────────────────
  //
  // `enqueueChange` спершу питав «чи є такий рядок», потім вставляв. Між цими
  // двома кроками вміщається другий писач — і дедуплікація існує рівно доти,
  // доки писач один. Це та сама пастка, від якої застерігає коментар у
  // `inbound-bookings.repo.ts`, і я потрапив у неї в сусідньому файлі.
  //
  // Тому вставляємо ПОВЗ функцію, двома прямими INSERT: якщо друга координата
  // лягла, тримає не схема, а везіння.
  await runWithOrganization(A, async () => {
    const direct = (id: string) => sql.run(
      `INSERT INTO cm_outbox (id, organization_id, connection_id, kind, unit_type_id, rate_plan_id, stay_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, A, CONN, 'rate', 'ut_race', 'rp_race', '2026-11-11'],
    );
    await direct('__race_1');
    await assert.rejects(() => direct('__race_2'),
      'друга однакова координата лягла — дедуплікацію тримає не схема, а те, що писач один');
    console.log('  ok  повтор координати відхиляє САМА база, а не порядок викликів');

    // І та сама координата з порожнім тарифом — теж одна. `UNIQUE` не
    // обмежує NULL на жодному двигуні (пастка `price_occupancy`), тож без
    // COALESCE індекс пропустив би скільки завгодно рядків наявності.
    const nullPlan = (id: string) => sql.run(
      `INSERT INTO cm_outbox (id, organization_id, connection_id, kind, unit_type_id, stay_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, A, CONN, 'availability', 'ut_race', '2026-11-11'],
    );
    await nullPlan('__race_3');
    await assert.rejects(() => nullPlan('__race_4'),
      'координата з ПОРОЖНІМ тарифом продублювалась — UNIQUE не обмежує NULL');
    console.log('  ok  порожній тариф у ключі не робить дірку в унікальності');

    await sql.run("DELETE FROM cm_outbox WHERE id LIKE '__race_%'", []);
  });

  // ── Наявність і ціна — різні смуги ────────────────────────────────────
  await runWithOrganization(A, async () => {
    await enqueueChange(sql, CONN, { kind: 'availability', unitTypeId: 'ut1', date: '2026-10-10' });
    assert.strictEqual(await pendingCount(CONN), 2,
      'наявність злилася з ціною — у менеджера каналів це різні черги з різною терміновістю');

    const rates = await claimBatch(CONN, 'rate', 50);
    assert.strictEqual(rates.length, 1, 'захоплення цін узяло не свою смугу');
    assert.strictEqual(rates[0].kind, 'rate');
    assert.strictEqual(await pendingCount(CONN), 1, 'захоплене лишилось у черзі');
    console.log('  ok  наявність і ціни — окремі смуги, захоплюються нарізно');

    // ── Друге захоплення тієї самої смуги не бере вже захоплене ─────────
    //
    // Це і є заміна FOR UPDATE SKIP LOCKED: два батчери не мають надіслати
    // одну зміну двічі й витратити квоту вдвічі.
    assert.deepStrictEqual(await claimBatch(CONN, 'rate', 50), [],
      'другий батчер забрав уже захоплене — подвійна відправка і подвійна витрата ліміту');
    console.log('  ok  двоє батчерів не беруть один рядок');

    // ── Зміна ПІСЛЯ захоплення не ковтається ────────────────────────────
    //
    // Найтонше місце. Рядок уже в польоті зі старим числом; готель міняє
    // ціну ще раз. Злити цю зміну в захоплений рядок означає, що вона не
    // поїде НІКОЛИ — канал лишиться зі старою ціною назавжди, і жодної
    // помилки при цьому не станеться.
    await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: 'ut1', ratePlanId: 'rp1', date: '2026-10-10' });
    assert.strictEqual(await pendingCount(CONN), 2,
      'зміну після захоплення злито в рядок у польоті — вона не поїде ніколи');
    console.log('  ok  зміна після захоплення стає НОВИМ рядком, а не зникає');

    await markSent(rates.map((r) => r.id));
  });

  // ── Невдала відправка повертає рядок у чергу ──────────────────────────
  //
  // Захоплений і незданий рядок інакше лишається захопленим назавжди: зміна
  // не поїде, черга не порожня, і ніхто про це не дізнається.
  await runWithOrganization(A, async () => {
    const batch = await claimBatch(CONN, 'availability', 50);
    assert.strictEqual(batch.length, 1);
    await releaseFailed(batch.map((r) => r.id), 'канал відповів 500');

    // Причина видна, поки рядок чекає; захоплення її стирає (рядок у польоті).
    // Перша версія перевіряла `String(again[0].lastError).length > 0` ПІСЛЯ
    // захоплення — і була зеленою на `String(null)`: вироджене твердження.
    const waiting = (await queuedChanges(CONN)).find((r) => r.kind === 'availability');
    assert.match(String(waiting?.lastError), /500/, 'причина невдачі не названа');
    const again = await claimBatch(CONN, 'availability', 50);
    assert.strictEqual(again.length, 1, 'невдалий рядок не повернувся в чергу — зміна загублена');
    assert.strictEqual(Number(again[0].attempts), 1, 'спроби не рахуються — вічний цикл не видно');
    assert.strictEqual(again[0].lastError, null, 'захоплений рядок причини не несе — вона належала минулій спробі');
    console.log('  ok  невдала відправка повертає рядок і рахує спробу');
  });


  // ── Чуже зʼєднання ────────────────────────────────────────────────────
  await runWithOrganization(B, async () => {
    assert.deepStrictEqual(await claimBatch(CONN, 'rate', 50), [],
      'чужий орендар захопив чергу сусіда — його зміни поїхали б із чужим ключем');
    assert.strictEqual(await pendingCount(CONN), 0, 'чужий орендар побачив чергу сусіда');
    await assert.rejects(
      () => enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: 'x', ratePlanId: 'y', date: '2026-10-10' }),
      'чужий орендар дописав у чергу сусіда');
  });
  await runWithOrganization(A, async () => {
    assert.ok(await pendingCount(CONN) > 0, 'своя черга зникла');
    console.log('  ok  чужа черга не читається, не захоплюється й не поповнюється');
  });

  // ── Порожня черга — порожня пачка, не виняток ─────────────────────────
  await runWithOrganization(B, async () => {
    assert.deepStrictEqual(await claimBatch(`${B}_conn`, 'rate', 50), []);
    assert.strictEqual(await pendingCount(`${B}_conn`), 0);
    console.log('  ok  порожня черга дає порожню пачку');
  });
  // ── Межа спроб: застрягле видно оператору, а не крону ─────────────────
  //
  // Рецензія 01.09.2026: «рядок лишається в черзі» для незмапленого — це
  // нова вічність. Без межі гучна відмова через тиждень така ж тиха, як
  // мовчання: журнал повний однакових рядків, які ніхто не читає. Тому
  // рядок, що впав N разів, більше НЕ захоплюється — він переходить у стан
  // «потребує уваги», який має власний запит, і повертається в чергу лише
  // рукою оператора.
  await runWithOrganization(A, async () => {
    // Хвости попередніх сцен — геть: числа нижче мають бути цієї сцени.
    const leftovers = await claimBatch(CONN, 'rate', 50);
    await markSent(leftovers.map((r) => r.id));

    await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: 'ut9', ratePlanId: 'rp9', date: '2026-12-01' });
    for (let i = 1; i <= 3; i++) {
      const b = await claimBatch(CONN, 'rate', 50, 3);
      assert.strictEqual(b.length, 1, `спроба ${i}: рядок мав бути доступним — межа ще не вичерпана`);
      await releaseFailed(b.map((r) => r.id), `канал відповів 500 (${i})`);
    }
    assert.deepStrictEqual(await claimBatch(CONN, 'rate', 50, 3), [],
      'рядок із вичерпаними спробами знову захоплюється — гучна відмова стала вічною');
    assert.strictEqual(await pendingCount(CONN, 'rate', 3), 0,
      'застряглий рядок рахується як «чекає» — оператор бачить чергу, яка ніколи не порожніє, і не бачить чому');

    const stuck = await stuckChanges(CONN, 3);
    assert.strictEqual(stuck.length, 1, 'застряглий рядок не видно оператору — це та сама тиша, тільки з лічильником');
    assert.strictEqual(stuck[0].attempts, 3);
    assert.match(String(stuck[0].lastError), /500/, 'причина останньої невдачі мусить бути поруч із рядком');
    assert.strictEqual(stuck[0].ratePlanId, 'rp9');
    console.log('  ok  рядок, що впав тричі з трьох, більше не захоплюється і видимий як застряглий');

    // Повернення — рукою, і рівно для цього зʼєднання.
    await retryStuck(CONN, 3);
    assert.deepStrictEqual(await stuckChanges(CONN, 3), [], 'після повернення застряглих не має лишитись');
    const again = await claimBatch(CONN, 'rate', 50, 3);
    assert.strictEqual(again.length, 1, 'повернений оператором рядок мав знову захоплюватись');
    assert.strictEqual(again[0].attempts, 0, 'повернення мусить обнулити лічильник — інакше рядок застрягне на першій же невдачі');
    await markSent(again.map((r) => r.id));
    console.log('  ok  повернення оператором обнуляє спроби, і рядок їде знову');
  });

  // ── Знято з черги без відправлення — третій стан, названий ────────────
  //
  // Минула дата не поїде НІКОЛИ (вендор її не приймає). Повернути — вічне
  // коло; позначити відправленою — брехня в журналі, який існує як доказ
  // «ми це слали». Тому знята координата лишає причину поруч із собою.
  await runWithOrganization(A, async () => {
    await enqueueChange(sql, CONN, { kind: 'availability', unitTypeId: 'ut9', date: '2020-01-01' });
    const b = await claimBatch(CONN, 'availability', 50);
    assert.strictEqual(b.length, 1);
    await retireChanges(b.map((r) => r.id), 'date in the past');

    assert.strictEqual(await pendingCount(CONN, 'availability'), 0, 'знята координата не має чекати');
    assert.deepStrictEqual(await claimBatch(CONN, 'availability', 50), [], 'знята координата знову захопилась');
    assert.deepStrictEqual(await stuckChanges(CONN), [], 'знята — це не застрягла');
    const row = await sql.row<any>('SELECT sent_at, last_error FROM cm_outbox WHERE id = ?', [b[0].id]);
    assert.match(String(row?.last_error), /^retired: date in the past/,
      'рядок, знятий без відправлення, мусить казати це сам — інакше журнал читається як «слали»');
    assert.ok(row?.sent_at, 'знята координата вийшла з черги — і це має бути видно за тим самим полем, за яким черга рахує');
    console.log('  ok  знята координата виходить із черги з названою причиною, а не як «відправлена»');
  });

  // ── Координата, яку нема чим адресувати, в чергу не лягає ─────────────
  //
  // Ціна ночі належить типу номера (тариф лише зсуває), а тариф на тому боці
  // адресується ПАРОЮ тип × тариф (Ц10): один наш тариф на чотирьох типах —
  // чотири їхні. Координата ціни без типу не має чим ні цінуватись, ні
  // адресуватись, і в черзі вона була б рядком, який не поїде ніколи.
  await runWithOrganization(A, async () => {
    await assert.rejects(() => enqueueChange(sql, CONN, { kind: 'rate', ratePlanId: 'rp9', date: '2026-12-02' }),
      'координата ціни без типу номера лягла в чергу — її нема чим цінувати й нема куди адресувати (Ц10)');
    await assert.rejects(() => enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: 'ut9', date: '2026-12-02' }),
      'координата ціни без тарифу лягла в чергу');
    await assert.rejects(() => enqueueChange(sql, CONN, { kind: 'availability', date: '2026-12-02' }),
      'координата наявності без типу номера лягла в чергу');
    console.log('  ok  координата без адресата відхиляється на вході, а не крутиться в черзі');
  });


  // ── Координата може бути ДІАПАЗОНОМ дат (Ц13 → форма, Ц15) ────────────
  //
  // Один запис матриці цін без дат — це «кожна майбутня ніч». Подобово це
  // тисячі рядків на кожне зʼєднання за одну правку в екрані; діапазон —
  // один. Безпечно саме тому, що черга тримає координату, а не значення:
  // два діапазони, що перекриваються, розвʼязуються з одного джерела в один
  // момент і дають однакове число — надлишок, ніколи не розходження.
  await runWithOrganization(A, async () => {
    const leftovers = await claimBatch(CONN, 'rate', 50);
    await markSent(leftovers.map((r) => r.id));

    const range = { kind: 'rate' as const, unitTypeId: 'utR', ratePlanId: 'rpR', date: '2027-01-01', dateTo: '2027-12-31' };
    await enqueueChange(sql, CONN, range);
    await enqueueChange(sql, CONN, range);
    assert.strictEqual(await pendingCount(CONN, 'rate'), 1, 'той самий діапазон двічі — один рядок, як і та сама дата');

    const b = await claimBatch(CONN, 'rate', 50);
    assert.strictEqual(b.length, 1);
    assert.strictEqual(b[0].date, '2027-01-01');
    assert.strictEqual(b[0].dateTo, '2027-12-31', 'кінець діапазону не дійшов до батчера — поїде одна ніч із трьохсот');
    await markSent(b.map((r) => r.id));

    // Один день — без кінця; батчер читає це як «та сама дата».
    await enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: 'utR', ratePlanId: 'rpR', date: '2027-03-01' });
    const one = await claimBatch(CONN, 'rate', 50);
    assert.strictEqual(one[0].dateTo, null, 'одноденна координата не має кінця');
    await markSent(one.map((r) => r.id));

    await assert.rejects(
      () => enqueueChange(sql, CONN, { kind: 'rate', unitTypeId: 'utR', ratePlanId: 'rpR', date: '2027-02-01', dateTo: '2027-01-01' }),
      'кінець раніше за початок ліг у чергу — такий рядок не розкладеться на жодну дату й не поїде ніколи');
    console.log('  ok  діапазон — один рядок, кінець доходить до батчера, навиворіт не лягає');
  });

  // ── Транспортна невдача не рахує спроби ────────────────────────────────
  await runWithOrganization(A, async () => {
    await enqueueChange(sql, CONN, { kind: 'availability', unitTypeId: 'utT', date: '2027-04-01' });
    const b = await claimBatch(CONN, 'availability', 50);
    await releaseFailed(b.map((r) => r.id), 'throttled: window', true);
    // Причина читається, поки рядок ЧЕКАЄ: захоплення її стирає, бо рядок
    // уже в польоті з новою спробою.
    const waiting = (await queuedChanges(CONN)).find((r) => r.unitTypeId === 'utT');
    assert.match(String(waiting?.lastError), /throttled/, 'а причина все одно лягає на рядок — оператор бачить, ЧОМУ стоїть');
    const again = await claimBatch(CONN, 'availability', 50);
    assert.strictEqual(again.length, 1);
    assert.strictEqual(again[0].attempts, 0, 'простій чи пауза — причина проходу, не рядка: лічильник не рухається');
    await releaseFailed(again.map((r) => r.id), 'validation: rate must be > 0');
    const third = await claimBatch(CONN, 'availability', 50);
    assert.strictEqual(third[0].attempts, 1, 'відповідь вендора про значення — спроба рядка');
    await markSent(third.map((r) => r.id));
    console.log('  ok  транспортна невдача лишає лічильник, претензія вендора рахує');
  });
} finally {
  await cleanup();
}

console.log('outbox: черга тримає координати, смуги окремі, захоплене не двоїться');
