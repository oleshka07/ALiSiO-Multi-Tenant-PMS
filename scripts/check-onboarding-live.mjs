/**
 * ДВА готелі від нуля до прийнятої броні й виписаного рахунку — на живій базі.
 *
 *   D=$PWD/.tmp-onboarding && rm -rf $D && mkdir -p $D
 *   ALISIO_DATA_DIR=$D PORT=3100 npm run start &
 *   ALISIO_DATA_DIR=$D BASE_URL=http://localhost:3100 node scripts/check-onboarding-live.mjs
 *
 * Шлях АБСОЛЮТНИЙ, і це не косметика: `npm run start` піднімає standalone-
 * складання, чий cwd — `.next/standalone`, тож відносний `ALISIO_DATA_DIR`
 * резолвиться у двох процесах у РІЗНІ теки. Прохід тоді заводить готель в
 * одній базі, а питає застосунок про іншу — і бреше зеленим на кроках, які
 * дивляться в базу, та 401-м на вході. Знайдено власним прогоном 07.09.
 *
 * ── Навіщо, якщо гейтів уже півтори сотні ────────────────────────────────
 *
 * За один день 07.09.2026 дві вади знайшлися не гейтами, а тим, що хтось
 * ЗРОБИВ дію:
 *
 *   INC-025  план рахунків сіється `SELECT id FROM organizations LIMIT 1` з
 *            ЛІТЕРАЛЬНИМИ первинними ключами (`db.ts:1850`). На чистій
 *            інсталяції категорій немає ні в кого, і готівкова оплата б'ється
 *            об зовнішній ключ уже в ПЕРШОГО готелю; на базі, налитій
 *            копіюванням, `ec_accommodation` належить готелю №1, і операції
 *            готелю №2 тихо чіпляються на чужий рядок.
 *   INC-027  шахматка показувала ціну ТАРИФУ як ціну номера, бо запит віддавав
 *            два рядки на клітинку.
 *
 * Обидві жили місяцями. Обидві не падали ніде. Спільне в них не технічне:
 * **жоден гейт не проходив шляхом клієнта цілком**, а обидві вади живуть саме
 * в стиках — між заведенням і фінансами, між запитом і екраном.
 *
 * `check-routes-live.mjs` закриває сусідній клас — «маршрут не відповідає» —
 * і робить це добре, але засіває організацію РУКАМИ (`INSERT INTO
 * organizations`). Тобто найдовший стик, «нового клієнта ніхто ніколи не
 * заводив», у ньому не пройдений за побудовою.
 *
 * ── Чому ДВА готелі, а не один ───────────────────────────────────────────
 *
 * З одним готелем усе зламане виглядає цілим. Це не риторика: обидві вади
 * вище на одному готелі зелені. INC-025 на одному готелі працює — категорії
 * дістались саме йому. INC-027 на одному тарифі не видно. Тому кожне
 * твердження тут ставиться ДВІЧІ, а між ними стоїть вісь орендаря: свій
 * бачить своє, чужий не бачить нічого.
 *
 * ── Що стверджується ─────────────────────────────────────────────────────
 *
 * ФОРМА відповіді, не статус (урок `check-routes-live`): фактура віддавала
 * 200 і `null` два тижні. Числа обрані арифметично несумісними з сусідніми
 * прочитаннями — 240 не можна отримати ні з «однієї ночі», ні з нуля.
 *
 * Статус стверджується там, де він І Є відповіддю: 201 на створення, 404 на
 * чуже. Жодне твердження не задовольняє будь-яка відповідь.
 *
 * ── Межа, названа прямо ──────────────────────────────────────────────────
 *
 * «Бронь із каналу» тут — `applyRevision()`, двері модуля каналів, а не
 * виклик до вендора: `channex/*` заморожено до відповіді Channex, і мережі в
 * прогоні немає. Рядок `cm_connections` кладеться прямо — це фікстура, не
 * продакшн-шлях. Що НЕ пройдено: заведення каталогу у вендора, ARI і ack
 * стрічки. Їх покриває `channex-*-live.mjs` на стенді вендора.
 *
 * ── Що показав ПЕРШИЙ прогін (08.09.2026) ────────────────────────────────
 *
 * 49 тверджень зелені, 8 червоні — і всі вісім це одна дія: «портьє прийняв
 * готівку». За нею виявилось ЧОТИРИ вади в ланцюжку (INC-028): плану рахунків
 * не отримує ніхто, касового рахунку теж, названа відмова згортається в 500,
 * а валюта компанії зашита в CZK — тобто готель не на кронах не може провести
 * готівку взагалі.
 *
 * Прохід уміє бути й ЗЕЛЕНИМ: після тимчасового усунення всіх чотирьох ланок
 * (замір знято й одразу відкочено) 57 тверджень, вихід 0. Це важливо назвати:
 * гейт, який знає лише червоне, доводить не більше за той, що знає лише
 * зелене.
 *
 * І саме тут виміряно, навіщо ДВА готелі: після усунення перших двох ланок
 * готель B (CZK) пройшов ланцюжок цілком, а готель A (EUR) — ні. З одним
 * готелем на кронах четверта вада лишалась би невидимою.
 *
 * Прибирає за собою: усе створене має тег в id або slug.
 */
// Резолвер аліасів ПЕРШИМ: `provisioning.ts` і шар даних ходять через
// `@core/…`, а голий node цих шляхів не знає (`check-bare-node`).
import './lib/module-aliases.mjs';

const { getSql } = await import('../src/core/db/async.ts');
const { runWithOrganization } = await import('../src/core/auth/tenant-context.ts');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TAG = '__onb__';
// Slug приймає лише малі літери, цифри й дефіси (`provisioning.ts`), тож тег
// для нього окремий — і саме за ним прибирання знаходить своє.
const SLUG_TAG = 'onb-probe';

// Той самий постійний хеш, що в `check-routes-live.mjs`, і з тієї ж причини:
// standalone-складання вбудовує bcryptjs у сервер, тож контейнер, зібраний з
// образу застосунку, імпортувати його не може.
const PROBE_PASSWORD = 'probe-password-1234';

const sql = getSql();
const problems = [];
const ok = (what) => console.log(`  ok  ${what}`);
const fail = (family, what) => { problems.push(`${family}: ${what}`); console.log(`  ✗   ${what}`); };

/** Твердження, яке не спиняє прогін: родина падає, решта йде далі. */
function claim(family, condition, what) {
  if (condition) ok(what); else fail(family, what);
  return !!condition;
}

const call = (cookie, path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

/** Відповідь як JSON — і окрема відмова, коли це не JSON (сторінка логіну). */
async function body(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { __notJson: text.slice(0, 160) }; }
}

const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

/**
 * ДВА готелі, і вони різні НЕ лише іменем.
 *
 * Валюта різна навмисно: сума, узята з чужого готелю, тоді видно не тільки
 * числом, а й валютою. Ціни теж різні й несумісні: 120 × 2 = 240 проти
 * 200 × 2 = 400 — «узяли ціну сусіда» не може дати ту саму відповідь
 * (інваріант 26).
 */
const HOTELS = [
  { key: 'A', slug: `${SLUG_TAG}-alpha`, name: 'Onboarding Alpha', currency: 'EUR', price: 120, total: 240, room: '101', rent: 300, tax: 50 },
  { key: 'B', slug: `${SLUG_TAG}-beta`, name: 'Onboarding Beta', currency: 'CZK', price: 200, total: 400, room: '201', rent: 700, tax: 90 },
];

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PROBE_PASSWORD }),
  });
  const raw = res.headers.get('set-cookie') || '';
  const m = raw.match(/session_id=([^;]+)/);
  if (!m) throw new Error(`вхід не дав сесії (${res.status}): ${(await res.text()).slice(0, 160)}`);
  return `session_id=${m[1]}`;
}

/**
 * Прибрати рядок і СКАЗАТИ, якщо не вийшло.
 *
 * Тут стояло тринадцять `.catch(() => {})` — у файлі, чия ж власна правка цей
 * рід і викриває (Р13.8). Глухий рукав у прибиранні шкодить двічі: наступний
 * прогін стартує з чужого сміття й падає в місці, яке до причини стосунку не
 * має; а якщо `DELETE` перестав прибирати через ПОЛІТИКУ (під роллю
 * застосунку без контексту орендаря він знімає нуль рядків і мовчить —
 * INC-014), то мовчання приховує саме те, заради чого цей гейт існує.
 *
 * Відмова прибирання не валить прогін: гейт про заведення, а не про
 * прибирання. Але вона ВИДИМА, і рядок називає таблицю.
 */
const cleanupProblems = [];
async function drop(sqlText, params, what) {
  try {
    await drop(sqlText, params);
  } catch (e) {
    cleanupProblems.push(`${what}: ${e.message}`);
  }
}

async function cleanup() {
  cleanupProblems.length = 0;
  const orgs = (await sql.rows("SELECT id FROM organizations WHERE slug LIKE ?", [`${SLUG_TAG}%`])).map((r) => r.id);
  for (const org of orgs) {
    const props = (await sql.rows('SELECT id FROM properties WHERE organization_id = ?', [org])).map((r) => r.id);
    await runWithOrganization(org, async () => {
      for (const pid of props) {
        const resIds = (await sql.rows('SELECT id FROM reservations WHERE property_id = ?', [pid])).map((r) => r.id);
        for (const rid of resIds) {
          for (const t of ['invoices', 'booking_activity_log', 'guest_registrations']) {
            await drop(`DELETE FROM ${t} WHERE reservation_id = ?`, [rid], `${t}`);
          }
        }
        await drop('DELETE FROM reservations WHERE property_id = ?', [pid], 'reservations');
        for (const t of ['ical_channels', 'cm_inbound_bookings', 'cm_outbox', 'cm_mappings', 'cm_events', 'cm_connections', 'fees_taxes']) {
          await drop(`DELETE FROM ${t} WHERE property_id = ?`, [pid], `${t}`);
        }
        // Ціни й статті обліку НЕ прибираються тут окремим запитом: вони
        // належать чужим модулям, і назвати їх у SQL означало б пробити межу
        // (`check-boundaries`). Каскад від `organizations` зносить їх сам —
        // так само робить `check-routes-live`.
        await drop('DELETE FROM rate_plans WHERE property_id = ?', [pid], 'rate_plans');
        await drop('DELETE FROM units WHERE property_id = ?', [pid], 'units');
        await drop('DELETE FROM unit_types WHERE property_id = ?', [pid], 'unit_types');
        await drop('DELETE FROM categories WHERE property_id = ?', [pid], 'categories');
      }
      for (const t of ['guests', 'invoices', 'invoice_counters',
        'invoice_series', 'organization_features', 'organization_currencies']) {
        await drop(`DELETE FROM ${t} WHERE organization_id = ?`, [org], `${t}`);
      }
      await drop('DELETE FROM properties WHERE organization_id = ?', [org], 'properties');
    });
    await drop('DELETE FROM sessions WHERE user_id IN (SELECT id FROM app_users WHERE organization_id = ?)', [org], 'sessions');
    await drop('DELETE FROM app_users WHERE organization_id = ?', [org], 'app_users');
    await drop('DELETE FROM organizations WHERE id = ?', [org], 'organizations');
  }
  if (cleanupProblems.length > 0) {
    console.log(`  !  прибирання лишило ${cleanupProblems.length} проблем(и) — наступний прогін почнеться з чужого сміття:`);
    for (const p of cleanupProblems) console.log(`       ${p}`);
  }
}

/** Провести ОДИН готель від нуля до фактури. Повертає все, що потрібне осі орендаря. */
async function runHotel(h) {
  const fam = `готель ${h.key}`;
  const { provisionOrganization } = await import('../src/core/provisioning.ts');

  // ── 1. Заведення — ТИМ САМИМ шляхом, яким заводять клієнта ─────────────
  //
  // Не `INSERT INTO organizations`: саме тут живе клас «нового клієнта ніхто
  // ніколи не заводив». `provision-org.mjs` кличе рівно цю функцію.
  const org = await provisionOrganization({
    name: h.name, slug: h.slug,
    ownerEmail: `${h.slug}@probe.test`, ownerPassword: PROBE_PASSWORD,
    currency: h.currency, language: 'uk',
  });
  claim(fam, !!org.organizationId && !!org.propertyId,
    `заведено організацію й обʼєкт (${org.organizationId ? 'є' : 'НЕМАЄ'} / ${org.propertyId ? 'є' : 'НЕМАЄ'})`);

  // Модулі, вимкнені за замовчуванням (П15): прохід перевіряє ШЛЯХ, а не
  // право на модуль — 403 «не куплено» тут означав би, що ми не спитали.
  //
  // У КОНТЕКСТІ ОРЕНДАРЯ і БЕЗ ковтання помилки (INC-014). Тут стояло
  // `sql.run(...).catch(() => {})` поза контекстом — і на Postgres під роллю
  // застосунку політика відхиляла вставку, а `catch` це з'їдав. Наслідок
  // виглядав як вада продукту: свіжий готель отримував 403 «Модуль обліку
  // вимкнено» на кожному фінансовому маршруті, і прохід доповідав про це як
  // про поломку плану рахунків. На SQLite політик немає, тому там усе
  // проходило — той самий клас, що INC-014: зелене саме там, де осі немає.
  const enabled = await runWithOrganization(org.organizationId, async () => {
    const { setFeature } = await import('../src/core/features.ts');
    for (const feature of ['channels', 'invoicing', 'accounting', 'guest_page']) {
      await setFeature(org.organizationId, feature, true);
    }
    return sql.rows(
      'SELECT feature FROM organization_features WHERE organization_id = ? AND enabled = TRUE',
      [org.organizationId]);
  });
  claim(fam, enabled.length >= 4,
    `модулі готелю увімкнено (${enabled.length}) — інакше далі буде 403 «не куплено», а не вада`);

  // Вхід — це ще й перевірка, що прохід і застосунок дивляться в ОДНУ базу:
  // готель щойно заведено цим процесом, і якщо сервер про нього не знає, річ
  // не в паролі (див. шапку про ALISIO_DATA_DIR).
  let cookie;
  try {
    cookie = await login(`${h.slug}@probe.test`);
  } catch (e) {
    fail(fam, `власник не входить: ${e.message}`);
    fail(fam, 'ЙМОВІРНО прохід і застосунок дивляться в РІЗНІ бази — ALISIO_DATA_DIR '
      + 'мусить бути АБСОЛЮТНИМ шляхом в обох процесах (див. шапку)');
    return null;
  }
  claim(fam, cookie.startsWith('session_id='), 'власник входить своїм паролем');

  // ── 2. Номери й типи ───────────────────────────────────────────────────
  const catRes = await call(cookie, '/api/categories', {
    method: 'POST', body: JSON.stringify({ property_id: org.propertyId, name: 'Rooms', type: 'hotel' }),
  });
  const category = await body(catRes);
  claim(fam, catRes.status === 201 && category.id, `категорію створено (${catRes.status})`);

  const typeRes = await call(cookie, '/api/unit-types', {
    method: 'POST',
    body: JSON.stringify({
      property_id: org.propertyId, category_id: category.id, name: 'Double', code: `DBL${h.key}`,
      max_adults: 2, max_occupancy: 2, base_occupancy: 2,
    }),
  });
  const unitType = await body(typeRes);
  if (!claim(fam, typeRes.status === 201 && unitType.id, `тип номера створено (${typeRes.status})`)) return null;

  const unitRes = await call(cookie, '/api/units', {
    method: 'POST',
    body: JSON.stringify({
      property_id: org.propertyId, category_id: category.id, unit_type_id: unitType.id,
      name: h.room, code: h.room,
    }),
  });
  const unit = await body(unitRes);
  if (!claim(fam, unitRes.status === 201 && unit.id, `номер створено (${unitRes.status})`)) return null;

  // ── 3. Тариф ───────────────────────────────────────────────────────────
  const planRes = await call(cookie, '/api/pricing/rate-plans', {
    method: 'POST',
    body: JSON.stringify({
      property_id: org.propertyId, unit_type_id: unitType.id,
      name: 'BAR', code: `BAR${h.key}`, currency: h.currency,
    }),
  });
  const plan = await body(planRes);
  claim(fam, (planRes.status === 201 || planRes.status === 200) && (plan.id || plan.ratePlanId),
    `тариф створено (${planRes.status})`);

  // ── 4. Ціни ────────────────────────────────────────────────────────────
  //
  // Через календар, а не через матрицю: це шлях екрана цін, і саме він годує
  // котирування, канал і фактуру.
  const nights = [day(31), day(32)];
  const priceRes = await call(cookie, '/api/pricing', {
    method: 'PUT',
    body: JSON.stringify({
      unitTypeId: unitType.id,
      prices: nights.map((date) => ({ date, base_price: h.price })),
    }),
  });
  claim(fam, priceRes.status === 200, `ціни на дві ночі записано (${priceRes.status})`);

  const gridRes = await call(cookie,
    `/api/pricing?unitTypeId=${unitType.id}&month=${Number(nights[0].slice(5, 7))}&year=${nights[0].slice(0, 4)}`);
  const grid = await body(gridRes);
  const cell = Array.isArray(grid?.days) ? grid.days.find((d) => d.date === nights[0]) : null;
  claim(fam, gridRes.status === 200 && !!cell, `сітка місяця віддає день ${nights[0]}`);
  // ФОРМА, не статус: число І його джерело. Саме розрив між ними був INC-027.
  claim(fam, Number(cell?.guest?.price) === h.price,
    `клітинка показує ціну гостя ${h.price} (отримано ${JSON.stringify(cell?.guest?.price)})`);
  claim(fam, cell?.guest?.origin === 'unit_type',
    `і називає джерело «базова ціна типу» (${cell?.guest?.origin})`);

  // ── 5. Котирування ─────────────────────────────────────────────────────
  const quoteRes = await call(cookie, '/api/pricing/quote', {
    method: 'POST',
    body: JSON.stringify({ unitTypeId: unitType.id, checkIn: nights[0], checkOut: day(33), adults: 2, children: 0 }),
  });
  const quote = await body(quoteRes);
  claim(fam, Number(quote?.accommodationTotal) === h.total,
    `дві ночі по ${h.price} дають ${h.total} (отримано ${JSON.stringify(quote?.accommodationTotal)})`);
  claim(fam, quote?.currency === h.currency,
    `котирування у валюті ЦЬОГО готелю ${h.currency} (${quote?.currency})`);

  // ── 6. Канал: підключення ──────────────────────────────────────────────
  const icalRes = await call(cookie, '/api/ical-sync/channels', {
    method: 'POST',
    body: JSON.stringify({
      property_id: org.propertyId, channel_type: 'unit', unit_id: unit.id,
      source_code: 'booking', ical_url: `https://example.invalid/${h.slug}.ics`,
    }),
  });
  const ical = await body(icalRes);
  claim(fam, icalRes.status === 201 && ical.id, `канал підключено (${icalRes.status})`);
  claim(fam, typeof ical?.export_token === 'string' && ical.export_token.length > 20,
    `канал дістав токен вивантаження (${typeof ical?.export_token})`);

  // ── 7. Бронь ───────────────────────────────────────────────────────────
  const bookRes = await call(cookie, '/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Ганна', lastName: `Пробна${h.key}`, email: `guest.${h.key}@probe.test`,
      unitId: unit.id, checkIn: nights[0], checkOut: day(33), nights: 2,
      adults: 2, children: 0, status: 'confirmed', source: 'direct',
      totalPrice: h.total,
    }),
  });
  const booking = await body(bookRes);
  if (!claim(fam, bookRes.status === 201 && booking.id, `бронь створено (${bookRes.status})`)) return null;

  const cardRes = await call(cookie, `/api/bookings/${booking.id}`);
  const card = await body(cardRes);
  const row = card?.reservation ?? card;
  claim(fam, Number(row?.total_price ?? row?.totalPrice) === h.total,
    `у картці сума ЦЬОГО готелю ${h.total} (${row?.total_price ?? row?.totalPrice})`);
  claim(fam, String(row?.last_name ?? row?.lastName ?? card?.guest?.last_name ?? '') === `Пробна${h.key}`,
    'у картці той самий гість');

  // ── 8. Оплата готівкою ─────────────────────────────────────────────────
  //
  // ТУТ і ловиться INC-025: місток пришпилює кожній готівковій оплаті
  // `category_id: 'ec_accommodation'` (`payment-bridge.ts:177`), а план
  // рахунків сіється на ОДНУ організацію з літеральним ключем. На чистій базі
  // категорії немає ні в кого — зовнішній ключ; на налитій — вона належить
  // готелю №1, і операція готелю №2 чіпляється на чужий рядок.
  const payRes = await call(cookie, '/api/payments', {
    method: 'POST',
    body: JSON.stringify({
      reservation_id: booking.id, amount: h.total, method: 'cash', type: 'payment',
    }),
  });
  const pay = await body(payRes);
  claim(fam, payRes.status === 201 && pay?.id,
    `оплату готівкою прийнято (${payRes.status}${pay?.error ? ` — ${pay.error}` : ''})`);

  // ── 8b. Дві витрати і P&L: оренда стоїть в ОПЕРАЦІЙНИХ, податок у ПОДАТКАХ ──
  //
  // Р12.1. Засів плану рахунків ставив назву, групу і ознаки — і НЕ ставив
  // двох колонок, за якими цей план читається: `op_type` і `classifier`.
  // Стаття без них існує, показується в списку і приймає операції; невидима
  // вона рівно там, де по ній рахують гроші:
  //
  //   - P&L (`reports.handlers.ts`) розкладає рядки за `classifier`, а
  //     порожнє поле бере `COALESCE(ec.classifier,'other')` — оренда,
  //     зарплата й податки лягають в «Інше», тобто нижче EBITDA. Для готелю
  //     це не косметика: EBITDA свіжого готелю дорівнює виручці;
  //   - `/api/finance/categories?op_type=expense` — той самий список, який
  //     відкриває форма витрати, — віддає ПОРОЖНЬО;
  //   - `autoResolveCategory` шукає `op_type='income'|'expense'` і не
  //     знаходить нічого.
  //
  // Твердження тут — про ЧИСЛО В РЯДКУ звіту, не про колонку в базі: колонка
  // може називатись інакше, а «оренда в операційних» — це те, за чим готель
  // ухвалює рішення. Дві різні статті навмисно (інваріант 26): один
  // classifier не розрізнив би «розклало правильно» і «склало все в одну
  // купу», а суми різні й несумісні — 300 і 50 не дають 350 в жодному
  // правильному прочитанні.
  const accRes = await call(cookie, '/api/finance/accounts');
  const accounts = await body(accRes);
  const cash = (Array.isArray(accounts) ? accounts : (accounts?.accounts ?? []))
    .find((a) => a.type === 'cash');
  claim(fam, !!cash, `у готелю є каса (${cash ? cash.currency : 'НЕМАЄ'})`);

  const chartRes = await call(cookie, '/api/finance/categories');
  const cats = await body(chartRes);
  const catList = Array.isArray(cats) ? cats : (cats?.categories ?? []);
  const byCode = (code) => catList.find((c) => c.code === code);

  const expenseRes = await call(cookie, '/api/finance/categories?op_type=expense');
  const expenseCats = await body(expenseRes);
  claim(fam, Array.isArray(expenseCats) && expenseCats.length > 0,
    `форма витрати має з чого обрати статтю (op_type=expense → ${
      Array.isArray(expenseCats) ? expenseCats.length : '?'} статей)`);

  const spend = async (code, amount) => {
    const cat = byCode(code);
    if (!cat || !cash) return null;
    const res = await call(cookie, '/api/finance/operations', {
      method: 'POST',
      body: JSON.stringify({
        op_type: 'expense', amount, currency: h.currency, paid_at: iso(new Date()),
        account_from_id: cash.id, category_id: cat.id, comment: `${TAG} ${code}`,
      }),
    });
    const op = await body(res);
    claim(fam, res.status === 201 && op?.id,
      `витрату «${code}» ${amount} ${h.currency} проведено (${res.status}${op?.error ? ` — ${op.error}` : ''})`);
    return cat.id;
  };
  const rentCat = await spend('rent', h.rent);
  const taxCat = await spend('taxes', h.tax);

  // Вікно назване явно, і це не косметика: звіт за замовчуванням бере ПІВРОКУ
  // НАЗАД, а рахує за `accrued_at` — оплата броні нарахована на дату
  // заїзду, тобто в майбутньому. З дефолтним вікном виручка дорівнює нулю не
  // тому, що щось зламано, а тому, що ми спитали про інші місяці.
  const pnlRes = await call(cookie, `/api/finance/pnl-matrix?from=${iso(new Date()).slice(0, 7)}&to=${day(120).slice(0, 7)}`);
  const pnl = await body(pnlRes);
  const section = (key) => (pnl?.sections ?? []).find((s) => s.key === key);
  const inSection = (key, catId) => (section(key)?.rows ?? []).find((r) => r.category_id === catId);

  claim(fam, Number(section('revenue')?.total) === h.total,
    `у P&L виручка ${h.total} (${section('revenue')?.total ?? '—'})`);
  claim(fam, Number(inSection('operational', rentCat)?.total) === h.rent,
    `оренда ${h.rent} стоїть в ОПЕРАЦІЙНИХ (${inSection('operational', rentCat)?.total ?? 'її там немає'})`);
  claim(fam, Number(inSection('tax', taxCat)?.total) === h.tax,
    `податок ${h.tax} стоїть у ПОДАТКАХ (${inSection('tax', taxCat)?.total ?? 'його там немає'})`);
  claim(fam, Number(section('other')?.total ?? 0) === 0,
    `а в «Іншому» — нуль (${section('other')?.total ?? '—'})`);
  claim(fam, Number(section('ebitda')?.total) === h.total - h.rent,
    `EBITDA = виручка мінус операційні = ${h.total - h.rent} (${section('ebitda')?.total ?? '—'})`);

  return { h, fam, org, cookie, unitType, unit, booking, ical, category };
}

async function main() {
  await cleanup();
  const preexisting = Number((await sql.row('SELECT COUNT(*) AS n FROM organizations'))?.n ?? 0);
  console.log(`\n  ··  організацій у базі до прогону: ${preexisting}`);
  if (preexisting > 0) {
    console.log('      база НЕ свіжа: INC-025 тут проявиться другою гілкою — категорії');
    console.log('      належать чужому готелю, а не відсутні зовсім. Обидві гілки погані,');
    console.log('      але червоніють по-різному. Свіжий прогін: ALISIO_DATA_DIR=<порожня тека>.');
  }

  const done = [];
  try {
    for (const h of HOTELS) {
      console.log(`\n── Готель ${h.key} (${h.name}, ${h.currency}) ──────────────────`);
      const r = await runHotel(h);
      if (r) done.push(r);
    }

    // ── 9. План рахунків: у КОЖНОГО свій ─────────────────────────────────
    //
    // Пряме твердження про INC-025, і воно не залежить від того, яка з двох
    // гілок вади в силі: на чистій базі категорій немає ні в кого, на налитій
    // вони є в одного. Обидва випадки дають «не в кожного своя».
    console.log('\n── План рахунків і фінансовий слід ──────────────────────');
    // Через ЕКРАН, не з таблиці: питаємо те саме, що побачить бухгалтер, і
    // не пробиваємо межу модуля фінансів (`check-boundaries`).
    const chart = new Map();
    for (const r of done) {
      const res = await call(r.cookie, '/api/finance/categories');
      const list = await body(res);
      const rows = Array.isArray(list) ? list : (list?.categories ?? []);
      chart.set(r.h.key, rows);
      claim('план рахунків', res.status === 200 && rows.length > 0,
        `у готелю ${r.h.key} є власний план рахунків (${res.status}, ${rows.length} статей)`);
    }
    if (done.length === 2) {
      const [a, b] = done;
      // Спільних статей бути не може: `LIMIT 1` із літеральними ключами дав
      // би ОДИН комплект на всю базу, і тоді обидва списки збігаються.
      const idsA = new Set((chart.get('A') ?? []).map((c) => c.id));
      const sharedIds = (chart.get('B') ?? []).map((c) => c.id).filter((id) => idsA.has(id));
      claim('план рахунків', sharedIds.length === 0,
        `жодна стаття не спільна між готелями (спільних: ${sharedIds.length})`);

      // І слід оплати — у СВОЄМУ готелі, з категорією СВОГО готелю.
      for (const r of done) {
        // Журнал фінансів — те, що бачить бухгалтер. Рядок мусить бути, і його
        // стаття мусить бути в ПЛАНІ ЦЬОГО готелю: саме тут INC-025 чіпляє
        // операцію на чужу статтю, і побачити це можна лише маючи два плани.
        const logRes = await call(r.cookie, '/api/finance/log?limit=50');
        const log = await body(logRes);
        // Ключ `transactions` — той, який маршрут ВІДДАЄ (`log.handlers.ts`).
        // Тут стояло `items ?? operations`, тобто імена, яких він не повертав
        // ніколи; помітити це було неможливо, доки оплата падала 500-м раніше
        // (INC-028, ланка 3). `items`/`operations` лишені для сумісності, якщо
        // форма колись зміниться, але перший — реальний.
        const rows = Array.isArray(log)
          ? log
          : (log?.transactions ?? log?.items ?? log?.operations ?? []);
        const op = rows.find((x) => x.reservation_id === r.booking.id);
        claim('план рахунків', !!op,
          `оплата готелю ${r.h.key} лишила рядок у журналі фінансів (${op ? 'є' : 'НЕМАЄ'})`);
        const own = new Set((chart.get(r.h.key) ?? []).map((c) => c.id));
        claim('план рахунків', !!op && own.has(op.category_id),
          `і стаття цього рядка є в плані готелю ${r.h.key} (стаття ${op?.category_id ?? '—'})`);
      }
    }

    // ── 10. Вісь орендаря: чужого не видно ───────────────────────────────
    console.log('\n── Чуже не видно ────────────────────────────────────────');
    if (done.length === 2) {
      const [a, b] = done;
      const listRes = await call(b.cookie, '/api/bookings');
      const list = await body(listRes);
      claim('орендар', Array.isArray(list) && !list.some((x) => x.id === a.booking.id),
        'у списку броней готелю B немає броні готелю A');
      claim('орендар', Array.isArray(list) && list.some((x) => x.id === b.booking.id),
        'а своя бронь у списку є');

      const foreignRes = await call(b.cookie, `/api/bookings/${a.booking.id}`);
      claim('орендар', foreignRes.status === 404,
        `чужа бронь за прямим id — 404, не 403 і не 200 (${foreignRes.status})`);

      const foreignGrid = await call(b.cookie, `/api/pricing?unitTypeId=${a.unitType.id}&month=11&year=2026`);
      claim('орендар', foreignGrid.status === 404,
        `чужий тип номера в цінах — 404 (${foreignGrid.status})`);
    }

    // ── 11. Виселення і фактура ──────────────────────────────────────────
    console.log('\n── Виселення і фактура ──────────────────────────────────');
    for (const r of done) {
      const outRes = await call(r.cookie, `/api/bookings/${r.booking.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'checked_out' }),
      });
      claim(r.fam, outRes.status === 200, `виселення прийнято (${outRes.status})`);

      const paidRes = await call(r.cookie, `/api/bookings/${r.booking.id}`, {
        method: 'PATCH', body: JSON.stringify({ payment_status: 'paid', payment_method: 'cash' }),
      });
      claim(r.fam, paidRes.status === 200, `бронь позначено оплаченою (${paidRes.status})`);

      // Фактуру виписує fire-and-forget виклик: помилка в ньому нікуди не
      // потрапляє, крім логу. Тому твердження — про РЯДОК, а не про статус.
      let invoice = null;
      for (let i = 0; i < 20 && !invoice; i++) {
        const invRes = await call(r.cookie, `/api/bookings/${r.booking.id}/invoice`);
        const inv = await body(invRes);
        if (invRes.status === 200 && (inv?.invoice ?? inv)?.id) invoice = inv?.invoice ?? inv;
        else await new Promise((res) => setTimeout(res, 250));
      }
      if (claim(r.fam, !!invoice, `фактуру виписано (${invoice ? 'є' : 'НЕМАЄ після 5 с'})`)) {
        claim(r.fam, Number(invoice.total ?? invoice.total_amount ?? invoice.amount) === r.h.total,
          `у фактурі сума ЦЬОГО готелю ${r.h.total} (${invoice.total ?? invoice.total_amount ?? invoice.amount})`);
        claim(r.fam, String(invoice.currency ?? '') === r.h.currency,
          `і валюта цього готелю ${r.h.currency} (${invoice.currency})`);
      }
    }
  } finally {
    await cleanup();
  }

  const BAR = '═'.repeat(78);
  console.log(`\n${BAR}`);
  if (problems.length === 0) {
    console.log('ДВА ГОТЕЛІ ПРОЙШЛИ ШЛЯХ ЦІЛКОМ — від заведення до фактури');
    console.log(BAR);
    process.exit(0);
  }
  console.log(`ШЛЯХ КЛІЄНТА ОБІРВАВСЯ — ${problems.length} відмов(и)`);
  console.log(BAR);
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
  process.exit(1);
}

await main();
