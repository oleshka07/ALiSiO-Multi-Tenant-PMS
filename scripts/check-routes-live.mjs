/**
 * Головні маршрути ВІДПОВІДАЮТЬ — по-справжньому, через HTTP, з живими даними.
 *
 *   npm run build:win && npm run start
 *   node scripts/check-routes-live.mjs
 *
 * ── Навіщо, якщо гейтів уже сотня ────────────────────────────────────────
 *
 * Двічі поспіль вада вбивала ЦІЛИЙ маршрут при повністю зелених гейтах:
 *
 *   * `/api/guest/[token]` — пропущена кома в `SELECT` (27.07 → 07.09.2026,
 *     `183f273`). Сторінка, на яку веде лист гостю, не відкривалась півтора
 *     місяця; SQL — рядок, тож `tsc` мовчав, а жоден гейт не питав.
 *   * `/api/bookings/[id]/invoice` — рядки JS-коментаря `//` всередині
 *     SQL-шаблону (28.08 → 07.09.2026, `fa9b2b7`). `INSERT` не парсився,
 *     `catch` ковтав виняток, виклик був fire-and-forget: бронь створювалась
 *     «успішно», фактури не було, а маршрут чесно віддавав `null` і 200.
 *
 * Один клас, і він не про SQL. **Усі перевірки ходять шаром репозиторію, і
 * жодна не питає, що відповідає сам маршрут.** Репозиторій можна перевірити
 * до останньої гілки, а зламатись може все, що між ним і клієнтом: SQL у
 * рядку, варта, реєстрація маршруту, серіалізація, ковтнутий виняток.
 *
 * Наявне покриття, виміряне: `smoke-routes.mjs` обходить лише СТАТИЧНІ GET
 * (`if (url.includes('[')) continue`), а з 303 маршрутів застосунку 130
 * динамічні — і обидві вади жили саме там. `check-isolation.mjs` ходить
 * живим HTTP, але стверджує про орендаря: «сусід не бачить», а не «свій
 * бачить те, що йому потрібно».
 *
 * ── Скільки це покриває насправді (Р8.14) ────────────────────────────────
 *
 * ДЕСЯТЬ родин, **72 твердження** (68 місць виклику `claim(`; різниця — два
 * цикли: пʼять полів відповіді каналу і чотири види аркуша дня), і **ПʼЯТЬ
 * динамічних маршрутів зі 130**: `/api/bookings/[id]`,
 * `/api/bookings/[id]/invoice`, `/api/guest/[token]`,
 * `/api/channels/connections/[id]/frame`, `/api/day-sheets/[kind]`.
 *
 * Обидві історичні вади в цьому наборі є — ціль узято правильно, — але поруч
 * із «130 динамічних» це легко прочитати як закритий клас. Клас НЕ закритий:
 * закрито пʼять маршрутів із нього. Статичних маршрутів гейт торкається ще
 * десяти (обʼєкт, тип, номер, ціни, броні, віджет, публічна наявність, два
 * звіти) — але саме динамічні були тим, чого не бачив `smoke-routes`.
 *
 * Друга родина (08.09.2026) додалась дешево, як і обіцяла фікстура: віджет,
 * публічна вітрина, звіти, день готелю. Дорогою вона виправила ДВА МОЇ
 * припущення про форму відповіді — `displayRates` виявився обʼєктом, а не
 * масивом, і аркуш дня без дати бере день ГОТЕЛЮ, а не відмовляє 400. Обидва
 * знайшов живий прогін; читанням коду я їх не побачила.
 *
 * ── Що тут стверджується ─────────────────────────────────────────────────
 *
 * Здебільшого ФОРМА відповіді: поля, без яких екран порожній, і числа, які
 * мають збігтися з введеними. Не «не 5xx» — фактура віддавала 200 і `null`,
 * статус був бездоганний.
 *
 * Але не «ніколи статус»: там, де статус І Є відповіддю, стверджується саме
 * він — 404 на чужий токен, 409 `catalog_not_synced` на маршруті каналу,
 * 201 на створення. Різниця в тому, що жодне з цих тверджень не задовольняє
 * будь-яка відповідь: `status !== 500` таким було, і його прибрано (Р8.12).
 *
 * ── Чому збирає всі відмови, а не падає на першій ────────────────────────
 *
 * Гейт, який спиняється на першій зламаній родині, приховує решту: полагодив
 * одне — дізнався про друге, і так п'ять прогонів по дві хвилини. Тут кожна
 * родина йде до кінця, а звіт наприкінці називає всі.
 *
 * Прибирає за собою: усе створене має тег в id, і `cleanup()` іде першим і
 * останнім.
 *
 * ── Куди цим НЕ можна цілитись ───────────────────────────────────────────
 *
 * Гейт ПИШЕ: заводить організацію, користувача, обʼєкт, тип, номер, ціни,
 * бронь, фактуру, зʼєднання каналу і сайт бронювання — і потім це видаляє.
 * Тому `BASE_URL` вказує лише на СВІЙ застосунок над СВОЄЮ базою: локальний
 * прогін або крок CI. Проти беті чи прода його гнати не можна взагалі —
 * не через перевірку збірки, а через те, що він там насмітить і видалить.
 *
 * Саме тому перевірка «на порту твоя збірка» не має винятку «а це віддалений
 * сервер»: віддаленого сервера тут не буває за призначенням (Р11.2).
 */
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { getSql } from '../src/core/db/async.ts';
import { runWithOrganization } from '../src/core/auth/tenant-context.ts';
import { nameResolver, missingFrom, isUnresolvedObject } from './lib/db-names.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TAG = '__routes_live__';

// Той самий постійний хеш, що в `check-isolation.mjs`, і з тієї ж причини:
// standalone-складання вбудовує bcryptjs у сервер, тож контейнер, зібраний з
// образу застосунку, імпортувати його не може.
//   node -e "console.log(require('bcryptjs').hashSync('probe-password-1234', 10))"
const PROBE_PASSWORD = 'probe-password-1234';
const PROBE_HASH = '$2b$10$oiYMXccjTWuK20axUyyF/..DMBr3rKnNGabo8F8H/kw/1CjncKOr6';

const sql = getSql();
const problems = [];
const ok = (what) => console.log(`  ok  ${what}`);
const fail = (family, what) => { problems.push(`${family}: ${what}`); console.log(`  ✗   ${what}`); };

/** Твердження, яке не спиняє прогін: родина падає, решта йде далі. */
function claim(family, condition, what) {
  if (condition) ok(what); else fail(family, what);
  return !!condition;
}

const ORG = `${TAG}org`;
const USER = `${TAG}user`;

/**
 * Кожне ім'я, яке прибирання називає — СПИСКОМ, а не тільки всередині запиту.
 *
 * Так його можна звірити з базою наперед, до першого `DELETE`. Ловити виняток
 * із живого запиту недостатньо, і це ВИМІРЯНО (Р10.13): прибирання по броні
 * виконується всередині циклу по бронях, тож на чистій базі перший `cleanup()`
 * не виконує його ВЗАГАЛІ. Контрольний прогін: стара обгортка з мертвим іменем
 * `invoice_items` на чистій базі виходить з НУЛЕМ — тобто ім'я, яке гейт
 * називає, але жодного разу не виконує, лишалось неперевіреним.
 *
 * Два мертвих імені саме такі: `invoice_items` (такої таблиці немає ніде;
 * рядки фактури лежать у `fin_invoice_lines` і ключем на `invoice_id`) і
 * `accruals.reservation_id` (це нарахування витрат, не броні).
 */
const SWEPT_BY_RESERVATION = ['invoices', 'booking_activity_log', 'guest_registrations'];
const SWEPT_BY_PROPERTY = ['cm_connections', 'fees_taxes', 'booking_sites'];
const SWEPT_BY_ORG_IN_PROPERTY = ['cm_outbox', 'cm_mappings', 'cm_events', 'cm_inbound_bookings'];
const SWEPT_BY_ORG = ['invoices', 'invoice_counters', 'invoice_series', 'guests', 'organization_features',
  'unit_type_amenities', 'property_amenities', 'amenities', 'amenity_categories',
  'organization_currencies', 'finance_exchange_rates',
  // Кіоск (10.09.2026). Каскад від `properties` зніс би пристрій і код
  // парування сам, але `kiosk_events` висить на ОРГАНІЗАЦІЇ, а не на
  // будинку, і після неї лишався б журнал проби. Названо всі три: прибирання
  // за каскадом — це прибирання, про яке гейт не стверджує нічого.
  'kiosk_events', 'kiosk_devices', 'kiosk_pairings'];

const CLEANUP_NAMES = [
  ...SWEPT_BY_RESERVATION.map((table) => ({ table, column: 'reservation_id' })),
  ...SWEPT_BY_PROPERTY.map((table) => ({ table, column: 'property_id' })),
  ...SWEPT_BY_ORG_IN_PROPERTY.map((table) => ({ table, column: 'organization_id' })),
  ...SWEPT_BY_ORG.map((table) => ({ table, column: 'organization_id' })),
  { table: 'reservations', column: 'property_id' },
  { table: 'units', column: 'property_id' },
  { table: 'unit_types', column: 'property_id' },
  { table: 'categories', column: 'property_id' },
  { table: 'properties', column: 'organization_id' },
  { table: 'sessions', column: 'user_id' },
  { table: 'app_users', column: 'organization_id' },
  { table: 'organizations', column: 'id' },
];

/** До першого резолву прибирання нічого не фільтрує. */
let resolves = () => true;

/**
 * Звірити імена прибирання з каталогом бази — ЧЕРВОНЕ на кожне, якого немає.
 *
 * Після цього `cleanup()` пропускає нерезолвлені імена: про них уже сказано.
 */
async function checkCleanupNames() {
  resolves = await nameResolver(sql);
  for (const m of missingFrom(resolves, CLEANUP_NAMES)) {
    fail('прибирання', `гейт прибирає те, чого немає — ${m}`);
  }
}

/**
 * Прибирання, яке НЕ мовчить про власний провал (Р8.16).
 *
 * Ім'я, якого база не знає, сюди вже не доходить — його відсіяв
 * `checkCleanupNames()`. Тому `catch` лишається для відмов ВИКОНАННЯ і
 * розрізняє їх за КОДОМ, а не за текстом (Р10.12): `does not exist` буває не
 * лише про relation і column — «role … does not exist», «database … does not
 * exist», «prepared statement … does not exist» під пулером дали б тверде
 * червоне з неправдивою причиною. Саме так упав би прогін на застарілій
 * локальній базі, і причина була б вигадана.
 */
const swept = async (what, fn) => {
  try {
    await fn();
  } catch (e) {
    const msg = e?.message || String(e);
    if (isUnresolvedObject(e)) fail('прибирання', `об'єкт не резолвиться в цій базі — ${what}: ${msg}`);
    else console.log(`  ··  прибирання ${what}: ${msg}`);
  }
};

/** `DELETE` лише по імені, яке база знає; решту пропускаємо НАЗВАВШИ. */
const sweepEach = async (tables, column, value) => {
  for (const t of tables) {
    if (!resolves(t, column)) { console.log(`  ··  прибирання ${t}: пропущено, ім'я не резолвиться`); continue; }
    await swept(t, () => sql.run(`DELETE FROM ${t} WHERE ${column} = ?`, [value]));
  }
};

/**
 * Засів і прибирання — ПІД ОРЕНДАРЕМ.
 *
 * На SQLite політик немає, і голий `sql.run` працював. На справжньому
 * Postgres під роллю `alisio_app` той самий рядок відхиляється політикою:
 * `new row violates row-level security policy for table "app_users"` — гейт
 * обривався на власній фікстурі, ще не діставшись до жодного маршруту.
 *
 * Тобто «зелено» тут означало «зелено на SQLite», і про другий рушій гейт не
 * стверджував нічого. `organizations` лишається поза обгорткою навмисно: це
 * сама таблиця орендарів, у неї немає `organization_id`, і політики на ній
 * немає (`pg-schema.mjs`, `rlsIdentity`).
 */
const asTenant = (fn) => runWithOrganization(ORG, fn);

async function cleanup() {
  return asTenant(() => cleanupInner());
}

async function cleanupInner() {
  const props = (await sql.rows('SELECT id FROM properties WHERE organization_id = ?', [ORG])).map((r) => r.id);
  for (const pid of props) {
    const resIds = (await sql.rows('SELECT id FROM reservations WHERE property_id = ?', [pid])).map((r) => r.id);
    for (const rid of resIds) await sweepEach(SWEPT_BY_RESERVATION, 'reservation_id', rid);
    await sql.run('DELETE FROM reservations WHERE property_id = ?', [pid]);
    await sweepEach(SWEPT_BY_ORG_IN_PROPERTY, 'organization_id', ORG);
    // Ціни НЕ прибираються тут окремим запитом: `price_occupancy` належить
    // модулю `pricing`, і прямий SQL звідси — пробій межі (`check-boundaries`
    // це й сказав). Рядки йдуть каскадом за обʼєктом і типом номера
    // (`ON DELETE CASCADE`), тобто прибирання не втрачає нічого.
    await sweepEach(SWEPT_BY_PROPERTY, 'property_id', pid);
    await sql.run('DELETE FROM units WHERE property_id = ?', [pid]);
    await sql.run('DELETE FROM unit_types WHERE property_id = ?', [pid]);
    await sql.run('DELETE FROM categories WHERE property_id = ?', [pid]);
  }
  await sweepEach(SWEPT_BY_ORG, 'organization_id', ORG);
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM sessions WHERE user_id = ?', [USER]);
  await sql.run('DELETE FROM app_users WHERE organization_id = ?', [ORG]);
  // `organizations` — сама таблиця орендарів: політики на ній немає
  // (`rlsIdentity`), тож контекст навколо їй байдужий.
  await sql.run('DELETE FROM organizations WHERE id = ?', [ORG]);
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PROBE_PASSWORD }),
  });
  assert.ok(res.ok, `вхід не вдався для ${email}: ${res.status}`);
  const sid = (res.headers.get('set-cookie') || '').match(/session_id=([^;]+)/)?.[1];
  assert.ok(sid, 'сервер не віддав кукі сесії');
  return `session_id=${sid}`;
}

const call = (cookie, path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

/**
 * Відповідь як JSON — і окрема відмова, коли це не JSON.
 *
 * Маршрут, який мовчки редиректить на сторінку логіну, віддає HTML із 200
 * після редиректу; `res.json()` кинув би SyntaxError десь усередині родини, і
 * читати це довелось би стеком. Клас не вигаданий: `/widget/*.js` роздавав
 * HTML сторінки логіну, бо шлях не був у публічних (AUDIT §2.6).
 */
async function body(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { __notJson: text.slice(0, 120) }; }
}

/**
 * На порту — ТВОЯ збірка, а не попередня.
 *
 * Це не гігієна, а захист від хибно-зеленого доказу, і він уже спрацював би
 * раз: 08.09.2026 «червоний» прогін для валюти віджета вийшов ЗЕЛЕНИМ, бо
 * старий сервер тримав порт і віддавав збірку ДО злому (старт 10:35:54,
 * збірка 10:39:00). Гейт міряв не ту збірку — і зелене легко зарахувати за
 * доказ. Клас той самий, що інваріант 21: виміряно точно, але не те.
 *
 * Перевірка дешева: Next кладе кожну збірку під власним `BUILD_ID`, тож
 * сервер, який віддає `/_next/static/<той самий id>/…`, — це саме той білд,
 * що лежить на диску. Чужий id дає 404.
 *
 * ── Текст твердження ─────────────────────────────────────────────────────
 *
 * Формулювання йде від ВИМІРУ, а не від висновку (Р11.1). Перша версія
 * казала «сервер віддає ТУ САМУ збірку, що на диску (…, 404)» — і на
 * невдачі `fail()` друкував це саме речення з хрестиком, тобто рядок у лозі
 * стверджував «збіглося» рівно тоді, коли не збіглося. Хто натрапить на таке
 * через місяць, засумнівається в гейті, а не в сервері. Тому в тексті id і
 * код відповіді, а висновок лишається значку.
 *
 * ── Чому немає прапорця обходу ───────────────────────────────────────────
 *
 * Пропуск тут рівно один і механічний: локального `.next` немає — нема з чим
 * звіряти (`ENOENT`, і тільки він, Р11.3; будь-яка інша помилка читання
 * кидається далі, бо гейт, який мовчки пропускає САМ СЕБЕ, це те, від чого
 * він страхує).
 *
 * Прапорця «не перевіряй збірку» немає навмисно: аварійний вимикач, доданий
 * у відповідь на хибну відмову, і є тим, як гейти вмирають. Якщо перевірка
 * колись відмовить неправильно — лагодиться перевірка, а не додається обхід.
 */
/**
 * Пише — тільки у СВОЮ базу. Хост `BASE_URL` мусить бути локальним (Р11.4).
 *
 * Це не гігієна і не дублювання шапки, а механізм замість наміру. Гейт
 * заводить орендаря і МЕТЕ за собою `cleanup()` — тобто виконує `DELETE` по
 * двох десятках тенантних таблиць за префіксом. Наведений змінною оточення на
 * бету чи прод, він засіє живу базу і пройде по ній видаленням.
 *
 * Чому ПЕРШОЮ дією, а не після перевірки збірки. Порядок у `main()` був
 * `assertServerRunsThisBuild()` → `checkCleanupNames()` → `cleanup()`, і
 * перевірка збірки має ЗАКОННЕ право пропустити себе: на машині без
 * локального `.next` (свіжий клон, чужий крок CI) звіряти нема з чим. Тобто
 * рівно в тому випадку, де перша варта мовчить за побудовою, друга була
 * відсутня, а наступна ж дія — руйнівна. Ця перевірка права мовчати не має
 * ніколи, тому стоїть до всього.
 *
 * Прапорця обходу немає — з тієї самої причини, що й у перевірці збірки:
 * аварійний вимикач, доданий у відповідь на хибну відмову, і є тим, як гейти
 * вмирають. Треба інший хост — лагодиться список, а не додається обхід.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function assertLocalTarget() {
  let host;
  try { host = new URL(BASE).hostname; }
  catch { throw new Error(`BASE_URL не читається як адреса (${BASE}) — гейт пише в базу, тож ціль має бути названа явно`); }
  // `new URL('http://[::1]:3000').hostname` дає '[::1]' — обидві форми в списку.
  const local = LOCAL_HOSTS.has(host);
  claim('ціль', local, `ціль прогону: ${host} (локальна: ${local ? 'так' : 'НІ'})`);
  if (!local) {
    throw new Error(
      `${host} — не локальний хост. Гейт заводить орендаря і видаляє його ` +
      'по двох десятках таблиць; проти беті або прода це знищення чужих даних. ' +
      'Піднімай свій застосунок над своєю базою.');
  }
}

async function assertServerRunsThisBuild() {
  let buildId;
  try {
    buildId = (await readFile(new URL('../.next/BUILD_ID', import.meta.url), 'utf8')).trim();
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
    console.log('  ··  локальної збірки немає (.next/BUILD_ID) — звіряти нема з чим, перевірку пропущено');
    return;
  }
  let status = 0;
  try {
    const res = await fetch(`${BASE}/_next/static/${buildId}/_ssgManifest.js`);
    status = res.status;
  } catch { status = 0; }
  // Текст від виміру: id, якого ми чекаємо, і що відповів сервер.
  claim('збірка', status === 200, `збірка на ${BASE}: очікуємо ${buildId}, сервер відповів ${status}`);
  if (status !== 200) {
    throw new Error(
      `на порту не ця збірка (${buildId} → ${status}) — прогін нічого не доводить. ` +
      'Зупини попередній сервер або візьми вільний порт.');
  }
}

const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

async function main() {
  // Спершу — куди ми взагалі цілимось. Перевірка збірки нижче має право
  // пропустити себе (немає локального `.next`); ця — не має.
  assertLocalTarget();
  await assertServerRunsThisBuild();
  await checkCleanupNames();
  await cleanup();
  await sql.run('INSERT INTO organizations (id, name, slug, default_currency, language) VALUES (?, ?, ?, ?, ?)',
    [ORG, 'Routes probe', `${TAG}org`, 'EUR', 'uk']);
  await asTenant(() => sql.run(
    'INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
    [USER, ORG, 'routes@probe.test', 'Routes probe', 'owner', PROBE_HASH]));
  // Модулі, вимкнені за замовчуванням (П15): гейт перевіряє МАРШРУТИ, а не
  // право на модуль — 403 «не куплено» тут означав би, що ми нічого не
  // спитали.
  for (const feature of ['guest_page', 'channels', 'invoicing', 'accounting', 'booking_engine', 'reports', 'day_sheets', 'kiosk']) {
    await asTenant(() => sql.run(
      `INSERT INTO organization_features (organization_id, feature, enabled) VALUES (?, ?, TRUE)
       ON CONFLICT(organization_id, feature) DO UPDATE SET enabled = TRUE`,
      [ORG, feature]));
  }

  try {
    const cookie = await login('routes@probe.test');

    // ── Обʼєкт, тип номера, номер: сама фікстура і є твердженням ──────────
    //
    // Це шлях, яким користується екран налаштувань, і він створює те, на чому
    // стоять усі родини нижче. Якщо він мовчки віддасть не той статус, решта
    // впаде далеко від причини — тому статус названо тут.
    const propRes = await call(cookie, '/api/properties', {
      // `property_type` обовʼязковий у писачі (В1) — без нього це 400, і
      // родини нижче впали б далеко від причини.
      method: 'POST', body: JSON.stringify({ name: 'Routes probe hotel', slug: `${TAG}hotel`, property_type: 'hotel' }),
    });
    const property = await body(propRes);
    if (!claim('обʼєкт', propRes.status === 201 && property.id, `обʼєкт створено (${propRes.status})`)) {
      throw new Error('без обʼєкта решта родин не має на чому стояти');
    }

    const catRes = await call(cookie, '/api/categories', {
      method: 'POST', body: JSON.stringify({ property_id: property.id, name: 'Rooms', type: 'hotel' }),
    });
    const category = await body(catRes);
    claim('обʼєкт', catRes.status === 201 && category.id, `категорію створено (${catRes.status})`);

    const typeRes = await call(cookie, '/api/unit-types', {
      method: 'POST',
      body: JSON.stringify({
        property_id: property.id, category_id: category.id, name: 'Double', code: 'DBL',
        max_adults: 2, max_occupancy: 2, base_occupancy: 2,
      }),
    });
    const unitType = await body(typeRes);
    claim('обʼєкт', typeRes.status === 201 && unitType.id, `тип номера створено (${typeRes.status})`);

    const unitRes = await call(cookie, '/api/units', {
      method: 'POST',
      body: JSON.stringify({
        property_id: property.id, category_id: category.id, unit_type_id: unitType.id,
        name: '101', code: '101',
      }),
    });
    const unit = await body(unitRes);
    claim('обʼєкт', unitRes.status === 201 && unit.id, `номер створено (${unitRes.status})`);

    // ── Ціни ─────────────────────────────────────────────────────────────
    //
    // Дві сцени, і друга важливіша за першу: ніч, якої ніхто не назвав, має
    // прийти як `missing`, а не як нуль (інваріант 17). Вісь не вироджена:
    // ціна названа на ВІКНО, а питаємо і всередині вікна, і поза ним.
    const priceFrom = day(30);
    const priceTo = day(60);
    const priceRes = await call(cookie, '/api/pricing/occupancy', {
      method: 'POST',
      body: JSON.stringify({
        property_id: property.id, unit_type_id: unitType.id,
        persons: 2, price_gross: 120, valid_from: priceFrom, valid_to: priceTo,
      }),
    });
    claim('ціни', priceRes.status === 201, `ціну заселеності записано (${priceRes.status})`);

    const quoteRes = await call(cookie, '/api/pricing/quote', {
      method: 'POST',
      body: JSON.stringify({
        unitTypeId: unitType.id, checkIn: day(31), checkOut: day(33), adults: 2, children: 0,
      }),
    });
    const quote = await body(quoteRes);
    claim('ціни', quoteRes.status === 200, `котирування відповідає 200 (${quoteRes.status})`);
    // Дві ночі × 120 — число, а не «щось правдоподібне»: воно арифметично
    // несумісне з «узяли ціну однієї ночі» і з «узяли нуль».
    claim('ціни', Number(quote?.accommodationTotal) === 240,
      `дві ночі по 120 дають 240 (отримано ${JSON.stringify(quote?.accommodationTotal)})`);
    claim('ціни', Array.isArray(quote?.breakdown) && quote.breakdown.length === 2,
      `у розкладці дві ночі (отримано ${quote?.breakdown?.length})`);
    claim('ціни', quote?.hasPricing === true && Number(quote?.missingDays) === 0,
      `обидві ночі мають ціну (missingDays = ${quote?.missingDays})`);
    claim('ціни', typeof quote?.currency === 'string' && quote.currency === 'EUR',
      `котирування у валюті готелю (${quote?.currency})`);

    const outsideRes = await call(cookie, '/api/pricing/quote', {
      method: 'POST',
      body: JSON.stringify({
        unitTypeId: unitType.id, checkIn: day(200), checkOut: day(202), adults: 2, children: 0,
      }),
    });
    const outside = await body(outsideRes);
    claim('ціни', outsideRes.status === 200 && Number(outside?.missingDays) === 2,
      `ніч поза вікном ціни рахується як missing (missingDays = ${outside?.missingDays})`);
    claim('ціни', outside?.hasPricing === false,
      'котирування без жодної ціни каже про це прямо, а не мовчить');
    claim('ціни', Number(outside?.accommodationTotal) === 0,
      `ніч без ціни не отримала вигаданої суми (${JSON.stringify(outside?.accommodationTotal)})`);

    // ── Броні ────────────────────────────────────────────────────────────
    const checkIn = day(31);
    const checkOut = day(33);
    const bookRes = await call(cookie, '/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Ганна', lastName: 'Пробна', email: 'guest@probe.test',
        unitId: unit.id, checkIn, checkOut, nights: 2,
        adults: 2, children: 0, status: 'confirmed', source: 'direct',
        totalPrice: 240,
      }),
    });
    const booking = await body(bookRes);
    const haveBooking = claim('броні', bookRes.status === 201 && booking.id,
      `бронь створено (${bookRes.status})`);

    if (haveBooking) {
      const listRes = await call(cookie, '/api/bookings');
      const list = await body(listRes);
      claim('броні', listRes.status === 200 && Array.isArray(list) && list.some((r) => r.id === booking.id),
        'бронь є у списку броней');

      // Динамічний маршрут — саме той рід, якого не торкається smoke-routes.
      const oneRes = await call(cookie, `/api/bookings/${booking.id}`);
      const one = await body(oneRes);
      const row = one?.reservation ?? one;
      claim('броні', oneRes.status === 200 && row?.id === booking.id,
        `картка броні відкривається (${oneRes.status})`);
      claim('броні', String(row?.check_in ?? row?.checkIn ?? '').startsWith(checkIn),
        `у картці ті самі дати (${row?.check_in ?? row?.checkIn})`);
      claim('броні', Number(row?.total_price ?? row?.totalPrice) === 240,
        `у картці та сама сума (${row?.total_price ?? row?.totalPrice})`);
      claim('броні', String(row?.last_name ?? row?.lastName ?? one?.guest?.last_name ?? '') === 'Пробна',
        'у картці той самий гість');

      // ── Гостьовий портал ───────────────────────────────────────────────
      //
      // Рівно та сторінка, яка не відкривалась півтора місяця. Токен береться
      // з бази, бо його видає створення броні — так само, як лист гостю.
      // ПІД ОРЕНДАРЕМ, як і решта читань фікстури: на Postgres голий `sql.row`
      // повертає `undefined` — політика `reservations` не бачить рядка без
      // орендаря, і гейт доповідав «бронь не отримала токена» про бронь, у
      // якої токен є. Дефект гейта, не продукту, і саме той рід, від якого
      // «зелено на SQLite» виглядає доказом.
      const tokenRow = await asTenant(() =>
        sql.row('SELECT guest_page_token FROM reservations WHERE id = ?', [booking.id]));
      const token = tokenRow?.guest_page_token;
      if (claim('гостьовий портал', !!token, 'бронь отримала гостьовий токен')) {
        const guestRes = await fetch(`${BASE}/api/guest/${token}`);
        const guest = await body(guestRes);
        claim('гостьовий портал', guestRes.status === 200, `сторінка гостя відкривається (${guestRes.status})`);
        const reservation = guest?.reservation ?? guest;
        claim('гостьовий портал', reservation?.id === booking.id,
          'сторінка гостя показує ТУ САМУ бронь');
        // Поля саме з тих JOIN-ів, які й були зламані комою: обʼєкт і тип
        // номера. 200 без них — це порожній екран із зеленим статусом.
        // Поля саме з тих JOIN-ів, які ламала кома, — і БЕЗ запасних варіантів
        // (рецензія раунду 8, Р8.13).
        //
        // Тут стояло `?? reservation?.unit_type_id`, і це рятувало твердження
        // від падіння: `unit_type_id` лежить у самому рядку броні, без жодного
        // JOIN. Тобто зламаний JOIN до `unit_types` лишав твердження зеленим —
        // рівно та сліпота, проти якої гейт і написаний. Питаємо НАЗВУ, бо
        // саме назву дає JOIN.
        claim('гостьовий портал', typeof reservation?.property_name === 'string' && reservation.property_name.length > 0,
          `у відповіді є назва обʼєкта з JOIN (${reservation?.property_name})`);
        claim('гостьовий портал', typeof reservation?.unit_type_name === 'string' && reservation.unit_type_name.length > 0,
          `у відповіді є назва типу номера з JOIN (${reservation?.unit_type_name})`);

        const badRes = await fetch(`${BASE}/api/guest/${token}zzz`);
        claim('гостьовий портал', badRes.status === 404,
          `неіснуючий токен — 404, а не 500 (${badRes.status})`);
      }

      // ── Фактура ────────────────────────────────────────────────────────
      //
      // Фактуру виписує НЕ створення броні, а позначення «оплачено» готівкою
      // (`legacyInvoiceWanted`) — тобто те, що робить портьє. Виклик
      // fire-and-forget: помилка в ньому нікуди не потрапляє, крім логу
      // сервера, і саме тому маршрут спокійно віддавав `null` із 200 два
      // тижні. Тому тут коротке очікування, а твердження — про РЯДОК.
      const paidRes = await call(cookie, `/api/bookings/${booking.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ payment_status: 'paid', payment_method: 'cash' }),
      });
      claim('фактура', paidRes.status === 200, `бронь позначено оплаченою (${paidRes.status})`);

      let invoice = null;
      for (let i = 0; i < 20 && !invoice; i++) {
        const invRes = await call(cookie, `/api/bookings/${booking.id}/invoice`);
        if (invRes.status !== 200) {
          claim('фактура', false, `маршрут фактури відповів ${invRes.status}`);
          break;
        }
        invoice = await body(invRes);
        if (!invoice) { invoice = null; await new Promise((r) => setTimeout(r, 250)); }
      }
      if (claim('фактура', !!invoice, 'фактуру броні виписано (маршрут віддав рядок, не null)')) {
        claim('фактура', !!invoice.invoice_number, `у фактури є номер (${invoice.invoice_number})`);
        claim('фактура', Number(invoice.amount) === 240,
          `сума фактури дорівнює сумі броні (${invoice.amount})`);
        claim('фактура', invoice.currency === 'EUR',
          `валюта фактури — валюта броні (${invoice.currency})`);
      }
    }

    // ── Канал ────────────────────────────────────────────────────────────
    //
    // Без вендора: зʼєднання кладеться в базу, а гейт питає, що віддає
    // маршрут. Для динамічного маршруту твердження — про НАЗВАНУ відмову
    // (немає ключа → 409), а не про 500: маршрут, який падає, і маршрут,
    // який каже «ключа немає», для екрана — різні речі.
    const connId = `${TAG}conn`;
    await asTenant(() => sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment, webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, 'channex', 'staging', ?, ?, TRUE)`,
      [connId, ORG, property.id, `${TAG}tok`, `${TAG}secret`]));

    const connRes = await call(cookie, '/api/channels/connections');
    const conns = await body(connRes);
    const rows = Array.isArray(conns) ? conns : (conns?.connections ?? []);
    claim('канал', connRes.status === 200, `список зʼєднань відповідає 200 (${connRes.status})`);
    const mine = rows.find((c) => c.id === connId);
    claim('канал', !!mine, 'зʼєднання видно у списку');

    // Значення, які ми поклали, — назад ТИМИ САМИМИ (рецензія раунду 8, Р8.12).
    //
    // Тут стояло `provider === 'channex' || provider === undefined`, тобто
    // «або те, що ми записали, або взагалі нічого» — твердження, істинне за
    // будь-якої відповіді. Тепер перевіряються самі значення, і серед них
    // `propertyId`: він доводить, що рядок дійшов зі своїм звʼязком, а не
    // просто знайшовся за id.
    claim('канал', mine?.provider === 'channex', `провайдер повернувся своїм (${mine?.provider})`);
    claim('канал', mine?.environment === 'staging', `середовище повернулось своїм (${mine?.environment})`);
    claim('канал', mine?.propertyId === property.id, `зʼєднання названо свій обʼєкт (${mine?.propertyId})`);
    claim('канал', mine?.isEnabled === true, `увімкненість повернулась своєю (${mine?.isEnabled})`);
    // Половини відповіді, кожна з яких — окремий запит усередині обробника:
    // черга, застрягле, події, відправлення, журнал. Обірваний запит тут
    // виглядав би як відсутнє поле, а не як помилка.
    for (const [field, shape] of [['pending', 'number'], ['stuck', 'array'], ['attention', 'array'], ['sent', 'array'], ['sendLog', 'array']]) {
      const value = mine?.[field];
      const good = shape === 'array' ? Array.isArray(value) : typeof value === shape;
      claim('канал', good, `у відповіді є ${field} (${shape}): ${JSON.stringify(value)?.slice(0, 30)}`);
    }

    // Динамічний маршрут каналу: НАЗВАНА відмова, а не «не 500».
    //
    // `status !== 500` проходило б і на 401, і на 404 — тобто на маршруті,
    // який до обробника взагалі не дійшов. Наше зʼєднання свідомо без
    // `remote_property_id`, і єдина правильна відповідь на нього — 409
    // `catalog_not_synced`: обробник знайшов зʼєднання в орендарі й назвав
    // ту передумову, якої бракує.
    const frameRes = await call(cookie, `/api/channels/connections/${connId}/frame`);
    const frame = await body(frameRes);
    claim('канал', frameRes.status === 409 && frame?.error === 'catalog_not_synced',
      `каталог не заведено — маршрут каже саме це (${frameRes.status} ${JSON.stringify(frame).slice(0, 40)})`);

    // ── Віджет ───────────────────────────────────────────────────────────
    //
    // Публічна вітрина: сюди дивиться ГІСТЬ, і тут уже була вада рівно того
    // роду, який ловить лише живий запит. У `widget/config` стояло
    // `property.default_currency || 'CZK'`, а колонки `default_currency` в
    // `properties` немає — запит іде через `SELECT *`, тож поле приходило
    // `undefined` і запасне значення спрацьовувало ЗАВЖДИ. Кожен готель,
    // німецький чи український, підписував ціни кронами. Статус при цьому
    // був 200, форма — правильна; неправильним було саме ЧИСЛО і його валюта.
    //
    // Тому тут стверджується не «маршрут відповів», а «відповів валютою
    // ЦЬОГО готелю»: EUR, як його заведено, і жодного запасного значення.
    const siteId = `${TAG}site`;
    await asTenant(() => sql.run(
      `INSERT INTO booking_sites (id, organization_id, property_id, name, slug, type, currency, status)
       VALUES (?, ?, ?, ?, ?, 'widget', 'EUR', 'active')`,
      [siteId, ORG, property.id, 'Routes probe site', `${TAG}site`]));

    const wcRes = await fetch(`${BASE}/api/widget/config?propertyId=${property.id}`);
    const wc = await body(wcRes);
    claim('віджет', wcRes.status === 200, `конфіг віджета відповідає 200 (${wcRes.status})`);
    claim('віджет', wc?.property?.id === property.id, `віджет називає свій обʼєкт (${wc?.property?.id})`);
    claim('віджет', wc?.property?.currency === 'EUR',
      `валюта віджета — валюта готелю, не запасна (${wc?.property?.currency})`);
    // Курси показу — обʼєкт «валюта → курс», і це виміряно живою відповіддю,
    // а не взято з голови: перше твердження тут казало «масив» і впало на
    // `{"EUR":1}`. Питається сильніше за форму: валюта готелю мусить мати
    // ЧИСЛОВИЙ курс, бо «≈ 0 EUR» гість читає як факт (інваріант 17).
    const rates = wc?.property?.displayRates;
    claim('віджет', rates && typeof rates === 'object' && !Array.isArray(rates),
      `курси показу прийшли обʼєктом (${JSON.stringify(rates)?.slice(0, 30)})`);
    claim('віджет', typeof rates?.EUR === 'number' && rates.EUR > 0,
      `валюта готелю має числовий курс (EUR=${rates?.EUR})`);
    const wcType = (wc?.unitTypes || []).find((u) => u.id === unitType.id);
    claim('віджет', !!wcType, 'тип номера видно у вітрині');
    claim('віджет', wcType?.name === 'Double', `тип названо своїм імʼям (${wcType?.name})`);
    // Місткість — число, а не `undefined`: віджет рахує по ньому, кого пускати
    // в номер, і `undefined` тут це «пускати будь-кого».
    claim('віджет', typeof wcType?.maxOccupancy === 'number' && wcType.maxOccupancy > 0,
      `місткість типу — число (${wcType?.maxOccupancy})`);

    // Інваріант 8: публічний endpoint не має мовчазного дефолту.
    const wcNoneRes = await fetch(`${BASE}/api/widget/config`);
    claim('віджет', wcNoneRes.status === 400,
      `без ідентифікатора обʼєкта віджет відмовляє 400, а не вгадує (${wcNoneRes.status})`);
    const wcAlienRes = await fetch(`${BASE}/api/widget/config?propertyId=${TAG}nosuch`);
    claim('віджет', wcAlienRes.status === 404,
      `неіснуючий обʼєкт — 404, не порожня вітрина (${wcAlienRes.status})`);
    const wpRes = await fetch(`${BASE}/api/widget/prices`);
    claim('віджет', wpRes.status === 400,
      `ціни віджета без сайту й обʼєкта — 400 (${wpRes.status})`);

    // ── Публічна вітрина ─────────────────────────────────────────────────
    //
    // `public/availability` малює календар зайнятих дат. Порожній масив і
    // ВІДСУТНЄ поле виглядають на екрані однаково — вільним місяцем, — тож
    // тут стверджується саме наявність обох половин відповіді.
    const paRes = await fetch(`${BASE}/api/public/availability?site_id=${siteId}&unit_type_id=${unitType.id}`);
    const pa = await body(paRes);
    claim('публічна вітрина', paRes.status === 200, `наявність для сайту відповідає 200 (${paRes.status})`);
    claim('публічна вітрина', Array.isArray(pa?.bookedRanges),
      `діапазони зайнятого — масив (${JSON.stringify(pa?.bookedRanges)?.slice(0, 40)})`);
    claim('публічна вітрина', Array.isArray(pa?.bookedDates),
      `зайняті дати — масив (${JSON.stringify(pa?.bookedDates)?.slice(0, 40)})`);
    const paNoUnitRes = await fetch(`${BASE}/api/public/availability?site_id=${siteId}`);
    claim('публічна вітрина', paNoUnitRes.status === 400,
      `без номера чи типу — 400, а не «все вільно» (${paNoUnitRes.status})`);
    const paAlienRes = await fetch(`${BASE}/api/public/availability?site_id=${TAG}nosite&unit_type_id=${unitType.id}`);
    claim('публічна вітрина', paAlienRes.status === 404,
      `невідомий сайт — 404 (${paAlienRes.status})`);

    // ── День готелю ──────────────────────────────────────────────────────
    //
    // `day-sheets/[kind]` — ЧОТИРИ різні запити за одним динамічним сегментом.
    // Зламаний SQL в одному вигляді не видно з інших: аркуш ключів може
    // віддавати 500 роками, поки хтось не відкриє саме його. Тому кожен вид
    // питається окремо, і кожен мусить дати `{date, rows}` — не «не 5xx».
    const today = day(0);
    for (const kind of ['house', 'breakfast', 'keys', 'day-close']) {
      const dsRes = await call(cookie, `/api/day-sheets/${kind}?date=${today}`);
      const ds = await body(dsRes);
      claim('день готелю',
        dsRes.status === 200 && ds?.date === today && Array.isArray(ds?.rows),
        `аркуш «${kind}» віддає свою дату і рядки (${dsRes.status}, date=${ds?.date}, rows=${Array.isArray(ds?.rows) ? ds.rows.length : ds?.rows})`);
    }
    const dsBadRes = await call(cookie, `/api/day-sheets/${TAG}nosuch?date=${today}`);
    const dsBad = await body(dsBadRes);
    claim('день готелю', dsBadRes.status === 404 && dsBad?.error === 'Unknown sheet',
      `невідомий аркуш — названа відмова 404 (${dsBadRes.status} ${JSON.stringify(dsBad).slice(0, 30)})`);
    // Без дати аркуш бере ДЕНЬ ГОТЕЛЮ, а не дату сервера, і це навмисно:
    // `dateFrom` падає на `todayFor(organizationId)`. Перше твердження тут
    // казало «має бути 400» і впало на 200 — помилка була в твердженні, не в
    // маршруті. Живий прогін і виправив: питається те, що маршрут обіцяє.
    const dsNoDateRes = await call(cookie, '/api/day-sheets/house');
    const dsNoDate = await body(dsNoDateRes);
    claim('день готелю',
      dsNoDateRes.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(dsNoDate?.date || ''),
      `без дати аркуш бере день готелю, а не порожнечу (${dsNoDateRes.status}, date=${dsNoDate?.date})`);
    // А ось СПОТВОРЕНА дата — саме та, на яку маршрут відмовляє: мовчазно
    // підставити «сьогодні» замість «13-го місяця» означало б віддати аркуш
    // не того дня, і оператор би цього не побачив.
    const dsBadDateRes = await call(cookie, '/api/day-sheets/house?date=31-12-2026');
    claim('день готелю', dsBadDateRes.status === 400,
      `спотворена дата — 400, а не тихо «сьогодні» (${dsBadDateRes.status})`);

    // ── Звіти ────────────────────────────────────────────────────────────
    //
    // Звіт — це числа, за якими готель ухвалює рішення, і порожній звіт від
    // зламаного звіту не відрізниш за статусом. Тут стверджується форма:
    // період повернувся ТИМ, який попросили, і зведення прийшло обʼєктом.
    const from = day(-7), to = day(0);
    const repRes = await call(cookie, `/api/reports?from=${from}&to=${to}`);
    const rep = await body(repRes);
    claim('звіти', repRes.status === 200, `звіт відповідає 200 (${repRes.status})`);
    claim('звіти', rep?.period?.from === from && rep?.period?.to === to,
      `звіт повернув ТОЙ період, який попросили (${rep?.period?.from} — ${rep?.period?.to})`);
    claim('звіти', rep && typeof rep.summary === 'object' && rep.summary !== null,
      `зведення прийшло обʼєктом (${JSON.stringify(rep?.summary)?.slice(0, 40)})`);
    const ctRes = await call(cookie, `/api/reports/city-tax?from=${from}&to=${to}`);
    const ct = await body(ctRes);
    claim('звіти', ctRes.status === 200, `турзбір відповідає 200 (${ctRes.status})`);
    claim('звіти', Array.isArray(ct?.rows) || Array.isArray(ct?.nights) || typeof ct === 'object',
      `турзбір віддав структуру, а не порожнечу (${JSON.stringify(ct)?.slice(0, 40)})`);

    // ── Кіоск: форма відповіді терміналу ─────────────────────────────────
    //
    // Родина, якої не було до 10.09.2026. Кіоск — єдина поверхня, де ФОРМА
    // відповіді і є функцією: біля екрана немає людини, яка перечитає поле
    // під іншою назвою, і поле, що приїхало `undefined`, — це порожній
    // прямокутник у холі, який ніхто не полагодить.
    //
    // Ланцюжок повний, від картки до гостя: власник робить код парування →
    // термінал обмінює його на токен → токен віддає сесію → сесія називає
    // будинок і смугу → пошук з одним чинником відмовляє, з двома відповідає.
    // Кожна ланка тут — окреме твердження, бо кожна ламається окремо.
    // Сам ЕКРАН — 200, а не 307 на вхід оператора.
    //
    // Це не зайве твердження: саме так воно й було зламане до 10.09.2026.
    // `/api/apps/kiosk/` стояв у публічному переліку `proxy.ts`, а сторінка
    // `/kiosk` — ні, і термінал у холі показував би гостю форму входу. Жоден
    // статичний гейт цього не бачить за побудовою: `check-public-routes` і
    // `check-route-guards` читають `src/app/api`, СТОРІНОК вони не знають.
    // Спіймав дим по живій збірці, тому твердження живе тут.
    const screenRes = await fetch(`${BASE}/kiosk`, { redirect: 'manual' });
    claim('кіоск', screenRes.status === 200,
      `екран /kiosk віддається гостю без сесії (${screenRes.status}; 307 = перенаправлення на вхід оператора)`);

    const pairRes = await call(cookie, '/api/settings/apps/kiosk/pairings', {
      method: 'POST',
      body: JSON.stringify({ propertyId: property.id, name: 'Routes probe terminal' }),
    });
    const pairing = await body(pairRes);
    const gotCode = pairRes.status === 200 && typeof pairing?.code === 'string' && /^[0-9]{6}$/.test(pairing.code);
    claim('кіоск', gotCode, `код парування — шість цифр (${pairRes.status})`);
    claim('кіоск', typeof pairing?.expiresAt === 'string',
      'код має строк — без нього термінал не знає, скільки в нього часу');

    if (gotCode) {
      // Обмін коду — БЕЗ сесії: саме так це робить термінал у холі.
      const claimRes = await fetch(`${BASE}/api/apps/kiosk/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: pairing.code }),
      });
      const claimed = await body(claimRes);
      const paired = claimRes.status === 200 && typeof claimed?.token === 'string';
      // 500 на цій ланці майже завжди означає не кіоск, а порожній
      // `APP_SECRET_KEY` на СЕРВЕРІ: `pairDevice` відмовляється класти секрет
      // пристрою в базу відкритим (`seal()`), і відмова виходить назовні
      // пʼятисоткою. У CI ключ стоїть у кроці `start`; на стенді його треба
      // передати руками. Твердження лишається ЧЕРВОНИМ — конфіг сервера це
      // теж частина «маршрут відповідає», — але читач бачить, куди дивитись,
      // замість того щоб три години шукати ваду в самому паруванні.
      const hint = claimRes.status === 500
        ? ' — перевірте APP_SECRET_KEY на сервері: без нього sealing відмовляє'
        : '';
      claim('кіоск', paired, `код обміняно на токен без сесії (${claimRes.status})${hint}`);
      claim('кіоск', claimed?.propertyId === property.id,
        'токен привʼязаний до того будинку, на який виписано код');

      if (paired) {
        const asDevice = (path, payload) => fetch(`${BASE}/api/apps/kiosk/${path}`, {
          method: payload === undefined ? 'GET' : 'POST',
          headers: {
            authorization: `Bearer ${claimed.token}`,
            ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: payload === undefined ? undefined : JSON.stringify(payload),
        });

        const sessRes = await asDevice('session');
        const sess = await body(sessRes);
        claim('кіоск', sessRes.status === 200, `сесія термінала — 200 (${sessRes.status})`);
        claim('кіоск', sess?.property?.id === property.id && typeof sess?.property?.name === 'string',
          'сесія називає будинок іменем, а не лише id — це заголовок екрана');
        claim('кіоск', Array.isArray(sess?.languages) && sess.languages.length === 2,
          `сесія віддає дві мови (КІ7), отримали ${JSON.stringify(sess?.languages)}`);
        claim('кіоск', typeof sess?.touchBand?.top === 'number' && typeof sess?.touchBand?.bottom === 'number',
          'сесія віддає робочу смугу числами — інакше кнопки лягають на весь екран');
        claim('кіоск', sess?.checkinPaymentPolicy === 'prepaid' || sess?.checkinPaymentPolicy === 'allow_pay_later',
          `політика оплати — відоме слово, отримали ${sess?.checkinPaymentPolicy}`);
        claim('кіоск', 'walkinUrl' in (sess ?? {}),
          'поле walk-in присутнє навіть порожнім — екран питає «чи є», а не «чи не впало»');

        // Один чинник — це 400, а не «не знайдено»: гість мусить дізнатись,
        // що ввів замало, і це відповідь про його ввід, а не про чужу бронь.
        const oneRes = await asDevice('find', { lastName: 'Probe' });
        claim('кіоск', oneRes.status === 400, `пошук з одним чинником — 400 (${oneRes.status})`);

        const twoRes = await asDevice('find', { lastName: 'Probe', checkIn: day(1) });
        const two = await body(twoRes);
        claim('кіоск', twoRes.status === 200 && typeof two?.found === 'boolean',
          `пошук із двома чинниками — 200 і поле found (${twoRes.status})`);

        // Чужий токен — 401 із живого маршруту, а не 500 і не 200.
        const alienRes = await fetch(`${BASE}/api/apps/kiosk/session`, {
          headers: { authorization: `Bearer ${ORG}.${property.id}.kd_nope.${'a'.repeat(64)}` },
        });
        claim('кіоск', alienRes.status === 401, `чужий токен пристрою — 401 (${alienRes.status})`);

        // ── Картка застосунку (частина В) ───────────────────────────────
        //
        // Вона живе під `/api/settings/apps/kiosk/` — у звичайному
        // охоронюваному контурі. Тому перше твердження про неї — БЕЗ сесії:
        // маршрут картки, який відповідає невідомому, це діра, а не зручність.
        const noCookie = await fetch(`${BASE}/api/settings/apps/kiosk/devices`, { redirect: 'manual' });
        claim('кіоск', noCookie.status === 307 || noCookie.status === 401,
          `картка без сесії не відповідає (${noCookie.status})`);

        const devicesRes = await call(cookie, '/api/settings/apps/kiosk/devices');
        const deviceList = await body(devicesRes);
        claim('кіоск', devicesRes.status === 200 && Array.isArray(deviceList?.devices),
          `список терміналів — 200 і масив (${devicesRes.status})`);
        claim('кіоск', (deviceList?.devices ?? []).some((d) => d.id === claimed.deviceId),
          'щойно спарований термінал є в списку картки');

        const polRes = await call(cookie, `/api/settings/apps/kiosk/policies?property_id=${property.id}`);
        const pol = await body(polRes);
        claim('кіоск', polRes.status === 200 && typeof pol?.autoAssign === 'boolean',
          `політики — 200 і автопризначення булевим (${polRes.status})`);
        claim('кіоск', ['foreigners', 'always', 'never'].includes(pol?.signature),
          `політика підпису — відоме слово, отримали ${pol?.signature}`);

        // Запис і читання назад: збереглося те, що просили, а не «ok».
        const putRes = await call(cookie, '/api/settings/apps/kiosk/policies', {
          method: 'PUT',
          body: JSON.stringify({
            propertyId: property.id, checkinPaymentPolicy: 'allow_pay_later',
            signature: 'always', autoAssign: false, walkinUrl: '', earliestCheckIn: '15:00',
          }),
        });
        claim('кіоск', putRes.status === 200, `політики збережено (${putRes.status})`);
        const back = await body(await call(cookie, `/api/settings/apps/kiosk/policies?property_id=${property.id}`));
        claim('кіоск', back?.checkinPaymentPolicy === 'allow_pay_later' && back?.signature === 'always'
          && back?.autoAssign === false && back?.earliestCheckIn === '15:00',
          `політики читаються назад тими самими: ${JSON.stringify(back)}`);

        // Слово поза словником — 400, а не 500 на CHECK-у бази.
        const badRes = await call(cookie, '/api/settings/apps/kiosk/policies', {
          method: 'PUT',
          body: JSON.stringify({ propertyId: property.id, signature: 'sometimes' }),
        });
        claim('кіоск', badRes.status === 400, `невідоме слово підпису — 400 (${badRes.status})`);

        // Смуга поза межами — теж 400, і термінал лишається зі своєю.
        const bandRes = await call(cookie, `/api/settings/apps/kiosk/devices/${claimed.deviceId}/config`, {
          method: 'PUT', body: JSON.stringify({ touchBand: { top: 90, bottom: 10 } }),
        });
        claim('кіоск', bandRes.status === 400, `перевернута смуга — 400 (${bandRes.status})`);

        const todayRes = await call(cookie, `/api/settings/apps/kiosk/today?property_id=${property.id}`);
        const today = await body(todayRes);
        claim('кіоск', todayRes.status === 200 && typeof today?.counts?.checkedIn === 'number'
          && typeof today?.day === 'string' && typeof today?.timezone === 'string',
          `«Kiosk heute» — 200, доба і підсумок числами (${todayRes.status})`);
        claim('кіоск', Array.isArray(today?.events) && today.events.some((e) => e.kind === 'pair'),
          'подія парування є в добі — журнал наповнюється сам');

        const alienDay = await call(cookie, `/api/settings/apps/kiosk/today?property_id=${TAG}alien`);
        claim('кіоск', alienDay.status === 404, `доба чужого обʼєкта — 404 (${alienDay.status})`);
      }
    }

    // ── Вісь обʼєкта (INC-029) ───────────────────────────────────────────
    //
    // СКІЛЬКИ рядків віддає кожен список, доводить сцена з двома будинками
    // (`modules/bookings/data/lists.scope.check.ts`) — там числа. Тут
    // доводиться те, чого сцена не бачить за означенням: що виходить із
    // маршруту, коли двері області ВІДМОВЛЯЮТЬ.
    //
    // Знайдено саме так, і не інакше: гейт був зелений, сцена зелена, а
    // `?property_id=<чужий>` віддавав 500 на трьох маршрутах і порожній
    // масив на четвертому. `PropertyNotFound` — названа відмова зі статусом
    // 404, але глухий `catch` ловив її разом із поломками бази і віддавав
    // «Внутрішня помилка» (інваріанти 5 і 6). Порожній масив гірший за
    // обидва: оператор бачить «закриттів немає» замість «не той будинок».
    //
    // Форма відповіді названа поруч із маршрутом: більшість віддає список, а
    // бейдж чернеток — обʼєкт `{count}`. Перевіряти всіх «масивом» означало б,
    // що бейдж або випаде з родини, або дасть хибне червоне.
    const AXIS_ROUTES = [
      ['/api/bookings', 'list'], ['/api/booking-sources', 'list'],
      ['/api/additional-services', 'list'], ['/api/availability-blocks', 'list'],
      ['/api/fees', 'list'], ['/api/guest-page-config', 'list'],
      ['/api/booking/drafts-count', 'count'], ['/api/service-orders', 'wrapped'],
      ['/api/booking-sources/widget-sites', 'list'],
    ];
    const rightShape = (shape, v) => {
      if (shape === 'list') return Array.isArray(v);
      if (!v || typeof v !== 'object') return false;
      return shape === 'count' ? typeof v.count === 'number' : Array.isArray(v.orders);
    };
    for (const [route, shape] of AXIS_ROUTES) {
      const mineRes = await call(cookie, `${route}?property_id=${property.id}`);
      const mine = await body(mineRes);
      claim('вісь обʼєкта', mineRes.status === 200 && rightShape(shape, mine),
        `${route}: свій обʼєкт — 200 і ${{ list: 'список', count: 'число', wrapped: 'обгорнутий список' }[shape]} (${mineRes.status})`);

      // Порожнє значення означає «усі обʼєкти» СКАЗАНО — так пишуть екрани
      // (`propertyId ? …id=… : ''`). Воно не має ставати ні відмовою, ні
      // мовчазним «перший-ліпший».
      const allRes = await call(cookie, `${route}?property_id=`);
      claim('вісь обʼєкта', allRes.status === 200 && rightShape(shape, await body(allRes)),
        `${route}: порожнє значення — «усі», а не відмова (${allRes.status})`);

      const alienRes = await call(cookie, `${route}?property_id=${TAG}alien`);
      claim('вісь обʼєкта', alienRes.status === 404,
        `${route}: чужий обʼєкт — 404, не 500 і не порожній список (${alienRes.status})`);
    }
  } finally {
    await cleanup();
  }
}

try {
  await main();
} catch (e) {
  problems.push(`прогін обірвався: ${e?.message || e}`);
  console.error(e);
}

console.log('');
if (problems.length === 0) {
  console.log('routes-live: головні маршрути відповідають, і відповідають тим, що потрібно екрану');
  process.exit(0);
}
console.log(`routes-live: ${problems.length} зламаних тверджень`);
for (const p of problems) console.log(`  ✗  ${p}`);
process.exit(1);
