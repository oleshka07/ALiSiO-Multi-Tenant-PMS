/**
 * Повтор бронювання з тим самим ключем віддає ТУ САМУ бронь, а не другу і не 409.
 *
 *   node src/modules/widget/api/widget-reserve.idempotency.check.ts
 *
 * ── Що ламалося (INC-046) ───────────────────────────────────────────────
 *
 * `grep -ri idempot src/modules/widget` давав НУЛЬ. Публічний контур: сюди
 * приходить чужий браузер із чужої сторінки, і в нього буває рівно те, що
 * буває в браузерів, — подвійний клік, повтор мережі, кнопка «назад» і ще
 * раз «забронювати». Гість отримував одне з двох:
 *
 *   • **409 «вже заброньовано» на ВЛАСНУ бронь.** Перевірка зайнятості
 *     (`:245`) бачить бронь, яку щойно створив цей самий гість, і чесно
 *     відмовляє. Для гостя це виглядає як «номер зайняли, поки я платив».
 *   • **дві броні** — якщо два запити встигли між перевіркою і вставкою.
 *
 * І третє, дрібніше на вигляд: `r_${Date.now()}_${slot}` — той самий
 * візерунок, за який ми вже заплатили в INC-041 (`ich_${Date.now()}`). Два
 * бронювання в ту саму мілісекунду дістають ОДИН ідентифікатор, тобто друге
 * падає на первинному ключі — 500 гостю замість броні.
 *
 * ── Що стверджує ця сцена ───────────────────────────────────────────────
 *
 * Чотири речі, і третя з них — про ПОРЯДОК кроків, а не про ключ:
 *
 *   1. той самий ключ → та сама бронь, той самий статус, і в базі одна;
 *   2. РІЗНІ ключі на той самий номер і дати → 409 лишається 409: варта не
 *      перестала вартувати (без цього твердження сцена була б зелена і на
 *      коді, який просто прибрав перевірку зайнятості);
 *   3. повтор мережі приходить із ТИМ САМИМ рукостисканням, а воно
 *      одноразове (`DELETE` на `:69`) — тож перевірка повтору мусить стояти
 *      ДО нього, інакше замість броні гість дістане 403 «рукостискання
 *      застаріло»;
 *   4. без ключа від клієнта повтор ІДЕНТИЧНОГО тіла теж не двоїть — ключ
 *      виводиться зі змісту броні; але тіло з ІНШИМ гостем на ті самі дати
 *      лишається 409, а не мовчазним поверненням чужої броні.
 *
 * ── Числа фікстури (інваріант 26) ───────────────────────────────────────
 *
 * Два ключі, два номери, два гості — на кожній осі по два значення. Лічильник
 * броней у базі порівнюється ДО і ПІСЛЯ кожної сцени, і очікуване число
 * несумісне з альтернативним прочитанням: «створили другу» це +2, «віддали ту
 * саму» це +1, і між ними немає спільного значення.
 *
 * ── Червоність доведена на нинішньому коді ──────────────────────────────
 *
 * Сцена 1 падала на `409` замість `201` з текстом
 * `This unit is already booked for the selected dates` — тобто рівно тим
 * симптомом, який описує INC-046: гість дістає відмову на власну бронь.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-widget-idem-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties } = await import('@core/fixtures/two-properties.ts');
const { createWidgetReservation } = await import('./widget-reserve.handlers.ts');

const sql = getSql();
const fx = await seedTwoProperties();

const SITE = '__wri__site';
/** Два номери: «інший ключ на ІНШИЙ номер» і «інший ключ на ТОЙ САМИЙ» — різні твердження. */
const UNIT_1 = fx.a.unitIds[0];
const UNIT_2 = fx.a.unitIds[1];
/** Третій — для сцени про легасі-бандл без ключа. */
const UNIT_3 = fx.a.unitIds[2];
/** Ціна від оператора — щоб сцена була про ключ, а не про цінові таблиці. */
const NIGHT = 1000;

await runWithOrganization(fx.organizationId, async () => {
  await sql.run(
    `INSERT INTO booking_sites (id, organization_id, property_id, name, slug, status)
     VALUES (?, ?, ?, 'Idem', 'idem-site', 'active')`,
    [SITE, fx.organizationId, fx.a.id]);
  for (const unitId of [UNIT_1, UNIT_2, UNIT_3]) {
    await sql.run(
      'INSERT INTO site_listings (id, site_id, unit_id, price_override) VALUES (?, ?, ?, ?)',
      [`${SITE}_l_${unitId}`, SITE, unitId, NIGHT]);
  }
});

/** Рукостискання одноразове: кожен НОВИЙ клік бере своє. */
let handshakeSeq = 0;
const handshake = async (): Promise<string> => {
  const token = `__wri__hs_${++handshakeSeq}`;
  await runWithOrganization(fx.organizationId, async () => {
    await sql.run(
      `INSERT INTO widget_handshakes (token, organization_id, site_id, expires_at)
       VALUES (?, ?, ?, ?)`,
      [token, fx.organizationId, SITE, '2099-01-01T00:00:00Z']);
  });
  return token;
};

/** Запит як його бачить хендлер: тіло, заголовки, і нічого більше. */
const post = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const res = await createWidgetReservation({
    json: async () => body,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
  } as never);
  return { status: res.status, body: await res.json() as any };
};

const stay = (unitId: string, over: Record<string, unknown> = {}) => ({
  unitId,
  checkIn: '2026-12-01',
  checkOut: '2026-12-03',
  adults: 2,
  children: 0,
  firstName: 'Ida',
  lastName: 'Potent',
  email: 'ida@example.test',
  phone: '+420700000001',
  siteId: SITE,
  ...over,
});

const bookings = async () => Number(((await sql.row<any>(
  'SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?', [fx.organizationId])) as any).n);

try {
  // ── 1a. ПОДВІЙНИЙ КЛІК: той самий ключ, СВІЖЕ рукостискання ──────────
  //
  // Так виглядає другий клік по кнопці: віджет бере нове рукостискання і шле
  // те саме тіло. Тут перевіряється сам повтор, без питання про порядок.
  const key = 'idem-key-aaaaaaaaaaaaaaaa';
  let firstBooking: any;
  {
    const before = await bookings();
    firstBooking = await post(stay(UNIT_1), {
      'X-Handshake-Token': await handshake(), 'Idempotency-Key': key });
    assert.strictEqual(firstBooking.status, 201,
      `перша бронь мала пройти: ${JSON.stringify(firstBooking.body)}`);
    assert.ok(firstBooking.body.reservationId, 'перша відповідь без ідентифікатора броні');

    const again = await post(stay(UNIT_1), {
      'X-Handshake-Token': await handshake(), 'Idempotency-Key': key });
    assert.strictEqual(again.status, 201,
      `подвійний клік мав віддати ту саму бронь і той самий статус, а не ${again.status}: `
      + JSON.stringify(again.body));
    assert.strictEqual(again.body.reservationId, firstBooking.body.reservationId,
      'подвійний клік створив ІНШУ бронь');
    assert.strictEqual(again.body.guestPageToken, firstBooking.body.guestPageToken,
      'повтор віддав інший токен гостьової сторінки — це друга бронь під виглядом першої');
    assert.strictEqual(await bookings(), before + 1,
      'у базі мала лишитись ОДНА нова бронь');
  }
  console.log('  ok  подвійний клік → та сама бронь, той самий статус, одна в базі');

  // ── 1b. ПОВТОР МЕРЕЖІ: той самий ключ і ТЕ САМЕ рукостискання ────────
  //
  // Окрема сцена, бо стверджує інше — ПОРЯДОК кроків. Рукостискання
  // одноразове (`DELETE` одразу після перевірки), тож повтор запиту несе
  // токен, якого вже немає. Перевірка повтору, поставлена після
  // рукостискання, тут не спрацювала б ніколи: гість дістав би 403 замість
  // своєї броні. Саме цим і була червона перша редакція сцени.
  {
    const before = await bookings();
    const spent = await handshake();
    const retried = { ...stay(UNIT_2), firstName: 'Nell', lastName: 'Retry' };
    const sent = await post(retried, { 'X-Handshake-Token': spent, 'Idempotency-Key': 'idem-key-dddddddddddddddd' });
    assert.strictEqual(sent.status, 201, `бронь мала пройти: ${JSON.stringify(sent.body)}`);

    const resent = await post(retried, { 'X-Handshake-Token': spent, 'Idempotency-Key': 'idem-key-dddddddddddddddd' });
    assert.strictEqual(resent.status, 201,
      `повтор мережі з витраченим рукостисканням мав віддати ту саму бронь, а не ${resent.status}: `
      + JSON.stringify(resent.body));
    assert.strictEqual(resent.body.reservationId, sent.body.reservationId, 'повтор мережі віддав іншу бронь');
    assert.strictEqual(await bookings(), before + 1, 'повтор мережі створив другу бронь');
  }
  console.log('  ok  повтор мережі з витраченим рукостисканням → та сама бронь (порядок кроків)');

  // ── 2. Інший ключ на той самий номер і дати — 409 лишається 409 ──────
  //
  // Без цього твердження сцена вище була б зелена й на коді, який просто
  // прибрав перевірку зайнятості.
  {
    const before = await bookings();
    const other = await post(stay(UNIT_1), {
      'X-Handshake-Token': await handshake(),
      'Idempotency-Key': 'idem-key-bbbbbbbbbbbbbbbb',
    });
    assert.strictEqual(other.status, 409,
      `інший ключ на зайнятий номер мав дати 409, а не ${other.status}: ${JSON.stringify(other.body)}`);
    assert.strictEqual(await bookings(), before, 'відмова не має лишати броні');
  }
  console.log('  ok  інший ключ на зайняті дати — 409: варта не перестала вартувати');

  // ── 3. Інший ключ на ІНШИЙ номер — звичайна друга бронь ──────────────
  //
  // Дзеркало сцени 2: ключ не має ставати перепоною для гостя, який
  // справді бронює вдруге.
  {
    const before = await bookings();
    const second = await post(stay(UNIT_2, { checkIn: '2027-03-01', checkOut: '2027-03-03' }), {
      'X-Handshake-Token': await handshake(),
      'Idempotency-Key': 'idem-key-cccccccccccccccc',
    });
    assert.strictEqual(second.status, 201, `друга бронь на вільний номер мала пройти: ${JSON.stringify(second.body)}`);
    assert.strictEqual(await bookings(), before + 1, 'друга бронь мала зʼявитись у базі');
  }
  console.log('  ok  інший ключ на вільний номер — звичайна нова бронь');

  // ── 4. Без ключа: ідентичне тіло не двоїть, чуже — не повертається ───
  //
  // Статичний бандл віджета лежить у `public/widget/` зібраним, і браузер
  // тримає його в кеші. Вимагати ключ жорстко означало б відмовляти
  // справжнім бронюванням, поки кеш не оновиться. Тому ключа, якого не
  // прислали, ми не вигадуємо мовчки (інваріант 8) — ми ВИВОДИМО його зі
  // змісту броні і кажемо це словом; повтор ідентичного тіла тоді теж
  // ідемпотентний, а тіло з іншим гостем — інша бронь.
  {
    const legacy = { ...stay(UNIT_3), firstName: 'Old', lastName: 'Bundle' };
    const before = await bookings();

    const first = await post(legacy, { 'X-Handshake-Token': await handshake() });
    assert.strictEqual(first.status, 201, `легасі-бронь мала пройти: ${JSON.stringify(first.body)}`);

    const again = await post(legacy, { 'X-Handshake-Token': await handshake() });
    assert.strictEqual(again.status, 201, `повтор ідентичного тіла мав віддати ту саму бронь, а не ${again.status}`);
    assert.strictEqual(again.body.reservationId, first.body.reservationId,
      'повтор ідентичного тіла без ключа створив ДРУГУ бронь');
    assert.strictEqual(await bookings(), before + 1, 'у базі мала лишитись одна нова бронь');

    // Інший гість на ті самі дати того самого номера — це НЕ повтор.
    const someoneElse = await post(
      { ...legacy, firstName: 'Other', lastName: 'Guest', email: 'other@example.test' },
      { 'X-Handshake-Token': await handshake() });
    assert.strictEqual(someoneElse.status, 409,
      `інший гість на зайнятий номер мав дістати 409, а не ${someoneElse.status}: ${JSON.stringify(someoneElse.body)}`);
    assert.notStrictEqual(someoneElse.body.reservationId, first.body.reservationId,
      'чужий запит дістав ЧУЖУ бронь — виведений ключ не має схлопувати різних гостей');
  }
  console.log('  ok  без ключа: ідентичний повтор — та сама бронь, інший гість — 409');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('widget-reserve.idempotency: повтор віддає ту саму бронь (INC-046)');
