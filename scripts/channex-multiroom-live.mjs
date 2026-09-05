/**
 * Бронювання на КІЛЬКА КІМНАТ проти живого вендора — і читання назад (К1).
 *
 *   node scripts/channex-multiroom-live.mjs --property <remotePropertyId> \
 *        --room <remoteRoomTypeId>:<remoteRatePlanId> \
 *        --room <remoteRoomTypeId>:<remoteRatePlanId> [--from 2027-08-10] [--confirm]
 *
 * Без `--confirm` — лише читання: що саме буде створено і що зараз у стрічці.
 * З `--confirm` — повний прохід чотирма кроками, тими самими, що й у гейта
 * `inbound-bookings.check.ts`, тільки крізь справжній API:
 *
 *   1. створити бронь на дві кімнати різних типів  → наш прохід стрічки
 *   2. змінити дати обох кімнат                     → наш прохід
 *   3. прибрати ПЕРШУ кімнату                       → наш прохід
 *   4. скасувати бронювання                         → наш прохід
 *
 * ── Навіщо це, якщо гейт зелений ────────────────────────────────────────
 *
 * Бо гейт стоїть на ревізіях, які склала ця ж сесія. Інваріант 27: живий
 * прохід закриває фазу лише якщо ЧИТАЄ НАЗАД, і читає повз власний клієнт.
 * Тут читається двічі — стрічка вендора (що він насправді надіслав) і наша
 * база (що з цього стало), — і саме між ними живуть помилки, яких мок не
 * бачить: чи справді кімнати приходять окремими `rooms[]`, чи є в них
 * `ota_unique_id`, чи однакова заселеність зверху й усередині.
 *
 * ── Джерело броні — Booking CRS ─────────────────────────────────────────
 *
 * Тестового акаунта Booking.com немає (§10.3 ТЗ), і запасний шлях названий у
 * самій сертифікації: застосунок Booking CRS створює, змінює і скасовує
 * бронювання через `POST/PUT /api/v1/bookings`. Вендор проводить їх «over
 * regular pipeline» — тобто вони лягають у ту саму стрічку ревізій, що й
 * справжні броні OTA, і наш бік не відрізняє їх ніяк.
 *
 * ── Досліди лише на СВОЇХ обʼєктах (інваріант 25) ───────────────────────
 *
 * Акаунт staging спільний, і поруч живе справжній клієнт вендора. Скрипт
 * пише виключно в обʼєкт, названий у `--property`, і нічого не шукає сам:
 * ідентифікатор передає людина, яка знає, що він наш. Дати — 2027-08 за
 * замовчуванням, навмисно далеко від дат сертифікаційних тестів
 * (листопад 2026 – травень 2027): їх не можна чіпати, поки йде перегравання.
 *
 * Прибирання: прохід закінчується скасуванням бронювання, і це і є стан
 * спокою — видалення броней вендор не має взагалі. Локальний засів
 * (`__mrlive__…`) прибирається завжди, і на виході теж.
 *
 * ── Локальний засів ─────────────────────────────────────────────────────
 *
 * Щоб прогнати НАШ прохід, потрібні орендар, обʼєкт, два типи номерів,
 * зʼєднання і дзеркало мапінгу — інакше ревізія прийде `unmapped` і нічого
 * не доведе. Скрипт заводить їх сам під префіксом `__mrlive__`, бо жива
 * перевірка, яка вимагає підготовленої вручну бази, не запускається ніколи.
 */
import './lib/module-aliases.mjs';
import { sampleRecorder } from './lib/channex-samples.mjs';

const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--confirm');
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const rooms = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--room' && argv[i + 1]) {
    const [roomTypeId, ratePlanId] = argv[++i].split(':');
    if (!roomTypeId || !ratePlanId) {
      console.error('--room очікує <remoteRoomTypeId>:<remoteRatePlanId>');
      process.exit(2);
    }
    rooms.push({ roomTypeId, ratePlanId });
  }
}

const REMOTE_PROPERTY = opt('--property');
const FROM = opt('--from', '2027-08-10');
if (!REMOTE_PROPERTY || rooms.length < 2) {
  console.error('usage: node scripts/channex-multiroom-live.mjs --property <id> --room <rt>:<rp> --room <rt>:<rp> [--from 2027-08-10] [--confirm]');
  console.error('  дві кімнати — мінімум: з однією ця перевірка не про що');
  process.exit(2);
}
// Дати сертифікації не чіпаються, поки триває перегравання (задача Блоку 3).
if (FROM >= '2026-11-01' && FROM < '2027-06-01') {
  console.error(`✗ ${FROM} — усередині вікна сертифікаційних тестів (2026-11 … 2027-05). Візьміть інші дати.`);
  process.exit(2);
}

const apiKey = process.env.CHANNEX_API_KEY;
if (!apiKey) { console.error('немає CHANNEX_API_KEY в оточенні'); process.exit(2); }

/**
 * Ключ шифрування облікових даних — разовий, якщо його немає.
 *
 * `saveIntegrationCredentials` навмисно ВІДМОВЛЯЄТЬСЯ писати секрет у чистому
 * вигляді без `APP_SECRET_KEY`, і це правильно. Але тут він шифрує рядок у
 * ЛОКАЛЬНІЙ базі розробки, яку цей же скрипт наприкінці стирає: постійного
 * ключа для цього не треба, а вимога принести його руками означала б, що
 * жива перевірка не запускається ніколи (саме на цьому 05.09.2026 спинився
 * живий прохід Блоку 2 — MASTER-PLAN §4, Блок 3, п. 2).
 *
 * Випадковий і лише в памʼяті процесу: у файл не потрапляє, у git не
 * потрапляє (інваріант 7), і разом із засівом зникає. Якщо ключ у оточенні
 * вже є — беремо його й нічого не вигадуємо.
 */
if (!process.env.APP_SECRET_KEY) {
  process.env.APP_SECRET_KEY = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  console.log('APP_SECRET_KEY: разовий, лише для локального засіву цього прогону');
}
const HOST = (process.env.CHANNEX_ENV ?? 'staging') === 'production'
  ? 'https://app.channex.io' : 'https://staging.channex.io';

const day = (base, plus) => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plus);
  return d.toISOString().slice(0, 10);
};

/** Сирий виклик вендора — ПОВЗ наш клієнт: читання назад має бути незалежним. */
async function raw(method, path, body) {
  const res = await fetch(`${HOST}/api/v1${path}`, {
    method,
    headers: { 'user-api-key': apiKey, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return payload;
}

/**
 * Booking CRS на обʼєкті — застосунок, без якого `POST /bookings` віддає 403.
 *
 * «Property should have Booking CRS App installed to have access for Booking
 * CRS API», і виміряно 06.09.2026: без нього рівно `403 forbidden`, без
 * жодної підказки в тілі. Застосунок безкоштовний (`price: null`).
 *
 * Ставимо лише якщо його немає, і знімаємо лише те, що поставили самі: на
 * спільному акаунті вимкнути чуже — гірше, ніж не поставити своє.
 */
async function ensureBookingCrs() {
  const installed = await raw('GET', '/applications/installed');
  const apps = await raw('GET', '/applications');
  const crs = (apps?.data ?? []).find((a) => a?.attributes?.code === 'booking_crs');
  if (!crs) throw new Error('Booking CRS немає в каталозі застосунків вендора');
  const mine = (installed?.data ?? []).find((r) =>
    r?.attributes?.property_id === REMOTE_PROPERTY && r?.attributes?.application_id === crs.id);
  if (mine) {
    console.log('  Booking CRS уже стоїть на цьому обʼєкті — не чіпаємо');
    return null;
  }
  const put = await raw('POST', '/applications/install', {
    application_installation: { property_id: REMOTE_PROPERTY, application_code: 'booking_crs' },
  });
  const id = put?.data?.attributes?.id ?? put?.data?.id;
  console.log(`  Booking CRS поставлено на обʼєкт (встановлення ${id}) — знімемо наприкінці`);
  return id;
}

/** Тіло однієї кімнати для Booking CRS. `days` — розбивка ціни по ночах. */
function roomBody(room, from, to, adults, amount) {
  const days = {};
  const nights = Math.max(1, Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
  for (let i = 0; i < nights; i++) days[day(from, i)] = (amount / nights).toFixed(2);
  return {
    room_type_id: room.roomTypeId,
    rate_plan_id: room.ratePlanId,
    checkin_date: from,
    checkout_date: to,
    days,
    occupancy: { adults, children: 0, infants: 0 },
    guests: [{ name: 'Multi', surname: 'Room' }],
  };
}

const CODE = `MR-${Date.now().toString().slice(-8)}`;
const A = { from: FROM, to: day(FROM, 2), adults: 2, amount: 300 };
const B = { from: FROM, to: day(FROM, 3), adults: 1, amount: 210 };

function bookingBody(status, roomList) {
  const froms = roomList.map((r) => r.from).sort();
  const tos = roomList.map((r) => r.to).sort();
  return {
    booking: {
      ...(status ? { status } : {}),
      property_id: REMOTE_PROPERTY,
      ota_reservation_code: CODE,
      ota_name: 'Offline',
      arrival_date: froms[0],
      departure_date: tos[tos.length - 1],
      currency: 'EUR',
      // Заселеність БРОНЮВАННЯ — навмисно не сума кімнат: саме на цій осі
      // «за ревізією» і «сума кімнат» розходяться (К1).
      occupancy: { adults: roomList.reduce((n, r) => n + r.adults, 0), children: 1, infants: 0 },
      customer: { name: 'Multi', surname: 'Room', mail: 'multiroom@example.test', country: 'CZ' },
      rooms: roomList.map((r) => roomBody(r.room, r.from, r.to, r.adults, r.amount)),
    },
  };
}

console.log(`ОБʼЄКТ ${REMOTE_PROPERTY} (${HOST}); код броні ${CODE}; дати ${FROM}…${day(FROM, 3)}`);
console.log(`  кімната 1: тип ${rooms[0].roomTypeId.slice(0, 8)} тариф ${rooms[0].ratePlanId.slice(0, 8)} — ${A.from}…${A.to}, ${A.adults} дор.`);
console.log(`  кімната 2: тип ${rooms[1].roomTypeId.slice(0, 8)} тариф ${rooms[1].ratePlanId.slice(0, 8)} — ${B.from}…${B.to}, ${B.adults} дор.`);

if (!CONFIRM) {
  const feed = await raw('GET', `/booking_revisions/feed?filter[property_id]=${encodeURIComponent(REMOTE_PROPERTY)}&order[inserted_at]=asc`);
  console.log(`\nстрічка зараз: ${feed?.meta?.total ?? 0} непідтверджених ревізій`);
  console.log('нічого не створено — додайте --confirm');
  process.exit(0);
}

// ── Локальний засів ────────────────────────────────────────────────────────
const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { setFeature } = await import('@core/features');
const { saveIntegrationCredentials } = await import('@core/integration-credentials');
const { pullConnectionNow, recordVendorResponses } = await import('@channels');
recordVendorResponses(sampleRecorder());

const sql = getSql();
const ORG = '__mrlive__org';
const PROP = '__mrlive__prop';
const CAT = '__mrlive__cat';
const T1 = '__mrlive__t1';
const T2 = '__mrlive__t2';
const CONN = '__mrlive__conn';

async function wipe() {
  await runWithOrganization(ORG, async () => {
    for (const t of ['cm_inbound_bookings', 'cm_events', 'cm_outbox', 'cm_mappings', 'booking_activity_log']) {
      await sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]);
    }
    await sql.run('DELETE FROM reservations WHERE organization_id = ? AND parent_id IS NOT NULL', [ORG]);
    await sql.run('DELETE FROM reservations WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM channel_credentials WHERE organization_id = ?', [ORG]);
    await sql.run('DELETE FROM organization_features WHERE organization_id = ?', [ORG]);
    await sql.run("DELETE FROM guests WHERE organization_id = ?", [ORG]);
    await sql.run("DELETE FROM unit_types WHERE id LIKE '__mrlive__%'", []);
    await sql.run("DELETE FROM categories WHERE id LIKE '__mrlive__%'", []);
    await sql.run("DELETE FROM properties WHERE id LIKE '__mrlive__%'", []);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

await wipe();
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'MR live', ORG]);
await runWithOrganization(ORG, async () => {
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, 'MR live', PROP]);
  await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [CAT, PROP, 'Rooms', 'room']);
  await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)', [T1, PROP, CAT, 'MR-1', 'MR1']);
  await sql.run('INSERT INTO unit_types (id, property_id, category_id, name, code) VALUES (?, ?, ?, ?, ?)', [T2, PROP, CAT, 'MR-2', 'MR2']);
  await sql.run(
    `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment,
                                 remote_property_id, webhook_token, webhook_secret, is_enabled)
     VALUES (?, ?, ?, 'channex', ?, ?, ?, ?, TRUE)`,
    [CONN, ORG, PROP, process.env.CHANNEX_ENV ?? 'staging', REMOTE_PROPERTY,
      `mrlive_${Date.now()}`, `mrlive_secret_${Date.now()}`]);
  // Дзеркало: чужий тип → наш. Без нього ревізія приходить `unmapped`, і
  // прохід доводить лише те, що ми вміємо не впізнавати кімнати.
  for (const [local, remote] of [[T1, rooms[0].roomTypeId], [T2, rooms[1].roomTypeId]]) {
    await sql.run(
      `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
       VALUES (?, ?, ?, 'unit_type', ?, '', 0, ?)`,
      [crypto.randomUUID(), ORG, CONN, local, remote]);
  }
  // Модуль каналів платний і за замовчуванням вимкнений (Р8), а ключ живе в
  // облікових даних організації (Ц18) — не в `cm_connections`. Без обох
  // `pullConnectionNow` мовчки віддає `null`: не помилка, а «цьому готелю
  // канали не продані». Засів мусить дати обидва, інакше живий прохід
  // доводить лише те, що варта на місці.
  await setFeature(ORG, 'channels', true);
  await saveIntegrationCredentials(ORG, 'channel_manager', { accessToken: apiKey });
});
console.log(`\nзасів: орендар ${ORG}, зʼєднання ${CONN} → обʼєкт ${REMOTE_PROPERTY}`);

let failures = 0;

/** Наш прохід стрічки — ті самі двері, що в крона. */
async function ourPass(label) {
  const report = await runWithOrganization(ORG, () => pullConnectionNow(CONN));
  // `null` — це НЕ «побачено нуль»: прохід не відбувся взагалі (модуль
  // вимкнений, зʼєднання вимкнене, ключа немає). Друкувати його нулем — та
  // сама помилка, що И4: тиша, яка читається як успіх. Коштувала одного
  // прогону 06.09.2026.
  if (!report) {
    failures++;
    console.log(`  ✗ прохід «${label}» НЕ ВІДБУВСЯ: модуль каналів вимкнений, зʼєднання вимкнене або немає ключа`);
    return null;
  }
  console.log(`  прохід «${label}»: побачено ${report.seen}, застосовано ${report.applied}, `
    + `повторів ${report.duplicates}, підтверджено ${report.acked}, пропущено ${report.skipped.length}`);
  for (const s of report.skipped) console.log(`    ✗ ${s.remoteRevisionId ?? '?'}: ${s.reason}`);
  return report;
}

/** Наша база після проходу — те, що побачить рецепція. */
async function ourGroup() {
  return await runWithOrganization(ORG, async () => {
    const parent = await sql.row(
      'SELECT * FROM reservations WHERE organization_id = ? AND external_uid = ?', [ORG, CODE]);
    const kids = parent ? await sql.rows(
      'SELECT * FROM reservations WHERE parent_id = ? ORDER BY external_uid', [parent.id]) : [];
    return { parent, kids };
  });
}

function show({ parent, kids }) {
  if (!parent) { console.log('    ✗ батьківської броні немає'); return; }
  console.log(`    батьківська ${String(parent.check_in).slice(0, 10)}…${String(parent.check_out).slice(0, 10)}`
    + ` · ${parent.nights} н. · ${parent.adults}+${parent.children} гост. · ${parent.total_price} ${parent.currency}`
    + ` · тип ${parent.unit_type_id ?? '—'} · ${parent.status}`);
  for (const k of kids) {
    console.log(`      дочірня ${k.external_uid} · тип ${k.unit_type_id ?? '—'}`
      + ` · ${String(k.check_in).slice(0, 10)}…${String(k.check_out).slice(0, 10)} · ${k.nights} н.`
      + ` · ${k.adults} дор. · ${k.total_price} · ${k.status}`);
  }
}

/** Що вендор віддав про це бронювання — сирим GET, повз наш клієнт. */
async function theirBooking(bookingId) {
  const payload = await raw('GET', `/bookings/${encodeURIComponent(bookingId)}`);
  const a = payload?.data?.attributes ?? {};
  console.log(`    вендор: статус ${a.status}, ${a.arrival_date}…${a.departure_date}, ${a.amount} ${a.currency},`
    + ` кімнат ${(a.rooms ?? []).length}, заселеність ${JSON.stringify(a.occupancy)}`);
  for (const r of a.rooms ?? []) {
    console.log(`      кімната тип ${String(r.room_type_id).slice(0, 8)} · ${r.checkin_date}…${r.checkout_date}`
      + ` · ${r.amount} · ota_unique_id ${JSON.stringify(r.ota_unique_id)} · ${JSON.stringify(r.occupancy)}`);
  }
  return a;
}

const expect = (ok, what) => { if (!ok) { failures++; console.log(`    ✗ ${what}`); } else console.log(`    ✓ ${what}`); };

let installedByUs = null;
try {
  // ── 0. Booking CRS ──────────────────────────────────────────────────────
  console.log('\n0. застосунок Booking CRS на обʼєкті');
  installedByUs = await ensureBookingCrs();

  // ── 1. Створити бронь на дві кімнати ────────────────────────────────────
  console.log('\n1. створюємо бронь на дві кімнати через Booking CRS');
  const made = await raw('POST', '/bookings', bookingBody(null, [
    { room: rooms[0], ...A }, { room: rooms[1], ...B },
  ]));
  const bookingId = made?.data?.attributes?.booking_id ?? made?.data?.id;
  console.log(`  вендор завів бронювання ${bookingId} (ревізія ${made?.data?.attributes?.revision_id})`);
  // Вендор кладе бронь асинхронно: «if you trigger request immediately after
  // receiving response you can get 404». Дві секунди — не таймаут, а те, що
  // документація прямо просить.
  await new Promise((r) => setTimeout(r, 3000));
  await theirBooking(bookingId);
  await ourPass('створення');
  let g = await ourGroup();
  show(g);
  expect(!!g.parent, 'батьківська бронь групи створена');
  expect(g.kids.length === 2, `дочірніх дві (є ${g.kids.length})`);
  expect((g.parent?.unit_type_id ?? null) === null, 'батьківська без типу — наявність не рахує зайвий номер');
  expect(new Set(g.kids.map((k) => String(k.unit_type_id))).size === 2, 'дочірні на РІЗНИХ типах');
  expect(g.kids.every((k) => k.unit_id === null), 'дочірні без номера (П9)');

  // ── 2. Змінити дати обох кімнат ─────────────────────────────────────────
  console.log('\n2. змінюємо дати обох кімнат');
  const A2 = { ...A, from: day(FROM, 1), to: day(FROM, 3) };
  const B2 = { ...B, from: day(FROM, 2), to: day(FROM, 5) };
  await raw('PUT', `/bookings/${encodeURIComponent(bookingId)}`, bookingBody('modified', [
    { room: rooms[0], ...A2 }, { room: rooms[1], ...B2 },
  ]));
  await new Promise((r) => setTimeout(r, 3000));
  await theirBooking(bookingId);
  await ourPass('зміна дат');
  g = await ourGroup();
  show(g);
  expect(String(g.parent?.check_in).slice(0, 10) === A2.from, `проміжок групи починається ${A2.from}`);
  expect(String(g.parent?.check_out).slice(0, 10) === B2.to, `проміжок групи закінчується ${B2.to} — найпізнішим виїздом`);
  expect(g.kids.length === 2, 'зміна дат не подвоїла групу');

  // ── 3. Прибрати ПЕРШУ кімнату ───────────────────────────────────────────
  console.log('\n3. прибираємо ПЕРШУ кімнату');
  await raw('PUT', `/bookings/${encodeURIComponent(bookingId)}`, bookingBody('modified', [
    { room: rooms[1], ...B2 },
  ]));
  await new Promise((r) => setTimeout(r, 3000));
  await theirBooking(bookingId);
  await ourPass('прибрана кімната');
  g = await ourGroup();
  show(g);
  expect(g.kids.length === 2, 'скасована дочірня лишилась у базі, а не зникла');
  expect(g.kids.filter((k) => String(k.status) === 'cancelled').length === 1, 'скасувалась рівно одна дочірня');
  expect(String(g.parent?.status) !== 'cancelled', 'група ще жива');

  // ── 4. Скасувати бронювання ─────────────────────────────────────────────
  console.log('\n4. скасовуємо бронювання');
  await raw('PUT', `/bookings/${encodeURIComponent(bookingId)}`, bookingBody('cancelled', [
    { room: rooms[1], ...B2 },
  ]));
  await new Promise((r) => setTimeout(r, 3000));
  await theirBooking(bookingId);
  await ourPass('скасування');
  g = await ourGroup();
  show(g);
  expect(String(g.parent?.status) === 'cancelled', 'батьківська скасована');
  expect(g.kids.every((k) => String(k.status) === 'cancelled'), 'усі дочірні скасовані');

  // Стрічка порожня — усе підтверджено (И5): непідтверджена ревізія
  // повернулася б через 30 хвилин листом.
  const left = await raw('GET', `/booking_revisions/feed?filter[property_id]=${encodeURIComponent(REMOTE_PROPERTY)}`);
  console.log(`\nстрічка після проходу: ${left?.meta?.total ?? 0} непідтверджених`);
  expect((left?.meta?.total ?? 0) === 0, 'усі ревізії підтверджені — стрічка порожня');

  console.log(failures === 0
    ? `\n✓ живий прохід К1 зелений: ${CODE}, бронювання ${bookingId} лишається скасованим на обʼєкті`
    : `\n✗ живий прохід К1: ${failures} невідповідність(і)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error(`\n✗ прохід зупинився: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await wipe();
  console.log('локальний засів прибрано');
  if (installedByUs) {
    try {
      await raw('DELETE', `/applications/${encodeURIComponent(installedByUs)}/uninstall`);
      console.log('Booking CRS знято з обʼєкта — акаунт лишається таким, яким був');
    } catch (e) {
      console.error(`⚠ Booking CRS лишився встановленим (${installedByUs}): ${e instanceof Error ? e.message : e}`);
    }
  }
}
