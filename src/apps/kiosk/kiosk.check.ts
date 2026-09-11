/**
 * Термінал у холі робить рівно те, що йому дозволено, — і нічого поруч.
 *
 *   node src/apps/kiosk/kiosk.check.ts
 *   DB_DRIVER=postgres DATABASE_URL=… node src/apps/kiosk/kiosk.check.ts
 *
 * Частина А блоку (docs/tasks/2026-09-10-block-kiosk.md §3.4): особа
 * пристрою, політика заселення, призначення номера, підпис, код скриньки,
 * журнал. Екранні сцени (вікно ±1 день, два чинники пошуку, таймер
 * бездіяльності, лист за `system_of_record`) — частини Б і В; вони названі
 * в звіті, а не мовчки пропущені.
 *
 * ── Осі (інваріант 26) ──────────────────────────────────────────────────
 *
 * ДВА готелі: A (застосунок увімкнено) і B (вимкнено) — щоб «чужий» і
 * «вимкнений» були різними відмовами, а не однією. У A — ДВА обʼєкти
 * (головний і сусідній), щоб вісь будинку перевірялась усередині одного
 * рахунку: термінал у холі корпусу 1 не мусить знаходити бронь корпусу 2,
 * і саме це не ловить жодна перевірка орендаря (INC-029).
 *
 * Далі кожне твердження — двома боками:
 *
 *   політика оплати   `prepaid` не пускає / `allow_pay_later` пускає;
 *   писач             рецепції брудний номер — попередження, терміналу —
 *                     відмова;
 *   стан номера       чистий призначається / брудний і зайнятий — ні;
 *   токен             живий працює / відкликаний 401;
 *   код парування     свіжий парує / зужитий і строчений — ні.
 *
 * Один бік не доводить нічого: «пускає» без «не пускає» — це код, який
 * пускає завжди.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-kiosk-'));
process.env.ALISIO_DATA_DIR = tmp;
process.env.APP_SECRET_KEY ||= '0'.repeat(64);

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { setFeature } = await import('@core/features.ts');
const { checkIn, checkOut, assignUnit, readCheckinPolicy } = await import('@bookings/kernel.ts');
const { saveSignature, isSigned, SIGNATURE_MAX_BYTES } = await import('@guests/kernel.ts');
const { lockCodeForStay } = await import('@properties/kernel.ts');
const devices = await import('./data/devices.repo.ts');
const tokens = await import('./data/device-token.ts');
const pairing = await import('./api/pairing.handlers.ts');
const session = await import('./api/session.handlers.ts');
const stay = await import('./api/stay.handlers.ts');
const today = await import('./data/today.repo.ts');
const dayMail = await import('./data/today-mail.ts');
const { oneProperty, ALL_PROPERTIES } = await import('@core/property-scope.ts');
const { documentLanguage } = await import('@core/i18n/resolve.ts');
const walkin = await import('./api/walkin.handlers.ts');
const search = await import('./domain/search.ts');

const sql = getSql();
const A = '__kiosk_check__a';
const B = '__kiosk_check__b';
const P1 = '__kiosk_check__p1';   // головний корпус A — тут стоїть термінал
const P2 = '__kiosk_check__p2';   // сусідній корпус A — тут термінала немає
const PB = '__kiosk_check__pb';   // обʼєкт B

/** Дати заїзду/виїзду — завтра і післязавтра, щоб не залежати від «сьогодні». */
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function cleanup() {
  for (const org of [A, B]) {
    await runWithOrganization(org, async () => {
      await sql.run('DELETE FROM kiosk_events WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM kiosk_pairings WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM kiosk_devices WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM guest_registrations WHERE reservation_id IN (SELECT id FROM reservations WHERE organization_id = ?)', [org]);
      await sql.run('DELETE FROM reservation_guests WHERE reservation_id IN (SELECT id FROM reservations WHERE organization_id = ?)', [org]);
      await sql.run('DELETE FROM reservations WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM units WHERE property_id IN (SELECT id FROM properties WHERE organization_id = ?)', [org]);
      await sql.run('DELETE FROM unit_types WHERE property_id IN (SELECT id FROM properties WHERE organization_id = ?)', [org]);
      await sql.run('DELETE FROM categories WHERE property_id IN (SELECT id FROM properties WHERE organization_id = ?)', [org]);
      await sql.run('DELETE FROM guests WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM organization_features WHERE organization_id = ?', [org]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
  await sql.run("DELETE FROM rate_limits WHERE token LIKE 'kiosk_%'");
}

/** Обʼєкт із категорією, типом і двома номерами. Усе — під орендарем. */
async function seedProperty(org: string, propertyId: string) {
  await sql.run(
    "INSERT INTO properties (id, organization_id, name, slug, country, checkin_payment_policy) VALUES (?, ?, ?, ?, 'DE', 'prepaid')",
    [propertyId, org, propertyId, propertyId]);
  await sql.run("INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, 'Zimmer', 'room')",
    [`${propertyId}_cat`, propertyId]);
  await sql.run("INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, 'Doppel', 'DBL')",
    [`${propertyId}_ut`, propertyId, `${propertyId}_cat`]);
  // ДРУГИЙ тип із власними номерами — для сцен пошуку.
  //
  // Не охайність: на Postgres стоїть `no_double_booking` (EXCLUDE, 0133), і
  // дві броні на один номер в одні ночі відхиляє САМА БАЗА. На SQLite цього
  // обмеження немає, тож фікстура, у якій перебування ділять номер, роками
  // виглядала б цілою — і падала б лише на живому рушії. Сцени пошуку живуть
  // на своєму типі ще й тому, що сцена 6 рахує ЄМНІСТЬ типу: чужа бронь у
  // тому самому типі зробила б її твердження про «вільних немає» випадковим.
  await sql.run("INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, 'Einzel', 'SGL')",
    [`${propertyId}_ut2`, propertyId, `${propertyId}_cat`]);
  for (const n of [1, 2]) {
    await sql.run(`
      INSERT INTO units (id, unit_type_id, property_id, category_id, name, code, lock_code, cleaning_status, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'clean', ?)
    `, [`${propertyId}_u${n}`, `${propertyId}_ut`, propertyId, `${propertyId}_cat`, `21${n}`, `21${n}`, `487${n}`, n]);
  }
  for (const n of [3, 4]) {
    await sql.run(`
      INSERT INTO units (id, unit_type_id, property_id, category_id, name, code, lock_code, cleaning_status, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'clean', ?)
    `, [`${propertyId}_u${n}`, `${propertyId}_ut2`, propertyId, `${propertyId}_cat`, `21${n}`, `21${n}`, `487${n}`, n]);
  }
}

/** Бронь на завтра. `unitId` = null — номер ще не призначений. */
async function seedStay(org: string, propertyId: string, id: string, opts: {
  unitId?: string | null; paymentStatus?: string; registered?: boolean;
  /** Зсув ночей від сьогодні; за замовчуванням завтра→післязавтра. */
  from?: number; to?: number;
  unitTypeId?: string;
} = {}) {
  await sql.run("INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, 'Max', 'Muster')",
    [`${id}_g`, org]);
  await sql.run(`
    INSERT INTO reservations (id, organization_id, property_id, unit_id, unit_type_id, guest_id,
                              check_in, check_out, nights, adults, status, payment_status,
                              registration_status, total_price, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 2, 'confirmed', ?, ?, 200, 'EUR')
  `, [
    id, org, propertyId, opts.unitId === undefined ? `${propertyId}_u1` : opts.unitId,
    opts.unitTypeId ?? `${propertyId}_ut`, `${id}_g`, day(opts.from ?? 1), day(opts.to ?? 2),
    opts.paymentStatus ?? 'unpaid', opts.registered === false ? 'not_registered' : 'registered',
  ]);
  await sql.run(`
    INSERT INTO guest_registrations (id, reservation_id, guest_id, is_primary, reg_status)
    VALUES (?, ?, ?, TRUE, 'completed')
  `, [`${id}_gr`, id, `${id}_g`]);
}

const deviceActor = (org: string, propertyId: string) =>
  ({ kind: 'device' as const, organizationId: org, propertyId, userId: null });
const receptionActor = (org: string, propertyId: string) =>
  ({ kind: 'reception' as const, organizationId: org, propertyId, userId: null });
const eventCount = (org: string) => runWithOrganization(org, async () =>
  Number((await sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM kiosk_events WHERE organization_id = ?', [org]))?.n));
const policy = (propertyId: string, value: string) =>
  sql.run('UPDATE properties SET checkin_payment_policy = ? WHERE id = ?', [value, propertyId]);
const clean = (unitId: string, value: string) =>
  sql.run('UPDATE units SET cleaning_status = ? WHERE id = ?', [value, unitId]);

await cleanup();
for (const org of [A, B]) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
}
await runWithOrganization(A, () => setFeature(A, 'kiosk', true));
await runWithOrganization(B, () => setFeature(B, 'kiosk', false));
await runWithOrganization(A, async () => { await seedProperty(A, P1); await seedProperty(A, P2); });
await runWithOrganization(B, () => seedProperty(B, PB));

try {
  // ── 1. Парування: свіжий код парує; зужитий, строчений і чужий — ні ──────
  const made = await runWithOrganization(A, () => devices.createPairing({ organizationId: A, propertyId: P1, name: 'Foyer' }));
  assert.match(made.code, /^[0-9]{6}$/, `код парування «${made.code}» не шестизначний`);
  // Сам код у базі не лежить — лежить його sha256.
  const stored = await runWithOrganization(A, () => sql.row<{ code_hash: string }>(
    'SELECT code_hash FROM kiosk_pairings WHERE id = ? AND organization_id = ?', [made.pairingId, A]));
  assert.notStrictEqual(stored?.code_hash, made.code, 'код парування лежить у базі відкритим');
  assert.strictEqual(stored?.code_hash, devices.hashCode(made.code), 'у базі не sha256 коду');

  const pair = (code: string) => pairing.pairDevice(new Request('http://alisio.test/api/apps/kiosk/pair', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify({ code }),
  }));

  let res = await pair('000000');
  assert.strictEqual(res.status, 400, `невідомий код: очікували 400, отримали ${res.status}`);
  res = await pair(made.code);
  // Тіло читається ОДИН раз і до assert: повідомлення шаблонного рядка
  // обчислюється завжди, навіть коли перевірка проходить, і `await res.text()`
  // у ньому зʼїдав би тіло ще до `res.json()` нижче.
  let text = await res.text();
  assert.strictEqual(res.status, 200, `свіжий код: очікували 200, отримали ${res.status} ${text}`);
  const paired = JSON.parse(text) as { token: string; deviceId: string; propertyId: string };
  assert.strictEqual(paired.propertyId, P1, 'термінал спарувався не з тим обʼєктом');
  // Другий раз той самий код — мертвий.
  res = await pair(made.code);
  assert.strictEqual(res.status, 400, `зужитий код: очікували 400, отримали ${res.status}`);
  // Строчений — теж, і саме за строком: рядок є, він незужитий.
  const stale = await runWithOrganization(A, () => devices.createPairing({ organizationId: A, propertyId: P1, name: 'Stale' }));
  await runWithOrganization(A, () => sql.run('UPDATE kiosk_pairings SET expires_at = ? WHERE id = ?',
    [new Date(Date.now() - 60_000).toISOString(), stale.pairingId]));
  res = await pair(stale.code);
  assert.strictEqual(res.status, 400, `строчений код: очікували 400, отримали ${res.status}`);
  // Код організації B: код правильний, застосунок вимкнено — той самий 400,
  // а не 404: інакше маршрут підтвердив би, що код існує.
  const codeB = await runWithOrganization(B, () => devices.createPairing({ organizationId: B, propertyId: PB, name: 'B' }));
  res = await pair(codeB.code);
  assert.strictEqual(res.status, 400, `код B із вимкненим застосунком: очікували 400, отримали ${res.status}`);
  assert.strictEqual(await eventCount(B), 0, 'у B зʼявилась подія від невдалого парування');
  console.log('  ok  1. парує лише свіжий незужитий код свого рахунку; у базі — хеш, не код');

  // ── 2. Токен: живий працює, відкликаний 401, сміття 401 ──────────────────
  const ask = (token: string | null) => session.deviceSession(new Request('http://alisio.test/api/apps/kiosk/session', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }));
  res = await ask(paired.token);
  text = await res.text();
  assert.strictEqual(res.status, 200, `живий токен: очікували 200, отримали ${res.status} ${text}`);
  const state = JSON.parse(text) as {
    property: { id: string }; checkinPaymentPolicy: string; walkinUrl: string | null;
    touchBand: { top: number; bottom: number }; languages: string[];
  };
  assert.strictEqual(state.property.id, P1, 'сесія назвала не той обʼєкт');
  assert.deepStrictEqual(state.languages, ['de', 'en'], 'мови екрана не DE+EN (К7)');
  assert.strictEqual(state.walkinUrl, null, 'walk-in увімкнений без адреси');
  assert.deepStrictEqual(state.touchBand, session.DEFAULT_TOUCH_BAND, 'робоча смуга не дефолтна');
  res = await ask(null);
  assert.strictEqual(res.status, 401, `без токена: очікували 401, отримали ${res.status}`);
  res = await ask('garbage.garbage.zz');
  assert.strictEqual(res.status, 401, `сміття замість токена: очікували 401, отримали ${res.status}`);
  // Префікс і пристрій свої, секрет чужий — 401 на хеші, а не на пошуку рядка.
  const parsedOk = tokens.parseBearer(`Bearer ${paired.token}`)!;
  res = await ask(`${parsedOk.organizationId}.${parsedOk.propertyId}.${parsedOk.deviceId}.${'a'.repeat(64)}`);
  assert.strictEqual(res.status, 401, `чужий секрет: очікували 401, отримали ${res.status}`);
  // Корпус у токені підмінено: секрет той самий, рядок не знаходиться.
  res = await ask(`${parsedOk.organizationId}.${P2}.${parsedOk.deviceId}.${parsedOk.secret}`);
  assert.strictEqual(res.status, 401, `підмінений корпус у токені: очікували 401, отримали ${res.status}`);
  console.log('  ok  2. живий токен віддає стан обʼєкта; без токена, зі сміттям, із чужим секретом і з підміненим корпусом — 401');

  // ── 3. Заселення: політика оплати ОБИДВОМА боками ────────────────────────
  await runWithOrganization(A, () => seedStay(A, P1, 'kc_pay'));
  let got = await runWithOrganization(A, () => checkIn('kc_pay', { actor: deviceActor(A, P1) }));
  assert.deepStrictEqual(got, { ok: false, refusal: 'payment_required' }, `prepaid без оплати: ${JSON.stringify(got)}`);
  // Третій бік тієї самої осі — у ЧИТАЧІ, а не в рядку: слово, якого немає у
  // словнику, і порожнеча читаються як найсуворіше (інваріант 13). Через базу
  // це не перевірити, і це добре: CHECK відмовляє записати чуже слово. Але
  // порожнеча приходить не з рядка — вона приходить із ВІДСУТНОСТІ рядка: на
  // Postgres запит без орендаря повертає нуль рядків, і найм'якший дефолт
  // відчинив би двері рівно там, де орендар невідомий.
  for (const raw of [undefined, null, '', 'whatever', 'PREPAID']) {
    assert.strictEqual(readCheckinPolicy(raw), 'prepaid',
      `невідоме слово політики «${String(raw)}» прочиталось як ${readCheckinPolicy(raw)}`);
  }
  assert.strictEqual(readCheckinPolicy('allow_pay_later'), 'allow_pay_later',
    'відоме слово політики не читається — тоді перевірка вище нічого не доводить');
  await runWithOrganization(A, () => policy(P1, 'allow_pay_later'));
  got = await runWithOrganization(A, () => checkIn('kc_pay', { actor: deviceActor(A, P1) }));
  assert.strictEqual(got.ok, true, `allow_pay_later не пустив: ${JSON.stringify(got)}`);
  // Повторне натискання — ідемпотентно: один заїзд, не два.
  const again = await runWithOrganization(A, () => checkIn('kc_pay', { actor: deviceActor(A, P1) }));
  assert.strictEqual(again.ok, true, `повторне заселення відмовило: ${JSON.stringify(again)}`);
  const status = await runWithOrganization(A, () => sql.row<{ status: string }>(
    'SELECT status FROM reservations WHERE id = ? AND organization_id = ?', ['kc_pay', A]));
  assert.strictEqual(status?.status, 'checked_in', 'бронь не заселена');
  console.log('  ok  3. prepaid і невідоме слово не пускають без оплати, allow_pay_later пускає; повторне заселення — те саме');

  // ── 4. Реєстрація обовʼязкова за БУДЬ-ЯКОЇ політики ──────────────────────
  await runWithOrganization(A, () => seedStay(A, P1, 'kc_reg', { unitId: `${P1}_u2`, registered: false }));
  got = await runWithOrganization(A, () => checkIn('kc_reg', { actor: deviceActor(A, P1) }));
  assert.deepStrictEqual(got, { ok: false, refusal: 'not_registered' }, `без реєстрації: ${JSON.stringify(got)}`);
  const asReception = await runWithOrganization(A, () => checkIn('kc_reg', { actor: receptionActor(A, P1) }));
  assert.deepStrictEqual(asReception, { ok: false, refusal: 'not_registered' },
    `рецепції теж не можна без реєстрації: ${JSON.stringify(asReception)}`);
  console.log('  ok  4. заселення без реєстрації — відмова і терміналу, і рецепції');

  // ── 5. Брудний номер: терміналу відмова, рецепції попередження ───────────
  await runWithOrganization(A, () => seedStay(A, P1, 'kc_dirty', { unitId: `${P1}_u2`, from: 3, to: 4 }));
  await runWithOrganization(A, () => clean(`${P1}_u2`, 'dirty'));
  got = await runWithOrganization(A, () => checkIn('kc_dirty', { actor: deviceActor(A, P1) }));
  assert.deepStrictEqual(got, { ok: false, refusal: 'unit_dirty' }, `брудний номер терміналу: ${JSON.stringify(got)}`);
  const dirtyReception = await runWithOrganization(A, () => checkIn('kc_dirty', { actor: receptionActor(A, P1) }));
  assert.deepStrictEqual(dirtyReception, { ok: true, warning: 'unit_dirty', unitId: `${P1}_u2` },
    `брудний номер рецепції: ${JSON.stringify(dirtyReception)}`);
  console.log('  ok  5. брудний номер: терміналу відмова, рецепції попередження — і заселення');

  // ── 6. assignUnit: не бере зайнятий і не бере брудний ────────────────────
  await runWithOrganization(A, () => clean(`${P1}_u2`, 'clean'));
  await runWithOrganization(A, () => seedStay(A, P1, 'kc_assign', { unitId: null }));
  // u1 зайнятий бронню kc_pay, u2 зайнятий kc_dirty — вільних немає.
  let assigned = await runWithOrganization(A, () => assignUnit('kc_assign', { actor: deviceActor(A, P1), prefer: 'clean' }));
  assert.deepStrictEqual(assigned, { ok: false, refusal: 'no_free_unit' }, `усі зайняті: ${JSON.stringify(assigned)}`);
  // Звільняємо u2, але бруднимо його: вільний є, чистого немає — інша відмова.
  //
  // Бронь СКАСОВУЄТЬСЯ, а не лишається без номера: `freeUnitsForRange` віднімає
  // ще й тиск безномерних броней того самого типу (інваріант И3), тож «зняв
  // номер» звільнило б кімнату поіменно і тут же зʼїло її кількістю — і сцена
  // перевіряла б не те, що написано в її назві.
  await runWithOrganization(A, () => sql.run(
    "UPDATE reservations SET unit_id = NULL, status = 'cancelled' WHERE id IN (?, ?)", ['kc_dirty', 'kc_reg']));
  await runWithOrganization(A, () => clean(`${P1}_u2`, 'dirty'));
  assigned = await runWithOrganization(A, () => assignUnit('kc_assign', { actor: deviceActor(A, P1), prefer: 'clean' }));
  assert.deepStrictEqual(assigned, { ok: false, refusal: 'no_clean_unit' }, `вільний, але брудний: ${JSON.stringify(assigned)}`);
  await runWithOrganization(A, () => clean(`${P1}_u2`, 'clean'));
  assigned = await runWithOrganization(A, () => assignUnit('kc_assign', { actor: deviceActor(A, P1), prefer: 'clean' }));
  assert.deepStrictEqual(assigned, { ok: true, unitId: `${P1}_u2`, alreadyAssigned: false }, `вільний і чистий: ${JSON.stringify(assigned)}`);
  console.log('  ok  6. assignUnit: зайнятий — no_free_unit, брудний — no_clean_unit, чистий — призначено');

  // ── 7. Код скриньки — лише для номера ЦІЄЇ броні, і лише заселеної ───────
  // kc_assign щойно дістала номер, але ще не заселена.
  let key = await runWithOrganization(A, () => lockCodeForStay({ organizationId: A, propertyId: P1, reservationId: 'kc_assign' }));
  assert.strictEqual(key, null, 'код скриньки віддано до заселення');
  await runWithOrganization(A, () => policy(P1, 'allow_pay_later'));
  got = await runWithOrganization(A, () => checkIn('kc_assign', { actor: deviceActor(A, P1) }));
  assert.strictEqual(got.ok, true, `заселення після призначення: ${JSON.stringify(got)}`);
  key = await runWithOrganization(A, () => lockCodeForStay({ organizationId: A, propertyId: P1, reservationId: 'kc_assign' }));
  assert.strictEqual(key?.lockCode, '4872', `код скриньки призначеного номера: ${JSON.stringify(key)}`);
  assert.strictEqual(key?.unitId, `${P1}_u2`, 'код скриньки не того номера');
  // Той самий термінал, але бронь СУСІДНЬОГО корпусу того самого рахунку.
  await runWithOrganization(A, () => seedStay(A, P2, 'kc_other_house', { paymentStatus: 'paid' }));
  const alien = await runWithOrganization(A, () => lockCodeForStay({ organizationId: A, propertyId: P1, reservationId: 'kc_other_house' }));
  assert.strictEqual(alien, null, 'термінал корпусу 1 дістав код скриньки корпусу 2');
  // Та сама вісь у ФАСАДАХ, не лише в коді скриньки: заселити, виселити,
  // призначити номер і підписати бронь сусіднього корпусу — теж «немає».
  // Орендар тут збігається, тож жодна перевірка орендаря цього не ловить.
  const houseIn = await runWithOrganization(A, () => checkIn('kc_other_house', { actor: deviceActor(A, P1) }));
  assert.deepStrictEqual(houseIn, { ok: false, refusal: 'not_found' }, `заселення чужого корпусу: ${JSON.stringify(houseIn)}`);
  const houseAssign = await runWithOrganization(A, () => assignUnit('kc_other_house', { actor: deviceActor(A, P1), prefer: 'clean' }));
  assert.deepStrictEqual(houseAssign, { ok: false, refusal: 'not_found' }, `призначення в чужому корпусі: ${JSON.stringify(houseAssign)}`);
  const houseOut = await runWithOrganization(A, () => checkOut('kc_other_house', { actor: deviceActor(A, P1) }));
  assert.deepStrictEqual(houseOut, { ok: false, refusal: 'not_found' }, `виселення в чужому корпусі: ${JSON.stringify(houseOut)}`);
  const houseSig = await runWithOrganization(A, () => saveSignature({ organizationId: A, propertyId: P1, reservationId: 'kc_other_house', signaturePng: 'data:image/png;base64,iVBORw0KGgo=' }));
  assert.deepStrictEqual(houseSig, { ok: false, refusal: 'not_found' }, `підпис у чужому корпусі: ${JSON.stringify(houseSig)}`);
  // І той самий фасад із ПРАВИЛЬНИМ корпусом працює — інакше сцена доводила б
  // лише те, що бронь зіпсована.
  const houseOk = await runWithOrganization(A, () => assignUnit('kc_other_house', { actor: deviceActor(A, P2), prefer: 'clean' }));
  assert.strictEqual(houseOk.ok, true, `свій корпус має працювати: ${JSON.stringify(houseOk)}`);
  console.log('  ok  7. корпус: lock_code і всі чотири фасади — лише свій будинок, чужий «немає»');

  // ── 8. Чужий рахунок: термінал A не бачить броні B, і в B нуль подій ─────
  await runWithOrganization(B, () => seedStay(B, PB, 'kc_b_stay', { paymentStatus: 'paid' }));
  const crossOrg = await runWithOrganization(A, () => checkIn('kc_b_stay', { actor: deviceActor(A, P1) }));
  assert.deepStrictEqual(crossOrg, { ok: false, refusal: 'not_found' }, `бронь B терміналом A: ${JSON.stringify(crossOrg)}`);
  const crossKey = await runWithOrganization(A, () => lockCodeForStay({ organizationId: A, propertyId: P1, reservationId: 'kc_b_stay' }));
  assert.strictEqual(crossKey, null, 'термінал A дістав код скриньки готелю B');
  assert.strictEqual(await eventCount(B), 0, 'у журналі B зʼявилась подія від термінала A');
  const stillB = await runWithOrganization(B, () => sql.row<{ status: string }>(
    'SELECT status FROM reservations WHERE id = ? AND organization_id = ?', ['kc_b_stay', B]));
  assert.strictEqual(stillB?.status, 'confirmed', 'бронь B змінилась від дії термінала A');
  console.log('  ok  8. бронь чужого рахунку — «немає», нуль подій у чужому журналі, рядок не змінено');

  // ── 9. Відкликаний термінал перестає відповідати — і лишається в журналі ─
  await runWithOrganization(A, () => devices.noteEvent({ organizationId: A, deviceId: paired.deviceId, kind: 'checkin' }));
  const before = await eventCount(A);
  assert.ok(before > 0, 'журнал A порожній — нема чого зберігати');
  const revoked = await runWithOrganization(A, () => devices.revokeDevice(A, paired.deviceId));
  assert.strictEqual(revoked, true, 'відкликання не спрацювало');
  res = await ask(paired.token);
  assert.strictEqual(res.status, 401, `відкликаний токен: очікували 401, отримали ${res.status}`);
  assert.strictEqual(await eventCount(A), before, 'відкликання стерло журнал');
  const twice = await runWithOrganization(A, () => devices.revokeDevice(A, paired.deviceId));
  assert.strictEqual(twice, false, 'повторне відкликання вдруге «спрацювало»');
  console.log('  ok  9. відкликаний термінал — 401, журнал доби лишається, друге відкликання — ні');

  // ── 10. Підпис: форма, розмір, адресат ──────────────────────────────────
  assert.strictEqual(await runWithOrganization(A, () => isSigned(A, P1, 'kc_pay')), false, 'бронь підписана до підпису');
  let sig = await runWithOrganization(A, () => saveSignature({ organizationId: A, propertyId: P1, reservationId: 'kc_pay', signaturePng: '<svg/>' }));
  assert.deepStrictEqual(sig, { ok: false, refusal: 'not_png' }, `не PNG: ${JSON.stringify(sig)}`);
  const huge = `data:image/png;base64,${'A'.repeat(SIGNATURE_MAX_BYTES)}`;
  sig = await runWithOrganization(A, () => saveSignature({ organizationId: A, propertyId: P1, reservationId: 'kc_pay', signaturePng: huge }));
  assert.deepStrictEqual(sig, { ok: false, refusal: 'too_large' }, `завеликий: ${JSON.stringify(sig)}`);
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  sig = await runWithOrganization(A, () => saveSignature({ organizationId: A, propertyId: P1, reservationId: 'kc_pay', signaturePng: png }));
  assert.strictEqual(sig.ok, true, `справжній PNG: ${JSON.stringify(sig)}`);
  assert.strictEqual(await runWithOrganization(A, () => isSigned(A, P1, 'kc_pay')), true, 'підпис не записався');
  // Бронь чужого рахунку — «немає», а не тихий запис не туди.
  const sigCross = await runWithOrganization(A, () => saveSignature({ organizationId: A, propertyId: P1, reservationId: 'kc_b_stay', signaturePng: png }));
  assert.deepStrictEqual(sigCross, { ok: false, refusal: 'not_found' }, `підпис на бронь B: ${JSON.stringify(sigCross)}`);
  assert.strictEqual(await runWithOrganization(B, () => isSigned(B, PB, 'kc_b_stay')), false, 'підпис ліг на бронь B');
  console.log('  ok  10. підпис: не-PNG і >200 КБ — відмова, свій PNG — записано, чужа бронь — «немає»');

  // ── 11. Виселення: політика боргу як є, номер стає брудним ──────────────
  await runWithOrganization(A, () => sql.run(
    "UPDATE properties SET checkout_balance_policy = 'none' WHERE id = ?", [P1]));
  const out = await runWithOrganization(A, () => checkOut('kc_assign', { actor: deviceActor(A, P1) }));
  assert.strictEqual(out.ok, true, `виселення: ${JSON.stringify(out)}`);
  const unitAfter = await runWithOrganization(A, () => sql.row<{ cleaning_status: string }>(
    'SELECT cleaning_status FROM units WHERE id = ?', [`${P1}_u2`]));
  assert.strictEqual(unitAfter?.cleaning_status, 'dirty', 'номер після виселення не брудний');
  // `blocking` із боргом не випускає — друга вісь тієї самої політики.
  await runWithOrganization(A, () => sql.run(
    "UPDATE properties SET checkout_balance_policy = 'blocking' WHERE id = ?", [P1]));
  const blocked = await runWithOrganization(A, () => checkOut('kc_pay', { actor: deviceActor(A, P1) }));
  assert.strictEqual(blocked.ok, false, `борг під blocking: ${JSON.stringify(blocked)}`);
  assert.strictEqual(blocked.ok === false ? blocked.refusal : null, 'balance_blocking', JSON.stringify(blocked));
  console.log('  ok  11. виселення бруднить номер; борг під blocking не випускає');

  // ── 12. Ліміт частоти — на ПРИСТРОЇ, не на IP ───────────────────────────
  const fresh = await runWithOrganization(A, () => devices.createPairing({ organizationId: A, propertyId: P1, name: 'Rate' }));
  res = await pair(fresh.code);
  assert.strictEqual(res.status, 200, `парування для сцени ліміту: ${res.status}`);
  const rate = await res.json() as { token: string };
  let last = 200;
  for (let i = 0; i < 125 && last === 200; i += 1) last = (await ask(rate.token)).status;
  assert.strictEqual(last, 429, `ліміт на пристрої не спрацював: останній статус ${last}`);
  console.log('  ok  12. 120 викликів на хвилину — далі 429, і рахується ПРИСТРІЙ');


  // ── 13. Пошук: один чинник → 400, два → знаходить, поза вікном → «немає» ─
  //
  // Токен пристрою тут свій — попередній відкликано сценою 9, і сцена, яка
  // цього не помітила б, доводила б рівно нічого.
  const live = await runWithOrganization(A, () => devices.createPairing({ organizationId: A, propertyId: P1, name: 'Find' }));
  res = await pair(live.code);
  const dev = await res.json() as { token: string; deviceId: string };
  const post = (path: string, payload: unknown, token = dev.token) =>
    new Request(`http://alisio.test/api/apps/kiosk/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

  // Бронь на СЬОГОДНІ — щоб вона потрапляла у вікно ±1 день.
  await runWithOrganization(A, () => seedStay(A, P1, 'kc_find', { unitId: `${P1}_u3`, unitTypeId: `${P1}_ut2`, paymentStatus: 'paid', from: 5, to: 6 }));
  await runWithOrganization(A, () => sql.run(
    'UPDATE reservations SET check_in = ?, check_out = ? WHERE id = ?', [day(0), day(1), 'kc_find']));
  // Своє прізвище: решта засіву теж «Muster», і сцена вікна перевіряла б
  // випадкового сусіда замість тієї броні, яку рухає.
  await runWithOrganization(A, () => sql.run(
    "UPDATE guests SET last_name = 'Fenster' WHERE id = ?", ['kc_find_g']));

  let found = await stay.findStay(post('find', { lastName: 'Fenster' }));
  assert.strictEqual(found.status, 400, `один чинник: очікували 400, отримали ${found.status}`);
  found = await stay.findStay(post('find', { lastName: 'Fenster', checkIn: day(0) }));
  assert.strictEqual(found.status, 200, `два чинники: очікували 200, отримали ${found.status}`);
  let body = await found.json() as { found: boolean; stay?: { reservationId: string; guest: string }; reason?: string };
  assert.strictEqual(body.found, true, `два чинники не знайшли: ${JSON.stringify(body)}`);
  assert.strictEqual(body.stay?.reservationId, 'kc_find', 'знайшлась не та бронь');
  // Імʼя на екрані — маскою, і повного прізвища в відповіді немає ЗОВСІМ.
  assert.strictEqual(body.stay?.guest, 'M… F…', `імʼя не замасковане: ${body.stay?.guest}`);
  assert.ok(!JSON.stringify(body).includes('Fenster'), 'повне прізвище поїхало на екран');
  // Телефон коротший за вісім цифр — НЕ чинник.
  //
  // Знайдено рецензією Б: її мутація `>= 8` → `>= 1` лишила гейт зеленим,
  // тобто жодна сцена цього не стверджувала. А різниця тут не косметична:
  // «49» або «170» звузили б пошук до половини готелю, і пара «прізвище +
  // три цифри» виглядала б як два чинники, лишаючись одним.
  //
  // Тому телефон, у якому менше восьми цифр, не рахується названим — і пара
  // з ним дає 400, а не список Мюллерів.
  found = await stay.findStay(post('find', { lastName: 'Fenster', phone: '12' }));
  assert.strictEqual(found.status, 400,
    `прізвище + телефон «12»: очікували 400 (один чинник), отримали ${found.status}`);
  // Друга вісь тієї самої межі: повний номер чинником Є. Без неї сцена
  // доводила б лише те, що телефон не працює ніколи.
  await runWithOrganization(A, () => sql.run(
    "UPDATE guests SET phone = '+49 170 5550101' WHERE id = ?", ['kc_find_g']));
  found = await stay.findStay(post('find', { lastName: 'Fenster', phone: '0170 5550101' }));
  assert.strictEqual(((await found.json()) as any).found, true,
    'повний телефон іншої форми (0170… проти +49 170…) не спрацював як чинник');
  console.log('  ok  13. один чинник — 400; два — знаходять; телефон < 8 цифр не чинник, повний — чинник; імʼя маскою');

  // ── 14. Вікно ±1 день: бронь на майбутнє на терміналі не існує ───────────
  await runWithOrganization(A, () => sql.run(
    'UPDATE reservations SET check_in = ?, check_out = ? WHERE id = ?', [day(30), day(31), 'kc_find']));
  found = await stay.findStay(post('find', { lastName: 'Fenster', checkIn: day(30) }));
  body = await found.json() as any;
  assert.strictEqual(body.found, false, `бронь за 30 днів знайшлась: ${JSON.stringify(body)}`);
  assert.strictEqual(body.reason, 'not_found', `очікували not_found, отримали ${body.reason}`);
  // І межа вікна — рівно доба: завтра знаходиться, післязавтра ні.
  await runWithOrganization(A, () => sql.run(
    'UPDATE reservations SET check_in = ?, check_out = ? WHERE id = ?', [day(1), day(2), 'kc_find']));
  found = await stay.findStay(post('find', { lastName: 'Fenster', checkIn: day(1) }));
  assert.strictEqual(((await found.json()) as any).found, true, 'заїзд завтра не знайшовся — вікно вужче за добу');
  await runWithOrganization(A, () => sql.run(
    'UPDATE reservations SET check_in = ?, check_out = ? WHERE id = ?', [day(2), day(3), 'kc_find']));
  found = await stay.findStay(post('find', { lastName: 'Fenster', checkIn: day(2) }));
  assert.strictEqual(((await found.json()) as any).found, false, 'заїзд післязавтра знайшовся — вікно ширше за добу');
  console.log('  ok  14. вікно ±1 день: завтра знаходиться, післязавтра і за 30 днів — ні');

  // ── 15. Два збіги → третій чинник, і скільки їх — не кажеться ───────────
  await runWithOrganization(A, () => sql.run(
    'UPDATE reservations SET check_in = ?, check_out = ? WHERE id = ?', [day(0), day(1), 'kc_find']));
  await runWithOrganization(A, () => seedStay(A, P1, 'kc_twin', { unitId: `${P1}_u4`, unitTypeId: `${P1}_ut2`, paymentStatus: 'paid', from: 5, to: 6 }));
  await runWithOrganization(A, () => sql.run(
    'UPDATE reservations SET check_in = ?, check_out = ? WHERE id = ?', [day(0), day(1), 'kc_twin']));
  await runWithOrganization(A, () => sql.run(
    "UPDATE guests SET last_name = 'Fenster' WHERE id = ?", ['kc_twin_g']));
  found = await stay.findStay(post('find', { lastName: 'Fenster', checkIn: day(0) }));
  body = await found.json() as any;
  assert.strictEqual(body.found, false, 'два збіги віддали одну бронь');
  assert.strictEqual(body.reason, 'need_more', `очікували need_more, отримали ${body.reason}`);
  assert.ok(!JSON.stringify(body).includes('kc_find') && !JSON.stringify(body).includes('kc_twin'),
    'на два збіги поїхав список броней');
  // Третій чинник розводить їх.
  await runWithOrganization(A, () => sql.run(
    "UPDATE guests SET email = 'twin@example.test' WHERE id = ?", ['kc_twin_g']));
  found = await stay.findStay(post('find', { lastName: 'Fenster', checkIn: day(0), email: 'twin@example.test' }));
  body = await found.json() as any;
  assert.strictEqual(body.stay?.reservationId, 'kc_twin', `третій чинник не розвів: ${JSON.stringify(body)}`);
  console.log('  ok  15. два збіги — need_more без списку; третій чинник розводить');

  // ── 16. Заселення терміналом: одна подія на два натиски ─────────────────
  await runWithOrganization(A, () => policy(P1, 'allow_pay_later'));
  await runWithOrganization(A, () => clean(`${P1}_u2`, 'clean'));
  const eventsBefore = await eventCount(A);
  let ci = await stay.checkInStay(post('checkin', { reservationId: 'kc_twin' }));
  text = await ci.text();
  assert.strictEqual(ci.status, 200, `заселення: ${ci.status} ${text}`);
  const first = await eventCount(A);
  ci = await stay.checkInStay(post('checkin', { reservationId: 'kc_twin' }));
  assert.strictEqual(ci.status, 200, 'повторне заселення відмовило');
  const key2 = await ci.json() as { unitName: string | null; lockCode: string | null };
  assert.strictEqual(key2.lockCode, '4874', `код скриньки: ${JSON.stringify(key2)}`);
  assert.strictEqual(await eventCount(A), first,
    `повторне «заселити» дописало подію: було ${first}, стало ${await eventCount(A)}`);
  assert.ok(first > eventsBefore, 'перше заселення події не написало — сцена нічого не доводить');
  console.log('  ok  16. заселення терміналом дає номер і код; друге натискання — та сама відповідь і ЖОДНОЇ нової події');

  // ── 17. Виселення: фаза книги вирішує, що піде листом ───────────────────
  await runWithOrganization(A, () => sql.run(
    "UPDATE properties SET checkout_balance_policy = 'none', system_of_record = 'external' WHERE id = ?", [P1]));
  let co = await stay.checkOutStay(post('checkout', { reservationId: 'kc_twin' }));
  text = await co.text();
  assert.strictEqual(co.status, 200, `виселення external: ${co.status} ${text}`);
  let phaseOut = JSON.parse(text) as { phase: string; invoiceExpected: boolean };
  assert.strictEqual(phaseOut.phase, 'external');
  assert.strictEqual(phaseOut.invoiceExpected, false, 'у фазі external кіоск обіцяє фактуру');
  const elsewhere = await runWithOrganization(A, () => sql.row<{ n: number }>(
    "SELECT COUNT(*) AS n FROM kiosk_events WHERE organization_id = ? AND kind = 'invoice_elsewhere'", [A]));
  assert.strictEqual(Number(elsewhere?.n), 1, 'рядка «виставити фактуру у чужій системі» немає');
  // Друга вісь: у фазі `alisio` фактура очікується, і рядка для рецепції немає.
  await runWithOrganization(A, () => sql.run(
    "UPDATE properties SET system_of_record = 'alisio' WHERE id = ?", [P1]));
  co = await stay.checkOutStay(post('checkout', { reservationId: 'kc_find' }));
  phaseOut = await co.json() as any;
  assert.strictEqual(phaseOut.phase, 'alisio');
  assert.strictEqual(phaseOut.invoiceExpected, true, 'у фазі alisio фактури не буде');
  const elsewhere2 = await runWithOrganization(A, () => sql.row<{ n: number }>(
    "SELECT COUNT(*) AS n FROM kiosk_events WHERE organization_id = ? AND kind = 'invoice_elsewhere'", [A]));
  assert.strictEqual(Number(elsewhere2?.n), 1, 'у фазі alisio теж зʼявився рядок для рецепції');
  console.log('  ok  17. external — без фактури і з рядком рецепції; alisio — фактура, рядка немає');

  // ── 18. Walk-in: та сама пара двічі → одна бронь; без номера → 400 ──────
  let wi = await walkin.claimWalkin(post('walkin', { lastName: 'Neu', checkIn: day(0) }));
  assert.strictEqual(wi.status, 400, `walk-in без номера підтвердження: очікували 400, отримали ${wi.status}`);
  wi = await walkin.claimWalkin(post('walkin', { confirmation: '55123', lastName: 'Neu', checkIn: day(0) }));
  text = await wi.text();
  assert.strictEqual(wi.status, 200, `walk-in: ${wi.status} ${text}`);
  const claimed = JSON.parse(text) as { reservationId: string; created: boolean };
  assert.strictEqual(claimed.created, true, 'перший walk-in не створив броні');
  wi = await walkin.claimWalkin(post('walkin', { confirmation: '55123', lastName: 'Neu', checkIn: day(0) }));
  const again2 = await wi.json() as { reservationId: string; created: boolean };
  assert.strictEqual(again2.created, false, 'друге натискання створило другу бронь');
  assert.strictEqual(again2.reservationId, claimed.reservationId, 'друге натискання дало іншу бронь');
  const walkinRows = await runWithOrganization(A, () => sql.row<{ n: number }>(
    "SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ? AND source = 'kiosk_walkin'", [A]));
  assert.strictEqual(Number(walkinRows?.n), 1, `броней walk-in ${walkinRows?.n}, а має бути одна`);
  const ref = await runWithOrganization(A, () => sql.row<{ external_ref: string; status: string }>(
    'SELECT external_ref, status FROM reservations WHERE id = ?', [claimed.reservationId]));
  assert.strictEqual(ref?.external_ref, 'winhotel-ob:55123', `ключ походження: ${ref?.external_ref}`);
  assert.strictEqual(ref?.status, 'tentative', `walk-in бронь має статус ${ref?.status}`);
  console.log('  ok  18. walk-in: без номера — 400; та сама пара двічі — одна бронь tentative з ключем чужої системи');

  // ── 19. Чужий рахунок і чужий корпус — уже через ХЕНДЛЕРИ ───────────────
  //
  // Сцена 8 доводила це на фасадах. Тепер є код, який приймає id ззовні, і
  // рецензія А просила показати її червоною ще раз саме на ньому.
  const alienStay = await stay.stayCard(post('stay', { reservationId: 'kc_b_stay' }));
  assert.strictEqual(alienStay.status, 404, `бронь B хендлером A: очікували 404, отримали ${alienStay.status}`);
  const alienHouse = await stay.stayCard(post('stay', { reservationId: 'kc_other_house' }));
  assert.strictEqual(alienHouse.status, 404, `бронь корпусу 2: очікували 404, отримали ${alienHouse.status}`);
  const alienIn = await stay.checkInStay(post('checkin', { reservationId: 'kc_other_house' }));
  assert.strictEqual(alienIn.status, 404, `заселення в корпусі 2: очікували 404, отримали ${alienIn.status}`);
  assert.strictEqual(await eventCount(B), 0, 'у журналі B зʼявилась подія від термінала A');
  console.log('  ok  19. хендлери: бронь чужого рахунку і чужого корпусу — 404, чужий журнал порожній');


  // ── 20. Доба готелю: події ЦЬОГО будинку і ЦІЄЇ доби ────────────────────
  //
  // Два готелі у фікстурі — інваріант 26: підсумок, який рахує «усі події в
  // базі», з одним готелем виглядає правильним.
  const devB = await runWithOrganization(B, () => devices.createPairing({ organizationId: B, propertyId: PB, name: 'B-Foyer' }));
  await runWithOrganization(B, () => setFeature(B, 'kiosk', true));
  res = await pair(devB.code);
  assert.strictEqual(res.status, 200, `парування B: ${res.status}`);
  const deviceB = (await res.json() as { deviceId: string }).deviceId;
  await runWithOrganization(B, () => devices.noteEvent({
    organizationId: B, deviceId: deviceB, kind: 'checkin', result: 'ok' }));

  const dayA = await runWithOrganization(A, () => today.kioskDay({
    organizationId: A, scope: ALL_PROPERTIES }));
  const dayB = await runWithOrganization(B, () => today.kioskDay({
    organizationId: B, scope: ALL_PROPERTIES }));
  assert.strictEqual(dayB.counts.checkedIn, 1, `у B рівно одне заселення, отримали ${dayB.counts.checkedIn}`);
  assert.ok(dayA.counts.checkedIn >= 1, 'у A заселень немає — фікстура вироджена');
  assert.ok(!dayA.events.some((e) => e.device_id === deviceB), 'подія B потрапила в добу A');
  assert.ok(!dayB.events.some((e) => e.organization_id === A || e.device_id === paired.deviceId),
    'подія A потрапила в добу B');
  // Вісь БУДИНКУ всередині одного рахунку: термінал стоїть у P1, і доба
  // сусіднього корпусу порожня, хоч рахунок той самий.
  const dayP2 = await runWithOrganization(A, () => today.kioskDay({
    organizationId: A, scope: oneProperty(P2) }));
  assert.strictEqual(dayP2.events.length, 0,
    `доба корпусу без термінала не порожня: ${dayP2.events.length} подій`);
  // Інша доба — інші події: вчорашня порожня, і це не те саме, що «немає даних».
  const yesterday = await runWithOrganization(A, () => today.kioskDay({
    organizationId: A, scope: ALL_PROPERTIES, day: day(-1) }));
  assert.strictEqual(yesterday.events.length, 0, 'вчорашня доба не порожня — межі доби не тримають');
  console.log('  ok  20. доба: свій рахунок, свій корпус, своя доба — три осі, кожна двома боками');

  // ── 21. Лист о 7:00 містить рівно цю добу цього готелю ─────────────────
  //
  // Лист не шлеться (пошти в перевірці немає) — перевіряється те, що в нього
  // складається: підсумок і список для рецепції.
  const propRow = await runWithOrganization(A, () => sql.row<{ name: string }>(
    'SELECT name FROM properties WHERE id = ?', [P1]));
  const letterExternal = dayMail.renderKioskDay(
    dayA, { subject: (d: string, n: string) => `K ${d} ${n}`, checkedIn: 'CI', registered: 'R',
      checkedOut: 'CO', errors: 'E', invoiceList: 'INV', none: 'NONE' },
    propRow!.name, 'external');
  assert.match(letterExternal.text, /CI: \d+/, `лист без підсумку: ${letterExternal.text}`);
  assert.ok(letterExternal.text.includes('INV'),
    'у фазі external немає списку «виставити фактуру у чужій системі»');
  // Друга вісь: у фазі alisio того списку в листі НЕМАЄ — фактури виставились самі.
  const letterAlisio = dayMail.renderKioskDay(
    dayA, { subject: (d: string, n: string) => `K ${d} ${n}`, checkedIn: 'CI', registered: 'R',
      checkedOut: 'CO', errors: 'E', invoiceList: 'INV', none: 'NONE' },
    propRow!.name, 'alisio');
  assert.ok(!letterAlisio.text.includes('INV'),
    'у фазі alisio лист усе одно кличе виставляти фактуру в чужій системі');
  // Порожня доба каже про це словом, а не порожнім списком.
  const emptyLetter = dayMail.renderKioskDay(
    yesterday, { subject: (d: string, n: string) => `K ${d} ${n}`, checkedIn: 'CI', registered: 'R',
      checkedOut: 'CO', errors: 'E', invoiceList: 'INV', none: 'NONE' },
    propRow!.name, 'alisio');
  assert.ok(emptyLetter.text.includes('NONE'), `порожня доба без слова: ${emptyLetter.text}`);
  // Юрисдикція поза словником — англійська, а не мовчазна німецька.
  //
  // Той самий закон, що в решти документів (`localeForLanguage`): своя мова
  // там, де вона є, англійська там, де немає. Мовчазний `de` дав би
  // французькому готелю лист чужою мовою, і він вирішив би, що це помилка
  // адреси. Перевіряється ТА САМА функція, яку кличе крон.
  assert.strictEqual(dayMail.words('de').checkedIn, 'Selbst eingecheckt', 'німецька зникла');
  assert.strictEqual(dayMail.words('cs').checkedIn, 'Samoobslužné ubytování', 'чеська зникла');
  for (const other of ['fr', 'pl', 'uk', 'en', '', 'zz']) {
    assert.strictEqual(dayMail.words(other).checkedIn, 'Self check-ins',
      `мова «${other}» дала не англійську: ${dayMail.words(other).checkedIn}`);
  }
  // І це доходить до самого листа, а не лише до словника: обʼєкт із чужою
  // юрисдикцією читається `documentLanguage()` і складається англійською.
  await runWithOrganization(A, () => sql.run("UPDATE properties SET country = 'FR' WHERE id = ?", [P1]));
  const frLetter = dayMail.renderKioskDay(
    dayA, dayMail.words(await runWithOrganization(A, () => documentLanguage(P1))),
    propRow!.name, 'alisio');
  assert.ok(frLetter.text.includes('Self check-ins'),
    `лист для FR-юрисдикції не англійською: ${frLetter.text.slice(0, 120)}`);
  await runWithOrganization(A, () => sql.run("UPDATE properties SET country = 'DE' WHERE id = ?", [P1]));
  console.log('  ok  21. лист: підсумок доби, список рецепції лише в external, порожня доба словом; юрисдикція поза словником — англійська');

  // ── 22. Картка: чужий термінал — 404; повторне відкликання — одна подія ─
  // Хендлери картки загорнуті у `withOwner`, а він читає куку — під голим
  // node запиту немає, і виклик падає на `cookies()`, не дійшовши до правила.
  // Тому вісь стверджується на тому шарі, який хендлер і кличе: саме його
  // нуль змінених рядків стає 404 у відповіді. HTTP-бік того самого — у
  // родині «кіоск» `check:routes`, на живому сервері з сесією.
  const seenByA = await runWithOrganization(A, () => devices.listDevices(A, ALL_PROPERTIES));
  assert.ok(!seenByA.some((d) => d.id === deviceB), 'термінал B видно на картці A');
  const revokedAlien = await runWithOrganization(A, () => devices.revokeDevice(A, deviceB));
  assert.strictEqual(revokedAlien, false, 'власник A відкликав термінал готелю B');
  const stillLive = await runWithOrganization(B, () => devices.listDevices(B, ALL_PROPERTIES));
  assert.ok(stillLive.some((d) => d.id === deviceB && !d.revoked_at),
    'термінал B усе-таки відкликано чужими руками');
  // Вигляд теж не записується в чужий термінал: той самий UPDATE із чужим
  // орендарем міняє нуль рядків, і саме нуль хендлер віддає як 404.
  const alienCfg = await runWithOrganization(A, () => sql.run(
    'UPDATE kiosk_devices SET config_json = ? WHERE id = ? AND organization_id = ?',
    ['{"touch_band":{"top":1,"bottom":99}}', deviceB, A]));
  assert.strictEqual(alienCfg.changes, 0, 'вигляд чужого термінала записався');
  // Повторне відкликання свого термінала — false, і журнал не росте.
  const beforeRevoke = await eventCount(A);
  const revoke1 = await runWithOrganization(A, () => devices.revokeDevice(A, dev.deviceId));
  const revoke2 = await runWithOrganization(A, () => devices.revokeDevice(A, dev.deviceId));
  assert.strictEqual(revoke1, true, 'перше відкликання не спрацювало');
  assert.strictEqual(revoke2, false, 'повторне відкликання «спрацювало» вдруге');
  assert.strictEqual(await eventCount(A), beforeRevoke, 'відкликання дописало подію в журнал');
  // Крон: обʼєкт із терміналом і БЕЗ адреси видно числом, а не мовчки.
  //
  // Клас INC-014: перша редакція рахувала «немає адреси» і «немає термінала»
  // одним числом, і крон відповідав «відпрацював» готелю, який щодня заселяє
  // гостей через екран і жодного разу не отримав списку.
  const mailRun = await dayMail.sendKioskDayMails();
  assert.ok(mailRun.withoutAddress >= 1,
    `обʼєкт із терміналом без адреси не порахований: ${JSON.stringify(mailRun)}`);
  assert.strictEqual(mailRun.sent, 0, 'пошти в перевірці немає, а лист «пішов»');
  // Друга вісь: обʼєкт БЕЗ термінала не рахується ні тим, ні тим — він просто
  // не в справі, і мовчазний пропуск тут правильний.
  assert.ok(mailRun.skipped >= 1,
    `обʼєкт без термінала має бути пропущений мовчки: ${JSON.stringify(mailRun)}`);
  console.log('  ok  22. чужий термінал — не свій; повторне відкликання не вдруге; «є термінал, немає адреси» видно числом');

  // ── 23. Робоча смуга поза [0,100] — дефолт, а не порожній екран ─────────
  // NaN тут не випадковий: `JSON.stringify` перетворює його на `null`, а
  // `Number(null)` — це 0. Смуга з NaN поверталася б як `{top: 0}` — тобто
  // «правильна» і від самого верху екрана. Той самий шлях у рядків і масивів.
  for (const bad of [
    { top: -5, bottom: 80 }, { top: 40, bottom: 140 }, { top: 80, bottom: 30 },
    { top: NaN, bottom: 80 }, { top: 40, bottom: 40 },
    { top: '35', bottom: '85' }, { top: [], bottom: 80 }, { top: 35 },
  ]) {
    const cfg = JSON.stringify({ touch_band: bad });
    await runWithOrganization(A, () => sql.run(
      'UPDATE kiosk_devices SET config_json = ? WHERE id = ? AND organization_id = ?',
      [cfg, dev.deviceId, A]));
    // Читає та сама функція, що й сесія термінала.
    const band = session.readTouchBand(cfg);
    assert.deepStrictEqual(band, session.DEFAULT_TOUCH_BAND,
      `смуга ${JSON.stringify(bad)} мала стати дефолтною, стала ${JSON.stringify(band)}`);
  }
  // І правильна смуга ПРОХОДИТЬ — інакше сцена доводила б, що дефолт завжди.
  assert.deepStrictEqual(
    session.readTouchBand(JSON.stringify({ touch_band: { top: 25, bottom: 75 } })),
    { top: 25, bottom: 75 }, 'правильна смуга не дійшла до екрана');
  console.log('  ok  23. смуга поза [0,100], перевернута й нечислова — дефолт; правильна проходить');

  // ── 24. Дата, набрана не в тій формі, — НАЗВАНА відмова, а не 500 ───────
  //
  // Знайдено на живому екрані, не гейтом: власник набрав прізвище і дату, і
  // отримав «Keine Buchung gefunden» — тобто відповідь ПРО БРОНЬ на те, що
  // було помилкою ВВОДУ. Під сподом було гірше за неточне слово:
  //
  //   new Date('11.09.2026T00:00:00Z')  →  Invalid Date
  //   .toISOString()                     →  RangeError: Invalid time value
  //
  // Тобто маршрут пошуку віддавав 500, а екран малював «не знайдено», бо він
  // розрізняє лише `ok`/`не ok`. Гість читав відповідь про чужу бронь там, де
  // насправді впав сервер.
  //
  // Клавіатура при цьому давала рівно ті символи, якими цю помилку роблять:
  // цифри, «.» і «-». Формат дати на екрані в холі не вгадується — тому дату
  // тепер ОБИРАЮТЬ календарем, а рядок, який не є днем, не рахується чинником
  // (як телефон, коротший за номер, у сцені 13).
  // Свій термінал: попередній уже відкликано сценою 22, і сцена, яка цього не
  // помітила б, читала б 401 замість відповіді про дату.
  const dated = await runWithOrganization(A, () => devices.createPairing({ organizationId: A, propertyId: P1, name: 'Date' }));
  const datedDev = (await (await pair(dated.code)).json()) as { token: string; deviceId: string };
  const datedTok = datedDev.token;
  for (const bad of ['11.09.2026', '11092026', '09/11/2026', '11-09-2026', '2026-13-01', '2026-02-30', '.']) {
    found = await stay.findStay(post('find', { lastName: 'Fenster', checkIn: bad }, datedTok));
    assert.strictEqual(found.status, 400,
      `дата «${bad}»: очікували 400 (не чинник), отримали ${found.status}`);
  }
  // Друга вісь тієї самої межі: справжній день чинником Є — інакше сцена
  // доводила б лише те, що дата не працює ніколи. Близнюка сцени 15 тут прибрано
  // з-під того самого прізвища: інакше пара віддала б `need_more`, і твердження
  // «дата — чинник» сховалося б за «збігів двоє».
  await runWithOrganization(A, () => sql.run(
    "UPDATE guests SET last_name = 'Zwilling' WHERE id = ?", ['kc_twin_g']));
  // І повертається в живі: сцена 17 виселила цю бронь, а `checked_out` термінал
  // не бачить за побудовою — сцена мовчки перевіряла б статус замість дати.
  await runWithOrganization(A, () => sql.run(
    "UPDATE reservations SET check_in = ?, check_out = ?, status = 'confirmed' WHERE id = ?",
    [day(0), day(1), 'kc_find']));
  found = await stay.findStay(post('find', { lastName: 'Fenster', checkIn: day(0) }, datedTok));
  assert.strictEqual(((await found.json()) as any).found, true,
    'справжня дата перестала бути чинником');
  // І третя: високосний день існує, коли він існує.
  assert.strictEqual(search.readSearchDate('2024-02-29'), '2024-02-29', '29 лютого 2024 — справжній день');
  assert.strictEqual(search.readSearchDate('2026-02-29'), null, '29 лютого 2026 не існує, а прийнято');
  console.log('  ok  24. дата не в тій формі — 400 «введіть ще одне поле», не 500 і не «не знайдено»');

  // ── 25. Вигляд: лого й фон доходять до екрана, і тільки безпечною адресою ─
  //
  // Картка застосунку зберігає `logo_url` і `background_url` у `config_json`
  // пристрою з частини В — а сесія їх НЕ віддавала. Тобто оператор заповнював
  // два поля, тиснув «Зберегти», бачив підтвердження, і на терміналі не
  // мінялось нічого: запис, якого ніхто не читає (клас `audit-dead-data`).
  //
  // Друга половина сцени важливіша за першу. Адресу набирає ЛЮДИНА в полі
  // форми, а екран підставляє її в `src` картинки — тобто `javascript:` там
  // це виконаний код на терміналі, до якого підходить будь-хто. Тому
  // дозволені рівно три форми: `https://`, `http://` і свій шлях від кореня.
  const look = (cfg: unknown) => session.readAppearance(JSON.stringify(cfg));
  assert.deepStrictEqual(
    look({ logo_url: 'https://cdn.example.test/l.png', background_url: '/uploads/b.jpg' }),
    { logoUrl: 'https://cdn.example.test/l.png', backgroundUrl: '/uploads/b.jpg' },
    'звичайні адреси не дійшли до екрана');
  for (const bad of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)',
    'data:text/html,<script>x</script>', 'vbscript:x', '//evil.test/l.png',
    'file:///etc/passwd', 42, null, {}, [],
  ]) {
    assert.deepStrictEqual(look({ logo_url: bad, background_url: bad }),
      { logoUrl: null, backgroundUrl: null },
      `адреса ${JSON.stringify(bad)} мала бути відкинута`);
  }
  // І сесія віддає їх ПОРУЧ зі смугою — інакше сцена доводила б лише те, що
  // чиста функція чиста, а екран і далі не мав би чого показати.
  await runWithOrganization(A, () => sql.run(
    'UPDATE kiosk_devices SET config_json = ? WHERE id = ? AND organization_id = ?',
    [JSON.stringify({ touch_band: { top: 30, bottom: 90 }, logo_url: '/uploads/logo.svg' }),
      datedDev.deviceId, A]));
  const seen = await (await session.deviceSession(new Request('http://alisio.test/api/apps/kiosk/session', {
    headers: { authorization: `Bearer ${datedTok}` },
  }))).json() as { logoUrl?: string | null; backgroundUrl?: string | null };
  assert.strictEqual(seen.logoUrl, '/uploads/logo.svg', `лого не приїхало в сесію: ${JSON.stringify(seen)}`);
  assert.strictEqual(seen.backgroundUrl, null, 'незаданий фон мав приїхати як null, а не зникнути');
  console.log('  ok  25. лого й фон доходять до екрана; javascript:, data: і «//» — відкинуті');

  console.log('  ok  kiosk: термінал робить лише своє — свій рахунок, свій корпус, свою бронь');
} finally {
  await cleanup();
  fs.rmSync(tmp, { recursive: true, force: true });
}
