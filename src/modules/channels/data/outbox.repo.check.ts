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
const { enqueueChange, claimBatch, markSent, releaseFailed, pendingCount } =
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
    await enqueueChange(CONN, { kind: 'rate', unitTypeId: 'ut1', ratePlanId: 'rp1', date: '2026-10-10' });
    await enqueueChange(CONN, { kind: 'rate', unitTypeId: 'ut1', ratePlanId: 'rp1', date: '2026-10-10' });
    assert.strictEqual(await pendingCount(CONN), 1,
      'та сама координата стала двома рядками — це зайвий виклик із ліміту 10/хв');
    console.log('  ok  повторна зміна тієї самої координати не двоїть чергу');
  });

  // ── Наявність і ціна — різні смуги ────────────────────────────────────
  await runWithOrganization(A, async () => {
    await enqueueChange(CONN, { kind: 'availability', unitTypeId: 'ut1', date: '2026-10-10' });
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
    await enqueueChange(CONN, { kind: 'rate', unitTypeId: 'ut1', ratePlanId: 'rp1', date: '2026-10-10' });
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

    const again = await claimBatch(CONN, 'availability', 50);
    assert.strictEqual(again.length, 1, 'невдалий рядок не повернувся в чергу — зміна загублена');
    assert.strictEqual(Number(again[0].attempts), 1, 'спроби не рахуються — вічний цикл не видно');
    assert.ok(String(again[0].lastError).length > 0, 'причина невдачі не названа');
    console.log('  ok  невдала відправка повертає рядок і рахує спробу');
  });

  // ── Чуже зʼєднання ────────────────────────────────────────────────────
  await runWithOrganization(B, async () => {
    assert.deepStrictEqual(await claimBatch(CONN, 'rate', 50), [],
      'чужий орендар захопив чергу сусіда — його зміни поїхали б із чужим ключем');
    assert.strictEqual(await pendingCount(CONN), 0, 'чужий орендар побачив чергу сусіда');
    await assert.rejects(
      () => enqueueChange(CONN, { kind: 'rate', unitTypeId: 'x', date: '2026-10-10' }),
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
} finally {
  await cleanup();
}

console.log('outbox: черга тримає координати, смуги окремі, захоплене не двоїться');
