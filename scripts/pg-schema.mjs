/**
 * Generate the Postgres schema from the live SQLite database.
 *
 *   node scripts/pg-schema.mjs            # writes db/postgres/schema.sql
 *   node scripts/pg-schema.mjs --print    # to stdout
 *
 * Generated rather than hand-written on purpose. A 4000-line schema.sql
 * maintained by hand is out of date the week after it is committed, and the
 * one thing that must not drift between SQLite and Postgres is which column
 * carries the organization — that is what row-level security keys on.
 *
 * What this fixes on the way across (Phase 1.4):
 *
 *   money      REAL -> NUMERIC(14,2). A double cannot represent 0.10 exactly;
 *              a commission of 2870.55 * 0.15 stores as 430.58250000000004,
 *              and a year of those does not add up to the cent. NUMERIC is
 *              exact decimal arithmetic, and needs no change in application
 *              code — unlike moving to integer minor units, which would touch
 *              every calculation and every screen.
 *   timestamps TEXT -> TIMESTAMPTZ. ISO strings sort correctly and so hid the
 *              problem, but no arithmetic and no time zone is possible on them.
 *   dates      TEXT -> DATE where the value is a calendar day (check-in, not
 *              an instant).
 *   flags      INTEGER 0/1 -> BOOLEAN.
 *   documents  TEXT holding JSON -> JSONB.
 *
 * What it does NOT do: invent a different shape. Table and column names, keys,
 * checks and indexes come from the live database as they are.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, process.env.DB_PATH || 'data/alisio.db');
const OUT = path.join(ROOT, 'db', 'postgres', 'schema.sql');

const db = new Database(DB_PATH, { readonly: false });

// ── Type mapping ─────────────────────────────────────────────────────────────

/** Columns whose name alone does not say what they are. Table.column wins. */
const OVERRIDE = {
  // Periods and labels that look like dates but are not.
  'fin_budgets.month': 'TEXT',                 // 'YYYY-MM'
  'invoice_periods.month': 'TEXT',             // 'YYYY-MM'
  'invoices.period': 'TEXT',                   // 'YYYY-MM'
  'investor_monthly_notes.month': 'TEXT',
  'capex_items.month': 'TEXT',
  'accruals.month': 'TEXT',
  'capex_items.useful_life_months': 'INTEGER',
  'gift_card_bundles.validity_months': 'INTEGER',
  // Counts and ratios that the money pattern would otherwise claim.
  'bank_statements.total_transactions': 'INTEGER',
  'import_runs.rows_total': 'INTEGER',
  // (percentages are matched by name below — these three predate that rule and
  //  are kept so the file still says out loud what they are)
  'early_bookings.discount_percent': 'NUMERIC(5,2)',
  'reservations.commission_percent': 'NUMERIC(5,2)',
  'booking_sources.commission_percent': 'NUMERIC(5,2)',
  // Exchange rates need more precision than money.
  'finance_exchange_rates.rate': 'NUMERIC(18,8)',
  // Free-text or enum columns caught by a money/date word.
  'reservations.deposit_status': 'TEXT',
  'reservation_guests.fee_exempt_reason': 'TEXT',
  // «Stammkunde» is not an amount. Missing this one turned the column NUMERIC
  // on a regeneration, and the failure surfaced three layers away: the API
  // returned 500 on granting a discount, and check-isolation reported it as a
  // tenant problem. A reason is text even when the word next to it is money.
  'reservations.lodging_discount_reason': 'TEXT',
  'coupons.discount_type': 'TEXT',
  // Коригування похідного тарифу (Ц28): відсоток або сума — обидва з двома
  // знаками; слова «adjustment» шаблон грошей не знає.
  'rate_plans.adjustment_value': 'NUMERIC(14,2)',
  // Надбавки за заселеність (Ц30): відсоток або сума — обидва з двома знаками.
  'extra_occupancy_rules.lodging_value': 'NUMERIC(14,2)',
  'extra_occupancy_rules.meal_value': 'NUMERIC(14,2)',
  // Прапорець додаткового ліжка не має префікса is_/has_ — назвати явно, як
  // `unit_types.extra_bed_available`; індекс вилки — маленьке ціле, як у 0070.
  'extra_occupancy_rules.extra_bed': 'BOOLEAN',
  'extra_occupancy_rules.age_band_index': 'INTEGER',
  // Правила цін (0071): гроші — NUMERIC, лічильники й межі — INTEGER, як у міграції.
  'price_rules.value': 'NUMERIC(14,2)',
  'price_rules.min_los': 'INTEGER',
  'price_rules.max_los': 'INTEGER',
  'price_rules.booked_days_before_from': 'INTEGER',
  'price_rules.booked_days_before_to': 'INTEGER',
  'price_rules.occupancy_from': 'INTEGER',
  'price_rules.occupancy_to': 'INTEGER',
  'price_rules.priority': 'INTEGER',
  'price_rules.max_uses': 'INTEGER',
  'price_rules.current_uses': 'INTEGER',
  'price_rules.online_only': 'BOOLEAN',
  'gift_card_automation_rules.discount_type': 'TEXT',
  'gift_cards.value_type': 'TEXT',
  'fin_system_state.value': 'TEXT',
  'settings.value': 'TEXT',
  'import_entity_mappings.source_value': 'TEXT',
  // Спожиті токени — цілі штуки, а не гроші. Слово `total` у назві тягне
  // колонку в NUMERIC(14,2), і лічильник починає рахувати «1500.00 токенів».
  'ai_usage.total_tokens': 'BIGINT',
  // Дата як ТЕКСТ, і це рішення міграції 0040, а не недогляд: підсумок за
  // місяць береться як substr(created_at, 1, 7), і цей вираз має однаково
  // працювати на SQLite і на Postgres. TIMESTAMPTZ там дав би обрізаний
  // рядок іншого формату — тобто порожній місяць у звіті, без помилки.
  //
  // Ці два рядки тут тому, що генератор уже тричі повертав їх назад при
  // регенерації, і тричі це правили руками в schema.sql. Правка руками
  // тримається до наступного запуску; запис у OVERRIDE — до рішення.
  'ai_usage.created_at': 'TEXT',
  // «balance» у назві — не гроші, а правило: none | warning | blocking (0091).
  'properties.checkout_balance_policy': 'TEXT',
  // Прапорці, чиї назви не схожі на прапорці. Тут, а не в шаблоні `BOOL`,
  // саме тому, що це і є призначення OVERRIDE: «колонки, про які назва нічого
  // не каже». Розширювати шаблон під кожну таку — означає рано чи пізно
  // затягнути в BOOLEAN справжній лічильник.
  'unit_types.extra_bed_available': 'BOOLEAN',
  // Блок 6: «розширені ціни» — прапорець ОРГАНІЗАЦІЇ (Р9.6). BOOLEAN, а не число, бо
  // писач передає `true`/`false` (інваріант 12), і BIGINT відхилив би це на
  // Postgres — при тому, що на SQLite воно б працювало й розбіжність
  // виявилась би лише на сервері. Міграція 0112 оголошує його так само.
  'organizations.pricing_advanced': 'BOOLEAN',
  // Кіоск (0413): «чи вільно терміналу обирати кімнату сам» — прапорець, а не
  // лічильник. Без цього рядка евристика бачить INTEGER із дефолтом 1 і робить
  // BIGINT, а міграція оголошує BOOLEAN — тобто мігрована база і база нового
  // клієнта розійшлися б у ТИПІ колонки, і `check-schema-drift` сказав би про
  // це вже після того, як обидві існують.
  'properties.kiosk_auto_assign': 'BOOLEAN',
  // Кіоск (0411): `at` — мить, а не назва. Шаблон дат знає `*_at`, `created_at`,
  // `updated_at` — рівно `at` під нього не підпадає, і колонка мовчки лишалась
  // TEXT у schema.sql, тоді як міграція оголошує TIMESTAMPTZ. Тобто база нового
  // клієнта (з schema.sql) і мігрована база розходились у ТИПІ, і жоден
  // `check-schema-drift` цього не бачить: обидві його бази будуються з
  // schema.sql, а `CREATE TABLE IF NOT EXISTS` у міграції мовчить. Знайдено
  // `check-schema-types` на злитті (Д66).
  'kiosk_events.at': 'TIMESTAMPTZ',
  // Три стани: null = «вирішує правило каналу», і це не те саме, що false.
  // BOOLEAN у Postgres nullable, тож третій стан зберігається.
  'unit_types.breakfast_included': 'BOOLEAN',
  // Той самий третій стан рівнем нижче — саме бронювання (міграція 0020).
  'reservations.breakfast_included': 'BOOLEAN',
  // Миті платформи, що не ловляться `_at$`: міграція 0030 — TIMESTAMPTZ.
  // Без цих записів чесна регенерація на свіжій базі робила їх TEXT
  // (диф проти c129593, аудит 2026-08-28).
  'platform_audit.at': 'TIMESTAMPTZ',
  'platform_users.last_login': 'TIMESTAMPTZ',
  // 0022: «JSON text, same as every other free-form config». JSONB зробив би
  // свіжу базу інакшою за мігрований прод.
  'guest_page_sections.config': 'TEXT',
};

/** An amount of money. NUMERIC(14,2) — up to 999 999 999 999.99. */
const MONEY = /(^|_)(amount|price|total|balance|fee|cost|revenue|payout|deposit|commission|discount|subtotal|due|face_value|opening_balance|closing_balance)($|_)/;
const MONEY_SUFFIX = /_czk$|_eur$|_amount$|_price$|_total$|_fee$|_sum$|_gross$|_net$/;

/**
 * A percentage. NUMERIC(5,2) — up to 999.99, which is more than any of them.
 *
 * A float here is the same mistake as a float for money and worse hidden: 19.9
 * stored as 19.899999999999999 turns a commission report into a column of
 * numbers that nearly add up.
 */
const PERCENT = /_percent$|^percent$/;

/** An instant. */
const TIMESTAMP = /_at$|^created$|^updated$|^timestamp$/;
/** A calendar day, with no time of day and no zone. */
// `_date_to$` — кінець діапазону ночей (`cm_outbox.stay_date_to`, Ц15): та сама
// календарна дата, що й початок, і вона мусить лягти тим самим типом.
const DATE_ONLY = /^check_in$|^check_out$|^date$|_date$|_date_to$|^valid_from$|^valid_to$|^valid_until$|^expires_at$|^period_from$|^period_to$/;
/** A true/false flag stored as 0/1. */
// Прапорці. Список імен, а не типів, бо в SQLite прапорець — це INTEGER, і
// відрізнити його від лічильника можна лише за назвою.
//
// ── Чому список довшає ────────────────────────────────────────────────────
//
// `bookable_online` під нього не підпадав, тож у Postgres колонка виходила
// BIGINT — а сім запитів у чотирьох публічних маршрутах віджета порівнювали
// її з `TRUE`. Postgres на це відповідає `operator does not exist:
// bigint = boolean`, тобто 500. **Увесь публічний віджет — конфіг, календар,
// доступність і саме бронювання — не працював на Postgres**, тобто на беті й
// проді; на SQLite усе було гаразд, бо там `TRUE` це 1.
//
// Урок не в тому, що бракувало одного імені, а в тому, що список імен —
// дірявий за побудовою: кожен новий прапорець із незвичною назвою мовчки
// стає числом, і ламається лише на сервері. Тому окремо існує перевірка з
// іншого боку: `check-boolean-flags` тепер звіряє КОЖНЕ порівняння з
// TRUE/FALSE у коді з типом колонки у schema.sql.
const BOOL = /^is_|^has_|^can_|^includes_|^show_|^bookable_|^available_in_|_enabled$|^locked$|^confirmed$|^active$|_active$|^read_only$|^needs_|^smoking$|^partial$|_hidden$|_exempt$|_reported$|_included_in_price$|^enabled$|^archived$|_qr$/;
/** A JSON document kept in a text column. */
const JSONISH = /_json$|^old_values$|^new_values$|^parameters$|^config$|^payload$|^raw_payload$|^assumptions$|^metadata$|^allowed_tabs$|^connection_types$|^applicable_services$|^allowed_days$|^included_services$|^applied_listings$|^allowed_promo_codes$|^permissions$/;

function pgType(table, col, sqliteType, defaultValue) {
  const key = `${table}.${col}`;
  if (OVERRIDE[key]) return OVERRIDE[key];

  const inferred = inferType(table, col, sqliteType);

  // A quoted string default contradicts every type but TEXT and JSONB. This is
  // how `city_tax_paid TEXT DEFAULT 'pending'` came out as NUMERIC(14,2): the
  // name matched a money word, and only Postgres refusing the DDL said
  // otherwise. The default is data; the pattern is a guess.
  const d = defaultValue == null ? null : String(defaultValue).trim();
  const quoted = d != null && /^'([^']|'')*'$/.test(d);
  if (quoted && inferred !== 'TEXT' && inferred !== 'JSONB') {
    const inner = d.slice(1, -1);
    const looksNumeric = /^-?\d+(\.\d+)?$/.test(inner);
    const looksDate = /^\d{4}-\d{2}-\d{2}/.test(inner);
    if (!looksNumeric && !looksDate) {
      typeCorrections.push(`${table}.${col}: ${inferred} -> TEXT (default ${d})`);
      return 'TEXT';
    }
  }
  return inferred;
}

const typeCorrections = [];
/** Колонки, чий BOOLEAN тримається лише на ВІЗЕРУНКУ ІМЕНІ (Д65). */
const boolByName = [];

function inferType(table, col, sqliteType) {

  const t = (sqliteType || '').toUpperCase();
  const n = col.toLowerCase();

  // A key is a key. `paid_expense_id` matched the money pattern on `paid` and
  // came out as NUMERIC(14,2), which would have failed against the foreign key
  // it points at.
  if (/_id$|^id$/.test(n)) return t === 'INTEGER' ? 'BIGINT' : 'TEXT';

  if (JSONISH.test(n)) return 'JSONB';
  if (DATE_ONLY.test(n) && n !== 'expires_at') return 'DATE';
  if (TIMESTAMP.test(n) || n === 'expires_at') return 'TIMESTAMPTZ';
  // ── Здогад за ІМЕНЕМ, і він тепер ВИДИМИЙ ─────────────────────────────
  //
  // Оголошений `BOOLEAN` відповідає нижче в `switch` і сюди не доходить —
  // тобто «оголоси тип» завжди сильніше за «вгадай за іменем». Сюди
  // потрапляє лише те, чий тип у db.ts — `INTEGER` або порожній, і рішення
  // за нього ухвалює візерунок імені.
  //
  // 10.09.2026 це коштувало двох червоних прогонів CI:
  // `fin_payment_methods.settles_to_debtor` під візерунок не підпав, мовчки
  // став `BIGINT`, а писач клав туди `true` — на SQLite `bindable()` робить
  // із цього 1 без слова, на Postgres виходить
  // `invalid input syntax for type bigint: "false"` (Д65).
  //
  // Візерунок не знято: він тримає 70 із 74 булевих колонок, і зняти його
  // означало б переоголосити їх усі однією зміною. Але здогад більше не
  // МОВЧИТЬ — генератор друкує їх числом наприкінці, і це число має
  // спадати, а не рости: кожна нова булева колонка оголошується `BOOLEAN`
  // у db.ts, а не сподівається на своє імʼя.
  if (BOOL.test(n) && (t === 'INTEGER' || t === '')) { boolByName.push(`${table}.${col}`); return 'BOOLEAN'; }
  if (t === 'BOOLEAN') return 'BOOLEAN';
  if (PERCENT.test(n)) return 'NUMERIC(5,2)';
  if (MONEY.test(n) || MONEY_SUFFIX.test(n)) return 'NUMERIC(14,2)';

  switch (t) {
    case 'INTEGER': return 'BIGINT';
    case 'REAL':    return 'DOUBLE PRECISION';
    case 'NUMERIC': return 'NUMERIC(14,2)';
    case 'BLOB':    return 'BYTEA';
    case 'DATETIME':return 'TIMESTAMPTZ';
    case 'BOOLEAN': return 'BOOLEAN';
    default:        return 'TEXT';
  }
}

/** SQLite default expression -> Postgres, or null when it cannot carry over. */
function pgDefault(raw, type) {
  if (raw == null) return null;
  const v = String(raw).trim();

  // Годинник у колонку ТЕКСТУ.
  //
  // `now()` повертає timestamptz, і в TEXT-колонці Postgres відхиляє це на
  // рівні DDL: схема не завантажується взагалі. Досі такого поєднання не
  // траплялось, бо `datetime('now')` у SQLite майже завжди стоїть на
  // DATETIME-колонці. `ai_usage.created_at` — перша TEXT: там дата навмисно
  // текст (міграція 0040), щоб substr(created_at, 1, 7) давав місяць на обох
  // двигунах.
  //
  // Формат — той самий ISO 8601, що пише застосунок (`toISOString()`), інакше
  // рядок за замовчуванням і рядок від коду порівнювалися б по-різному.
  const nowText = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
  const isText = type === 'TEXT';

  if (/^datetime\(\s*'now'\s*\)$/i.test(v)) return isText ? nowText : 'now()';
  if (/^date\(\s*'now'\s*\)$/i.test(v)) return isText ? `to_char(CURRENT_DATE, 'YYYY-MM-DD')` : 'CURRENT_DATE';
  if (/^CURRENT_TIMESTAMP$/i.test(v)) return isText ? nowText : 'now()';
  const rb = v.match(/^lower\(hex\(randomblob\((\d+)\)\)\)$/i);
  if (rb) return `encode(gen_random_bytes(${rb[1]}), 'hex')`;
  if (/^strftime\(\s*'%Y-%m-%dT%H:%M:%SZ'\s*,\s*'now'\s*\)$/i.test(v)) return isText ? nowText : 'now()';
  if (/^NULL$/i.test(v)) return null; // no default is the same thing, and clearer

  if (type === 'BOOLEAN') {
    if (v === '0') return 'false';
    if (v === '1') return 'true';
  }
  if (type === 'JSONB' && /^'.*'$/.test(v)) return `${v}::jsonb`;
  // Numeric and quoted-string literals carry over as they are.
  if (/^-?\d+(\.\d+)?$/.test(v) || /^'([^']|'')*'$/.test(v)) return v;
  return null; // an expression we have not taught it — dropped, and reported
}

// ── Read the live schema ─────────────────────────────────────────────────────

const tables = db
  .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
  .all();

const indexes = db
  .prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY tbl_name, name`)
  .all();

const info = new Map();   // table -> columns
const fks = new Map();    // table -> foreign keys
for (const t of tables) {
  info.set(t.name, db.prepare(`PRAGMA table_info("${t.name}")`).all());
  fks.set(t.name, db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all());
}

/** CHECK constraints are not exposed by any pragma, so they come from the DDL. */
function checksOf(sql) {
  const out = [];
  const re = /CHECK\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
      i++;
    }
    // `CONSTRAINT x CHECK (…)` їде в Postgres під СВОЇМ ім'ям. Безіменний
    // CHECK Postgres називає сам — і міграція, яка ставить той самий CHECK
    // за іменем (`IF NOT EXISTS … conname`), не впізнає його й додає другий.
    // Це вже сталося одного разу; див. коментар у check-schema-drift.mjs.
    const named = /CONSTRAINT\s+["'`[]?([A-Za-z_0-9]+)["'`\]]?\s*$/i.exec(sql.slice(0, m.index));
    out.push({
      name: named ? named[1] : null,
      expr: sql.slice(m.index + m[0].length, i - 1).replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

/** UNIQUE(...) constraints, from the auto-indexes SQLite creates for them. */
function uniquesOf(table) {
  const out = [];
  for (const ix of db.prepare(`PRAGMA index_list("${table}")`).all()) {
    if (!ix.unique) continue;
    if (ix.origin === 'pk') continue; // the primary key is emitted separately
    // A partial unique index (`… WHERE business_id IS NOT NULL`, 0093) is not
    // a table constraint: emitted as a table UNIQUE it would lose its WHERE
    // and double the index that is written out below with the predicate kept.
    if (ix.partial) continue;
    const cols = db.prepare(`PRAGMA index_info("${ix.name}")`).all().map((c) => c.name);
    if (cols.some((c) => c == null)) continue; // expression index — skipped, reported
    out.push(cols);
  }
  return out;
}

// ── Tenancy: how each table reaches an organization ──────────────────────────

const ORG_COL = 'organization_id';
// Identity. These are read BEFORE the tenant is known — login looks a user up
// by email, and every authenticated request joins app_users through a session
// id — so a tenant policy cannot restrict them, it can only break them:
// current_setting('app.organization_id') RAISES on a connection that has not
// set it, and no caller can set it before it knows which organization the
// person belongs to. Scoped by the application instead: every query that lists
// or edits users carries WHERE organization_id = ?, and check-isolation.mjs
// proves it against a live database.
// `platform_memberships` — тут же, і це вимір, а не аналогія (INC-101).
//
// Таблиця МАЄ `organization_id`, тож механічно дістала тенантну політику: рядок
// начебто належить рахунку. Насправді він належить ЛЮДИНІ — це відповідь на
// питання «у які рахунки їй можна увійти», і читають її РАНІШЕ, ніж рахунок
// відомий: `accountsFor()` малює список до будь-якого входу.
//
// На свіжій базі з політикою виміряно роллю застосунку (`alisio_app`), готельєр
// із одним членством, який ще нікуди не входив:
//
//   accountsFor()        -> 0 рядків при 1 рядку в таблиці (не виняток: пул
//                          пише app.organization_id = '', і строгий предикат
//                          просто нічого не збігає)
//   enterOrganization()  -> false у ВЛАСНИЙ готель, тобто 404 на маршруті
//
// Тобто перемикач мертвий в обидва боки, і мовчки — той самий клас INC-014
// («функція зникла», а не «помилка»).
//
// Чому саме IDENTITY, а не READ_BEFORE_TENANT. Друга форма
// (OR current_setting('app.organization_id') = '') на цій базі СПРАЦЮВАЛА б,
// бо пул завжди пише порожній рядок, — але вона лишає строгу гілку чинною там,
// де орендар УЖЕ стоїть: сесія всередині готелю А не побачила б власного
// членства в Б, тобто перехід «з готелю в готель» залежав би від того, чи
// несе зʼєднання орендаря. Політика, чинність якої залежить від випадкового
// стану зʼєднання, гірша за її відсутність. Обмеження тут інше й воно в коді:
// кожен запит несе WHERE platform_user_id = ?.
const IDENTITY = new Set(['organizations', 'sessions', 'platform_memberships']);

// Reference data, the same rows for every customer.
// Readable before the tenant is known. Two entry points have this shape, and
// in both the lookup is HOW the organization is discovered:
//
//   app_users      login looks a person up by email, and every authenticated
//                  request joins this table through a session id.
//   booking_sites  a guest is not a tenant. The widget arrives with a public
//                  site key and nothing else.
//
// postgres.ts sets app.organization_id to '' when there is no context, so the
// strict predicate matched nothing and every login returned 401 and every
// widget 404: not a refusal, a table the application could not read.
//
// booking_sites carries its own organization_id (see the migration in
// core/db) so this stays one table. Reaching an organization through
// property_id would have meant opening `properties` to anonymous reads too —
// the name, city and address of every hotel on the server.
//
// Only the read side opens, and only while no tenant is set. WITH CHECK stays
// strict, so no row can ever be written into another organization, and a
// request that HAS a tenant still sees only its own users.
const READ_BEFORE_TENANT = new Set(['app_users', 'booking_sites']);

// One row, to whoever holds its secret.
//
// Some links are addressed by a token and nothing else — a guest opening their
// booking, a partner opening the month's report. No session, no site key, no
// organization. These tables cannot join the two above (opening every booking
// on the server is not a trade anyone would make), so the token itself is the
// credential, and the policy is taught to recognise it: the route puts the
// token on the connection, exactly as it puts the organization, and the policy
// matches that one row.
//
// The map is table -> the column holding that table's token. One connection
// setting serves all of them (`app.public_token`); a second name for the same
// idea would only mean the next reader has to check both places.
//
// What this opens is bounded by design:
//
//   - one row, the one whose token was presented, and only on READ;
//   - NULLIF, so an unset or empty setting matches nothing — a row whose own
//     token is '' must never become world-readable;
//   - WITH CHECK is untouched, so no such link can ever write a row anywhere.
//
// Having read it, the route learns the organization from that row and runs
// everything else under the ordinary tenant context. That is why both tables
// carry their own organization_id: neither caller can reach a parent to derive
// it.
const PUBLIC_TOKEN_READ = new Map([
  ['reservations', 'guest_page_token'],
  ['partner_reports', 'token'],
  // The channel manager holds this URL and opens it with no session, so the
  // token has to reach the row the same way a guest link does. Without the
  // entry the feed read nothing on Postgres and answered with an empty
  // calendar — every date free, the room sellable twice (migration 0035).
  ['ical_channels', 'export_token'],
  // The channel manager's webhook arrives with no session: the token in the
  // URL is the only thing that names the connection, and the row has to be
  // read before the tenant is known (migration 0060). The header secret is
  // checked by code after the read; the token opens a row, never the door.
  ['cm_connections', 'webhook_token'],
  // Термінал у холі обмінює шестизначний код на токен, ще не знаючи
  // орендаря: рядок парування має бути прочитаний ДО того, як відомо, чий
  // він (Блок «Кіоск», міграція 0411). У базі лежить sha256 коду, і саме він
  // ставиться перепусткою — тобто перепустка тут не «схожа на секрет», вона
  // і Є секрет, тож звіряти її може сама політика. Вікно завширшки в один
  // запит: далі йде звичайний `runWithOrganization`.
  ['kiosk_pairings', 'code_hash'],
  // Наліпка з QR на дверях готелю. Гість сканує її телефоном і потрапляє на
  // сторінку, де сесії немає за визначенням: рядок обʼєкта треба прочитати
  // ДО того, як відомо, чий він (гостьовий застосунок, міграція 0414).
  // Ключ непрозорий і достатньо довгий, щоб не добиратись перебором, і
  // вікно, у якому він щось значить, — один запит: далі сторінка йде
  // звичайним `runWithOrganization` з орендарем, якого назвав цей рядок.
  ['properties', 'guest_app_key'],
]);

/**
 * Обмеження, яких SQLite не має, тож у схему вони потрапляють ЗВІДСИ.
 *
 * Генератор читає локальну SQLite і вміє переказати лише те, що там є. Усе,
 * що існує тільки в Postgres — `EXCLUDE`, часткові індекси з виразами, — у
 * ній не відбите ніяк, а отже й у `schema.sql` не потрапить.
 *
 * Наслідок не теоретичний: обмеження, дописане лише в міграцію, стоїть у
 * мігрованому середовищі й відсутнє в `schema.sql`, тобто в тому, з чого
 * заводиться НОВИЙ клієнт. Це рівно те, про що AGENTS §4 каже про індекси, і
 * саме це побачив `check-schema-drift` на `no_double_booking`: «новий клієнт
 * заведеться БЕЗ цього».
 *
 * Копія тут і копія в міграції — свідомі: міграція оновлює наявну базу,
 * schema.sql створює нову, і злити їх нема куди. Тримає їх у згоді
 * `check-overlap-statuses` (список статусів) і `check-schema-drift` (уся
 * форма, на справжньому Postgres).
 */
const POSTGRES_ONLY_CONSTRAINTS = [
  {
    table: 'reservations',
    name: 'no_double_booking',
    extension: 'btree_gist',
    // Двоє не в'їжджають в один номер на одну ніч (INC-045, міграція 0133).
    // Півінтервал: виїзд 12-го і заїзд 12-го — різні ночі. Службовий фонд
    // (`is_pool_unit`) тримає багато броней навмисно, інакше кемпінг став би
    // непродаваним. Бронь без номера не перетинається ні з чим.
    // Шаблонний рядок, а не склейка з екранованими лапками: `\"status\"`
    // читається погано і людиною, і гейтом — `check-overlap-statuses` не
    // впізнавав у ньому колонку, бо за іменем стояв не пробіл, а зворотна
    // скісна. Тут SQL має виглядати як SQL.
    body: `EXCLUDE USING gist (
    "unit_id" WITH =,
    daterange("check_in", "check_out") WITH &&
  )
  WHERE ("unit_id" IS NOT NULL
         AND NOT "is_pool_unit"
         AND "status" NOT IN ('cancelled', 'no_show'))`,
  },
];

const REFERENCE = new Set([
  'rate_limits', 'settings', 'content_translations',
  'email_processed', 'fin_system_state', 'hostex_sync_log', 'hostex_property_map',
]);

const GLOBAL = new Set([...IDENTITY, ...REFERENCE]);

const columnsOf = (t) => new Set((info.get(t) || []).map((c) => c.name));

/**
 * Returns how to constrain this table to the current organization:
 *   {kind:'direct'}                      -> organization_id = current
 *   {kind:'derived', col, parent}        -> col IN (SELECT id FROM parent WHERE ...)
 *   {kind:'global'} | {kind:'none'}
 */
function scopeOf(table, seen = new Set()) {
  if (GLOBAL.has(table)) return { kind: 'global' };
  if (columnsOf(table).has(ORG_COL)) return { kind: 'direct' };
  if (seen.has(table)) return { kind: 'none' };
  seen.add(table);

  // Which foreign key to hang the policy on, when there is more than one.
  //
  // Taking the first that reaches an organization is what this did, and it
  // chose building_id for unit_types — a column a unit type does not need.
  // A policy keyed on a NULLable column is not a policy: `NULL IN (SELECT …)`
  // is NULL, never true, so a row without a building could not be inserted
  // (WITH CHECK) and, had one existed, could not be read (USING). Every unit
  // type created on Postgres was rejected. The same table has property_id,
  // NOT NULL, one hop from the organization.
  //
  // So: a mandatory key beats an optional one, and among equals the shorter
  // path wins — fewer subqueries per row, and one less table whose own policy
  // has to be right for this one to hold.
  const notnull = new Map((info.get(table) || []).map((c) => [c.name, !!c.notnull]));
  const ranked = (fks.get(table) || [])
    .filter((fk) => fk.table !== table)
    // A copy per candidate: `seen` guards one PATH against cycles, and sharing
    // it let the first foreign key evaluated mark a parent visited, so a better
    // key pointing at the same parent was thrown away as a cycle. That is how
    // reservation_guests ended up scoped through the optional guest_id while
    // reservation_id, NOT NULL, sat right there.
    .map((fk) => ({ fk, up: scopeOf(fk.table, new Set(seen)) }))
    .filter((c) => c.up.kind === 'direct' || c.up.kind === 'derived')
    .map((c) => ({ ...c, rank: (notnull.get(c.fk.from) ? 0 : 2) + (c.up.kind === 'direct' ? 0 : 1) }))
    .sort((a, b) => a.rank - b.rank);

  if (ranked.length) {
    const best = ranked[0];
    if (!notnull.get(best.fk.from)) {
      notes.push(`${table}: scoped through ${best.fk.from}, which is NULLable — a row with NULL there is invisible to every tenant`);
    }
    return { kind: 'derived', col: best.fk.from, parent: best.fk.table };
  }
  return { kind: 'none' };
}

/** The RLS predicate for one table, or null when it needs none. */
function rlsPredicate(table) {
  const s = scopeOf(table);
  if (s.kind === 'direct') {
    return `${q(ORG_COL)} = current_setting('app.organization_id')`;
  }
  if (s.kind === 'derived') {
    const parentPred = rlsPredicate(s.parent);
    if (!parentPred) return null;
    return `${q(s.col)} IN (SELECT ${q('id')} FROM ${q(s.parent)} WHERE ${parentPred})`;
  }
  return null;
}

const q = (name) => `"${name}"`;

// ── Emit ─────────────────────────────────────────────────────────────────────

const notes = [];
const out = [];
const w = (s = '') => out.push(s);

w('--');
w('-- ALiSiO PMS — Postgres schema');
w('--');
w('-- GENERATED by scripts/pg-schema.mjs from the live SQLite database.');
w('-- Do not edit by hand: re-run the generator instead, and put judgement');
w('-- calls in its OVERRIDE map so they survive the next run.');
w('--');
w('-- Row-level security is at the bottom. Every connection must set the');
w('-- tenant before it reads anything:');
w('--');
w("--     SET LOCAL app.organization_id = '<org id>';");
w('--');
w('-- Without it the query returns no rows: on a fresh connection');
w('-- current_setting() raises undefined_object, and once the parameter has');
w('-- been set anywhere in the session it reads back empty, which matches');
w('-- nothing. Either way a forgotten scope is an error or an empty result,');
w('-- never a full-table read. That is the whole point.');
w('--');
w('-- The application must connect as a role that is NOT the table owner.');
w('-- FORCE ROW LEVEL SECURITY below covers the owner too, but relying on it');
w('-- alone means one table missing FORCE is a silent full-table read.');
w('--');
w();
w('CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_bytes for id defaults');
for (const ext of new Set(POSTGRES_ONLY_CONSTRAINTS.map((c) => c.extension).filter(Boolean))) {
  w(`CREATE EXTENSION IF NOT EXISTS ${ext};  -- ${POSTGRES_ONLY_CONSTRAINTS
    .filter((c) => c.extension === ext).map((c) => c.name).join(', ')}`);
}
w();

for (const t of tables) {
  const cols = info.get(t.name);
  if (!cols.length) continue;

  const pk = cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  const lines = [];

  for (const c of cols) {
    const type = pgType(t.name, c.name, c.type, c.dflt_value);
    const def = pgDefault(c.dflt_value, type);
    if (c.dflt_value != null && def === null && !/^NULL$/i.test(String(c.dflt_value).trim())) {
      notes.push(`${t.name}.${c.name}: default ${JSON.stringify(c.dflt_value)} not carried over`);
    }
    // A single-column INTEGER PRIMARY KEY is SQLite's rowid alias: implicitly
    // NOT NULL, and filled in by SQLite when the INSERT omits it. Postgres will
    // not fill it in unless told to, so without IDENTITY the first insert that
    // relies on that fails the NOT NULL — which is exactly what took the Hostex
    // sync down on the first run against Postgres. BY DEFAULT rather than
    // ALWAYS, so the import can still write the ids it is copying.
    const rowidAlias = pk.length === 1 && pk[0] === c.name
      && String(c.type).toUpperCase() === 'INTEGER' && def === null;

    let line = `  ${q(c.name)} ${type}`;
    if (def !== null) line += ` DEFAULT ${def}`;
    if (rowidAlias) line += ' GENERATED BY DEFAULT AS IDENTITY';
    if (c.notnull || (pk.length === 1 && pk[0] === c.name)) line += ' NOT NULL';
    lines.push(line);
  }

  if (pk.length) lines.push(`  PRIMARY KEY (${pk.map(q).join(', ')})`);
  for (const u of uniquesOf(t.name)) lines.push(`  UNIQUE (${u.map(q).join(', ')})`);


  for (const { name, expr } of checksOf(t.sql || '')) {
    // datetime('now') and friends inside a CHECK would not parse; those are
    // rare and reported rather than translated blindly.
    if (/datetime\(|date\(|strftime\(/i.test(expr)) {
      notes.push(`${t.name}: CHECK (${expr}) uses a SQLite date function — review by hand`);
      continue;
    }
    lines.push(name ? `  CONSTRAINT ${q(name)} CHECK (${expr})` : `  CHECK (${expr})`);
  }

  w(`CREATE TABLE ${q(t.name)} (`);
  w(lines.join(',\n'));
  w(');');
  w();
}

// ── Foreign keys ─────────────────────────────────────────────────────────────
// Added after every table exists: the tables are emitted alphabetically, which
// does not respect dependencies, and the schema has cycles that no ordering
// would resolve anyway.

w('-- ── Foreign keys ────────────────────────────────────────────────────────');
w();
const known = new Set(tables.map((t) => t.name));
for (const t of tables) {
  let n = 0;
  for (const fk of fks.get(t.name) || []) {
    if (!known.has(fk.table)) {
      notes.push(`${t.name}.${fk.from}: references ${fk.table}, which does not exist — dropped`);
      continue;
    }
    const onDelete = fk.on_delete && fk.on_delete !== 'NO ACTION' ? ` ON DELETE ${fk.on_delete}` : '';
    const onUpdate = fk.on_update && fk.on_update !== 'NO ACTION' ? ` ON UPDATE ${fk.on_update}` : '';
    w(`ALTER TABLE ${q(t.name)} ADD CONSTRAINT ${q(`fk_${t.name}_${fk.from}_${++n}`)}`);
    w(`  FOREIGN KEY (${q(fk.from)}) REFERENCES ${q(fk.table)} (${q(fk.to || 'id')})${onDelete}${onUpdate};`);
  }
}
w();

// ── Обмеження, яких SQLite не має ────────────────────────────────────────────

if (POSTGRES_ONLY_CONSTRAINTS.length) {
  w('-- ── Constraints SQLite cannot express ───────────────────────────────────');
  w('--');
  w('-- Not read out of the SQLite database like everything above: SQLite has no');
  w('-- EXCLUDE at all, so these live in scripts/pg-schema.mjs and are mirrored by');
  w('-- a migration for environments that already exist.');
  w();
  for (const c of POSTGRES_ONLY_CONSTRAINTS) {
    if (!known.has(c.table)) {
      notes.push(`${c.name}: table ${c.table} does not exist — constraint dropped`);
      continue;
    }
    w(`ALTER TABLE ${q(c.table)} ADD CONSTRAINT ${q(c.name)}`);
    w(`  ${c.body};`);
    w();
  }
}

// ── Indexes ──────────────────────────────────────────────────────────────────

w('-- ── Indexes ─────────────────────────────────────────────────────────────');
w();
/**
 * Предикат часткового індексу — з вихідного DDL, або гучна відмова.
 *
 * Розділяємо ПО СЛОВУ `WHERE`, а не регуляркою по дужках: предикат сам може
 * містити дужки (`WHERE (a IS NULL)`), і жадібне `\(([^;]*)\)` тоді
 * захопило б половину предиката в список колонок.
 *
 * Дати вирізаються навмисно: `datetime()`/`date()`/`strftime()` у предикаті —
 * це SQLite, і Postgres такий індекс не створить. Але це ЄДИНИЙ випадок,
 * коли предикат можна втратити, і він лишає примітку.
 */
function splitIndexDdl(sql) {
  const m = sql.match(/\bWHERE\b/i);
  if (!m) return { head: sql, where: null };
  return { head: sql.slice(0, m.index), where: sql.slice(m.index + 5) };
}

for (const ix of indexes) {
  if (ix.name.startsWith('sqlite_')) continue;
  const cols = db.prepare(`PRAGMA index_info("${ix.name}")`).all();
  const { head, where } = splitIndexDdl(ix.sql);
  const dateBound = where && /datetime\(|date\(|strftime\(/i.test(where);
  const partial = where && !dateBound ? ` WHERE${where.replace(/\s+/g, ' ').replace(/;$/, '')}` : '';
  if (dateBound) notes.push(`index ${ix.name}: partial WHERE uses a date function — dropped`);

  // ЧАСТКОВИЙ УНІКАЛЬНИЙ ІНДЕКС БЕЗ ПРЕДИКАТА — це не «трохи інший індекс»,
  // це ІНШЕ ОБМЕЖЕННЯ, і суворіше. `cm_outbox` втратив свій предикат саме
  // так: `CREATE UNIQUE … WHERE claimed_at IS NULL` став тотальним, і на
  // Postgres нова зміна після захоплення не вставлялась НІКОЛИ. Мовчки: гілка
  // для індексів із виразами губила `WHERE` і навіть не лишала примітки.
  //
  // Гейти цього не бачили за означенням: `check-fresh-schema` звіряє SQLite
  // із SQLite (предикат є з обох боків), а `check-schema-drift` — schema.sql
  // проти міграцій, де `CREATE … IF NOT EXISTS <ім'я>` пропускається, бо ім'я
  // вже зайняте тотальним індексом. Той самий обхід за іменем, що з
  // констрейнтами (AGENTS §4), тільки поверхом вище.
  if (dateBound && /CREATE\s+UNIQUE\s+INDEX/i.test(ix.sql)) {
    console.error(`\n✗ ${ix.name}: частковий УНІКАЛЬНИЙ індекс із датою в предикаті.`);
    console.error('  Без предиката він став би іншим — і суворішим — обмеженням.');
    console.error('  Перепишіть предикат без date-функцій або зробіть індекс не-унікальним.');
    process.exit(1);
  }

  const uniq = /CREATE\s+UNIQUE\s+INDEX/i.test(ix.sql) ? 'UNIQUE ' : '';

  if (cols.some((c) => c.name == null)) {
    // Індекс за виразом. Postgres розуміє той самий вираз, тож список колонок
    // беремо з вихідного DDL, а не з прагми — але предикат при цьому НЕ
    // губимо, на відміну від першої версії цього коду.
    const inner = (head.match(/\(([\s\S]*)\)\s*$/) || [])[1];
    if (!inner) { notes.push(`index ${ix.name}: expression index — not generated`); continue; }
    w(`CREATE ${uniq}INDEX ${q(ix.name)} ON ${q(ix.tbl_name)} (${inner.trim().replace(/\s+/g, ' ')})${partial};`);
    continue;
  }

  w(`CREATE ${uniq}INDEX ${q(ix.name)} ON ${q(ix.tbl_name)} (${cols.map((c) => q(c.name)).join(', ')})${partial};`);
}
w();

// Every RLS predicate is a lookup on organization_id or on a parent's id, so
// those columns are indexed whether or not SQLite had an index there.
w('-- Indexes the row-level security predicates depend on.');
for (const t of tables) {
  if (!columnsOf(t.name).has(ORG_COL)) continue;
  w(`CREATE INDEX IF NOT EXISTS ${q(`idx_${t.name}_org`)} ON ${q(t.name)} (${q(ORG_COL)});`);
}
w();

// ── The tenant an inserted row belongs to ────────────────────────────────────
//
// A read does not have to name its organization: the policy adds it. A write
// did, and that asymmetry broke fourteen INSERT statements on Postgres, every
// time, silently up to the 500 they eventually caused — the booking handshake
// among them, so no guest could start a reservation.
//
//   INSERT INTO widget_handshakes (token, site_id, expires_at) VALUES (…)
//
// organization_id is not in the column list, so it is NULL, and the policy asks
// `NULL = 'org_…'`, which is NULL rather than true. Refused. Setting the tenant
// context correctly does not help: the context is what the policy compares
// against, not what fills the column. Nothing about the error says which column
// was missing, and every one of these looked like a correct statement.
//
// So the column defaults to the tenant the statement is already running as, and
// a write is symmetric with a read: neither has to restate what the connection
// already knows.
//
// NULLIF matters. With no tenant set the setting is '' — an empty organization
// id would satisfy `'' = ''` and the row would be written into no hotel at all,
// visible to nobody and belonging to nothing. NULL fails the check instead, so
// "I forgot to establish a tenant" stays an error, which is what it is.
//
// `true` is the missing_ok argument: current_setting RAISES on a connection that
// never set the variable, and a psql session doing maintenance has not. Without
// it, adding this default would make the schema unusable by hand.
w('-- ── The tenant an inserted row belongs to ───────────────────────────────');
w('--');
w('-- A read gets its organization from the policy; a write had to restate it in');
w('-- every column list, and fourteen INSERTs that did not were refused outright.');
w('-- The default is the tenant the connection is already running as. NULLIF so');
w('-- that no tenant stays an error rather than becoming an empty organization.');
for (const t of tables) {
  if (scopeOf(t.name).kind !== 'direct') continue;
  w(`ALTER TABLE ${q(t.name)} ALTER COLUMN ${q(ORG_COL)}`);
  w(`  SET DEFAULT NULLIF(current_setting('app.organization_id', true), '');`);
}
w();

// ── Row-level security ───────────────────────────────────────────────────────

w('-- ── Row-level security ──────────────────────────────────────────────────');
w('--');
w('-- The application connects as a role that is NOT the table owner and NOT');
w('-- superuser, so these policies actually apply. FORCE makes them apply to');
w('-- the owner too, which is what catches a migration script reading across');
w('-- tenants by accident.');
w();

const rlsCovered = [];
const rlsIdentity = [];
const rlsReference = [];
const rlsNone = [];

for (const t of tables) {
  const s = scopeOf(t.name);
  if (s.kind === 'global') { (IDENTITY.has(t.name) ? rlsIdentity : rlsReference).push(t.name); continue; }
  const pred = rlsPredicate(t.name);
  if (!pred) { rlsNone.push(t.name); continue; }
  rlsCovered.push(t.name);
  let readPred = pred;
  if (READ_BEFORE_TENANT.has(t.name)) {
    readPred = `${pred} OR current_setting('app.organization_id') = ''`;
  } else if (PUBLIC_TOKEN_READ.has(t.name)) {
    const col = PUBLIC_TOKEN_READ.get(t.name);
    readPred = `${pred} OR ${q(col)} = NULLIF(current_setting('app.public_token', true), '')`;
  }
  w(`ALTER TABLE ${q(t.name)} ENABLE ROW LEVEL SECURITY;`);
  w(`ALTER TABLE ${q(t.name)} FORCE ROW LEVEL SECURITY;`);
  w(`CREATE POLICY ${q(`${t.name}_tenant`)} ON ${q(t.name)}`);
  w(`  USING (${readPred})`);
  w(`  WITH CHECK (${pred});`);
  w();
}

w('-- Identity: read before the tenant is known, so a policy here would not');
w('-- restrict these queries, it would break them. Scoped by the application.');
for (const t of rlsIdentity) w(`--   ${t}`);
w();
w('-- Reference data, identical for every customer: no policy by design.');
for (const t of rlsReference) w(`--   ${t}`);
w();
if (rlsNone.length) {
  w('-- !! No path to an organization — these would be shared between customers.');
  for (const t of rlsNone) w(`--   ${t}`);
  w();
}

const sql = out.join('\n');

/**
 * Every "table"."column" a generated schema declares.
 *
 * Both sides of the comparison below come out of this same generator, so the
 * formatting is identical and a line-shaped parse is enough — this is not a SQL
 * parser and does not need to be.
 */
function declaredColumns(text) {
  const found = new Set();
  let table = null;
  // split(/\r?\n/), не '\n': комічена schema.sql на Windows-копії має CRLF,
  // $-анкер нижче не збігається — `before` порожній, і запобіжник «відмовитись
  // писати, якщо колонки зникають» мовчки перестає існувати.
  for (const line of text.split(/\r?\n/)) {
    const open = line.match(/^CREATE TABLE "([^"]+)" \($/);
    if (open) { table = open[1]; continue; }
    if (!table) continue;
    if (line.startsWith(')')) { table = null; continue; }
    const col = line.match(/^\s+"([^"]+)"\s/);
    if (col) found.add(`${table}.${col[1]}`);
  }
  return found;
}

/**
 * This generator reads the LOCAL SQLite database, so the schema it writes is
 * only as current as whoever ran it. A copy older than the committed schema
 * regenerates one with the newer columns simply absent — and absent is silent,
 * because a column that was never created looks exactly like a column removed.
 * The result loads into Postgres cleanly and builds a database the application
 * cannot use, with nothing in any migration to put the column back.
 *
 * Not hypothetical enough to skip: a regeneration during this change moved seven
 * columns to different positions in their CREATE TABLE, which in a diff looks
 * identical to deleting them. That one was harmless — the columns were all still
 * there, and this comparison is what established it. A stale database would look
 * the same and not be harmless, and reading a 2700-line diff carefully enough to
 * tell the difference is not a plan.
 *
 * Compared as a set of columns rather than as text, so reordering passes and loss
 * does not. A column genuinely meant to go is dropped in SQLite and regenerated
 * with --allow-removals, which puts the intent on the record.
 */
if (fs.existsSync(OUT) && !process.argv.includes('--print')) {
  const before = declaredColumns(fs.readFileSync(OUT, 'utf8'));
  const after = declaredColumns(sql);
  const lost = [...before].filter((c) => !after.has(c));
  if (lost.length && !process.argv.includes('--allow-removals')) {
    console.error(`\nrefusing to write: ${lost.length} column(s) present in ${path.relative(ROOT, OUT)} would disappear\n`);
    for (const c of lost) console.error(`  - ${c}`);
    console.error(`
Almost certainly the local SQLite database is older than the committed schema:
this generator reads db/pms.db, not the other way round. Bring it up to date
(boot the app once, or copy a current one) and regenerate.

If a column is genuinely meant to go, drop it in SQLite and pass
--allow-removals so the intent is on the record.`);
    process.exit(1);
  }
  if (lost.length) console.error(`--allow-removals: dropping ${lost.join(', ')}`);
}

if (process.argv.includes('--print')) {
  process.stdout.write(sql);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, sql, 'utf8');
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

// To stderr, not stdout: `pg-schema.mjs --print > schema.sql` writes the SQL to
// stdout, and a summary line mixed into it makes the file unloadable.
console.error(`tables ${tables.length}  rls ${rlsCovered.length}  identity ${rlsIdentity.length}  reference ${rlsReference.length}  unscoped ${rlsNone.length}`);
if (rlsNone.length) console.error('UNSCOPED TABLES:', rlsNone.join(', '));
if (typeCorrections.length) {
  console.error(`
${typeCorrections.length} type(s) corrected from the column default:`);
  for (const c of typeCorrections) console.error('  -', c);
}
// Здогад за іменем — числом, щоб він не мовчав (Д65). Це число має СПАДАТИ:
// кожна нова булева колонка оголошується BOOLEAN у db.ts, а не сподівається
// на своє імʼя. `settles_to_debtor` не сподобалось візерунку і мовчки стало
// числом — два червоних прогони CI.
if (boolByName.length) {
  console.error(`
${boolByName.length} boolean(s) inferred from the column NAME, not declared:`);
  console.error('  оголосіть BOOLEAN у src/lib/db.ts — імʼя не тип (Д65)');
  if (process.env.PG_SCHEMA_LIST_GUESSED) for (const c of boolByName) console.error('  -', c);
}
// Deduplicated: scopeOf runs once per table that references this one, so a
// single finding was printed eight times and the list read like a disaster.
const uniqueNotes = [...new Set(notes)];
if (uniqueNotes.length) {
  console.error(`\n${uniqueNotes.length} thing(s) needing a human:`);
  for (const n of uniqueNotes) console.error('  -', n);
}
db.close();
