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
 * ШІСТЬ родин, 40 тверджень, і рівно **ЧОТИРИ динамічні маршрути зі 130**:
 * `/api/bookings/[id]`, `/api/bookings/[id]/invoice`, `/api/guest/[token]`,
 * `/api/channels/connections/[id]/frame`. Обидві історичні вади в цьому
 * наборі є — ціль узято правильно, — але поруч із «130 динамічних» це легко
 * прочитати як закритий клас. Клас не закритий: закрито чотири маршрути з
 * нього. Наступна родина додається дешево, бо фікстура вже стоїть.
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
 */
import assert from 'node:assert';
import { getSql } from '../src/core/db/async.ts';

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
 * Прибирання, яке НЕ мовчить про власний провал (Р8.16).
 *
 * Дев'ять `DELETE` тут обгорнуті в `try` — і мусять бути: таблиця може ще не
 * існувати на базі, старшій за міграцію. Але порожній `catch` не розрізняє
 * «таблиці немає» і «прибирання не спрацювало», а гейт бігає й на спільній
 * базі: несприбране сміття лишалося б без сліду в лозі. Тепер кожна відмова
 * називається рядком, а прогін іде далі — прибирання не має валити гейт,
 * але й ховатись не має.
 */
const swept = async (what, fn) => {
  try { await fn(); } catch (e) { console.log(`  ··  прибирання ${what}: ${e?.message || e}`); }
};

async function cleanup() {
  const props = (await sql.rows('SELECT id FROM properties WHERE organization_id = ?', [ORG])).map((r) => r.id);
  for (const pid of props) {
    const resIds = (await sql.rows('SELECT id FROM reservations WHERE property_id = ?', [pid])).map((r) => r.id);
    for (const rid of resIds) {
      for (const t of ['invoice_items', 'invoices', 'booking_activity_log', 'guest_registrations', 'accruals']) {
        await swept(t, () => sql.run(`DELETE FROM ${t} WHERE reservation_id = ?`, [rid]));
      }
    }
    await sql.run('DELETE FROM reservations WHERE property_id = ?', [pid]);
    for (const t of ['cm_outbox', 'cm_mappings', 'cm_events', 'cm_inbound_bookings']) {
      await swept(t, () => sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]));
    }
    await swept('cm_connections', () => sql.run('DELETE FROM cm_connections WHERE property_id = ?', [pid]));
    // Ціни НЕ прибираються тут окремим запитом: `price_occupancy` належить
    // модулю `pricing`, і прямий SQL звідси — пробій межі (`check-boundaries`
    // це й сказав). Рядки йдуть каскадом за обʼєктом і типом номера
    // (`ON DELETE CASCADE`), тобто прибирання не втрачає нічого.
    await swept('fees_taxes', () => sql.run('DELETE FROM fees_taxes WHERE property_id = ?', [pid]));
    await sql.run('DELETE FROM units WHERE property_id = ?', [pid]);
    await sql.run('DELETE FROM unit_types WHERE property_id = ?', [pid]);
    await sql.run('DELETE FROM categories WHERE property_id = ?', [pid]);
  }
  for (const t of ['invoices', 'invoice_counters', 'invoice_series', 'guests', 'organization_features',
    'unit_type_amenities', 'property_amenities', 'amenities', 'amenity_categories',
    'organization_currencies', 'finance_exchange_rates']) {
    await swept(t, () => sql.run(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]));
  }
  await sql.run('DELETE FROM properties WHERE organization_id = ?', [ORG]);
  await sql.run('DELETE FROM sessions WHERE user_id = ?', [USER]);
  await sql.run('DELETE FROM app_users WHERE organization_id = ?', [ORG]);
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

const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

async function main() {
  await cleanup();
  await sql.run('INSERT INTO organizations (id, name, slug, default_currency, language) VALUES (?, ?, ?, ?, ?)',
    [ORG, 'Routes probe', `${TAG}org`, 'EUR', 'uk']);
  await sql.run(
    'INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
    [USER, ORG, 'routes@probe.test', 'Routes probe', 'owner', PROBE_HASH]);
  // Модулі, вимкнені за замовчуванням (П15): гейт перевіряє МАРШРУТИ, а не
  // право на модуль — 403 «не куплено» тут означав би, що ми нічого не
  // спитали.
  for (const feature of ['guest_page', 'channels', 'invoicing', 'accounting']) {
    await sql.run(
      `INSERT INTO organization_features (organization_id, feature, enabled) VALUES (?, ?, TRUE)
       ON CONFLICT(organization_id, feature) DO UPDATE SET enabled = TRUE`,
      [ORG, feature]);
  }

  try {
    const cookie = await login('routes@probe.test');

    // ── Обʼєкт, тип номера, номер: сама фікстура і є твердженням ──────────
    //
    // Це шлях, яким користується екран налаштувань, і він створює те, на чому
    // стоять усі родини нижче. Якщо він мовчки віддасть не той статус, решта
    // впаде далеко від причини — тому статус названо тут.
    const propRes = await call(cookie, '/api/properties', {
      method: 'POST', body: JSON.stringify({ name: 'Routes probe hotel', slug: `${TAG}hotel` }),
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
      const tokenRow = await sql.row('SELECT guest_page_token FROM reservations WHERE id = ?', [booking.id]);
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
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment, webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, 'channex', 'staging', ?, ?, TRUE)`,
      [connId, ORG, property.id, `${TAG}tok`, `${TAG}secret`]);

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
