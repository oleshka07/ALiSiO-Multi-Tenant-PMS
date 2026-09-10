/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'path';
import fs from 'fs';
import { createRequire } from 'node:module';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
// Один список на всіх: план рахунків і бізнес-юніти. Імпорт відносний і з
// розширенням — цей файл вантажать і збірка, і голий node (`check-bare-node`).
// Два списки (тут і в сівачі) розійшлися б, і другий готель отримав би
// довідник, якого немає в першого — саме той клас, що INC-025.
import {
  CHART_OF_ACCOUNTS as CHART_OF_ACCOUNTS_SEED,
  BUSINESS_UNITS as BUSINESS_UNITS_SEED,
  AXIS_BY_STD_GROUP as AXIS_BY_STD_GROUP_SEED,
} from '../core/chart-of-accounts.ts';

// Database file path — the project's /data directory, unless told otherwise.
// The override exists so scripts/check-fresh-schema.mjs can boot the app
// against an empty directory and compare the schema a NEW customer gets with
// the one this database has. Nothing checked that before, and the two had
// silently drifted.
const DATA_DIR = process.env.ALISIO_DATA_DIR
  ? path.resolve(process.env.ALISIO_DATA_DIR)
  : path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'alisio.db');

// EUR conversion rate
export const CZK_TO_EUR = 23.5;

let db: any = null;

// Force re-initialization (for migrations after hot-reload)
export function _resetDb() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }
  db = null;
}

export function getDb(): any {
  if (db) return db;

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Two loaders on purpose. Under Next the bare require is what webpack
  // rewrites to its BUNDLED copy — the standalone image ships no
  // node_modules/better-sqlite3 at all, so a real filesystem require there
  // finds nothing (that exact swap took beta down). Under plain node (the
  // .check.ts scripts) `require` does not exist in ESM — the catch falls
  // back to a real resolver against the project root.
  let Database: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Database = require('better-sqlite3');
  } catch {
    Database = createRequire(path.join(process.cwd(), 'package.json'))('better-sqlite3');
  }

  // The module-level `db` is assigned only AFTER the schema work succeeds.
  // It used to be assigned first — so when a migration threw, the connection
  // was already cached, every later getDb() returned it through the guard at
  // the top, and the whole app ran on a half-migrated schema with no error
  // anywhere near the cause. A failed boot must fail out loud and be retried,
  // not remembered.
  const database = new Database(DB_PATH);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  try {
    // Initialize schema if needed, then upgrade existing databases.
    initSchema(database);
    runMigrations(database);
  } catch (e) {
    try { database.close(); } catch { /* already broken */ }
    throw e;
  }

  db = database;

  // Background ticks, lazily loaded so getDb() does not drag in IMAP/HTTP
  // machinery. These MUST use dynamic import(), not require(): under Turbopack
  // a require() of these modules yielded a namespace without the exported
  // function, which silently killed the bank- and receipt-inbox pollers
  // ("runBankInboxTickIfDue is not a function") for as long as they existed.
  // Fire-and-forget by design — a failing tick must never block getDb().
  const tick = (label: string, load: () => Promise<any>, fn: string) => {
    load()
      .then((m) => m[fn]?.(db))
      .catch((e: any) => console.log(`[${label}] tick-if-due error:`, e.message));
  };

  // PR #8: run recurring templates if 24h has elapsed since last tick.
  // Relative, not '@/modules/...': this file also loads under plain node (the
  // check scripts, scripts/*.mjs), where the alias does not exist and the tick
  // failed on every boot with "Cannot find package '@/modules'".
  tick('Recurring', () => import('../modules/finance/data/recurring-engine.ts'), 'runRecurringTickIfDue');

  return db;
}

function initSchema(database: any) {
  // Check if tables exist
  const tableExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='organizations'"
  ).get();

  if (tableExists) return; // Already initialized

  // All-or-nothing. Without the transaction, a failure part-way through leaves
  // the tables created but the seed incomplete — and because the guard above
  // only looks for `organizations`, every later call returns early and the
  // half-provisioned database is never repaired. SQLite makes DDL transactional,
  // so a rollback here really does undo the CREATE TABLEs.
  database.transaction(() => buildSchema(database))();
}

function buildSchema(database: any) {
  // ─── Create all tables ──────────────────────────────────
  database.exec(`
    -- Organizations
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Europe/Prague',
      default_currency TEXT NOT NULL DEFAULT 'CZK',
      pricing_advanced INTEGER NOT NULL DEFAULT 0,
      -- The hotel's base language: what its staff see, and the language its
      -- people type content in — so also the source for translating that
      -- content to guests. See core/i18n/languages.ts.
      language TEXT NOT NULL DEFAULT 'uk',
      -- Вікові вилки дітей (Блок 2 крок 3, Ц30, 0070): JSON-список меж,
      -- '[3, 12]' → 0–2, 3–11, 12–17; дорослий від 18. '[]' — одна вилка 0–17.
      child_age_bands TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Properties
    CREATE TABLE properties (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      address TEXT,
      city TEXT,
      -- Без DEFAULT навмисно: із цієї колонки виводиться ЮРИСДИКЦІЯ документа,
      -- і вона перебиває мову організації. «CZ» за замовчуванням давало
      -- німецькому готелю чеську фактуру в кронах — див. міграцію 0036.
      country TEXT,
      phone TEXT,
      email TEXT,
      check_in_time TEXT NOT NULL DEFAULT '15:00',
      city_tax_per_night REAL NOT NULL DEFAULT 0,
      check_out_time TEXT NOT NULL DEFAULT '10:00',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      -- Блок 4 (0091): що робить виселення з несплаченим залишком —
      -- нічого, попереджає або відмовляє (Hoteliera General settings).
      -- І тут, і в ALTER нижче (AGENTS §4). CHECK лише тут: SQLite не
      -- додає обмеження через ALTER; писач звіряє значення сам.
      checkout_balance_policy TEXT NOT NULL DEFAULT 'warning'
        CHECK (checkout_balance_policy IN ('none', 'warning', 'blocking')),
      -- Що це за житло: готель, апартаменти, гостьовий дім, хостел…
      -- БЕЗ DEFAULT навмисно, і це не забудькуватість. Вендор каналу пише
      -- прямо: property_type «affects billing», а для готелю на 1-15 номерів
      -- «hotel» неправдиве частіше, ніж правдиве. Мовчазний дефолт тут — це
      -- чужий рахунок, виставлений за нашим припущенням; тому колонка
      -- порожня, поки готель не назве себе сам, а каталог без неї відмовляє
      -- (інваріант 20: значення належить готелю, не константі в коді).
      -- І тут, і в ALTER нижче (AGENTS §4).
      property_type TEXT,
      UNIQUE(organization_id, slug)
    );

    -- Categories
    CREATE TABLE categories (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      icon TEXT,
      color TEXT,
      show_in_tasks INTEGER NOT NULL DEFAULT 1,
      show_in_finance INTEGER NOT NULL DEFAULT 0,
      show_in_booking INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Будов тут немає навмисно. Окрема таблиця з CRUD, двома FK і власним
    -- типом iCal-каналу існувала заради корпусу «F» одного клієнта, а корпус
    -- чи крило готель називає текстом у units.zone, який друкує сам, і
    -- календар однаково групував по building_name АБО zone одним виразом.
    -- Прибрано міграцією 0044.

    -- Unit Types
    CREATE TABLE unit_types (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT,
      max_adults INTEGER NOT NULL DEFAULT 2,
      max_children INTEGER NOT NULL DEFAULT 2,
      max_occupancy INTEGER NOT NULL DEFAULT 4,
      base_occupancy INTEGER NOT NULL DEFAULT 2,
      beds_single INTEGER NOT NULL DEFAULT 0,
      beds_double INTEGER NOT NULL DEFAULT 1,
      beds_sofa INTEGER NOT NULL DEFAULT 0,
      extra_bed_available INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      photos TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Units
    CREATE TABLE units (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      unit_type_id TEXT NOT NULL REFERENCES unit_types(id) ON DELETE CASCADE,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      floor INTEGER,
      zone TEXT,
      beds INTEGER NOT NULL DEFAULT 2,
      room_status TEXT NOT NULL DEFAULT 'available' CHECK (room_status IN ('available', 'occupied', 'maintenance', 'blocked')),
      cleaning_status TEXT NOT NULL DEFAULT 'clean' CHECK (cleaning_status IN ('clean', 'dirty', 'in_progress')),
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      -- Блок 5a (0110): вид із вікна ЦЬОГО номера — вільним текстом, бо
      -- «на липу» коду не має; стандартизований вид для OTA — зручність типу
      -- з категорії VIEW. Мережа й пароль — рівень номера над рівнями типу і
      -- обʼєкта: в апарт-готелі мережа буває кімнатна.
      view TEXT,
      wifi_network TEXT,
      wifi_password TEXT,
      -- Virtual "staging pool" unit used by the room-allocation modal to
      -- park bookings without a real room. Hidden from regular listings.
      is_pool INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(property_id, code)
    );

    -- Rate Plans
    CREATE TABLE rate_plans (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      pricing_model TEXT NOT NULL DEFAULT 'standard',
      -- Колонки власної ціни тут немає і не буде: рішення Ц7 — ціну ночі
      -- називає лише priceNights(), точка збуту її ЗСУВАЄ відсотком. Стара
      -- 'fixed_price' не мала жодного читача й жодного писача за всю історію,
      -- а три гілки у віджеті питали її в site_rate_plans, де такої колонки
      -- ніколи не було. Тримає check-price-source.mjs (0055).
      --
      -- Ім'я в лапках навмисно: голе слово означало б колонку, і гейт
      -- відмовив би — він не вміє вирізати SQL-коментар усередині шаблонного
      -- рядка, і вчити його цьому дорожче, ніж написати ім'я так.
      currency TEXT NOT NULL DEFAULT 'CZK',
      -- Ціни дитини тут більше немає (0070, Ц30): дитина — правило в
      -- extra_occupancy_rules на тарифі, типі або на всіх; колонку
      -- child_extra_gross (0057) міграція переносить у правило й знімає.
      is_active INTEGER NOT NULL DEFAULT 1,
      -- Як тариф рахує гостей (Блок 2.2, рішення Ц26): per_room — одна ціна
      -- на номер на будь-яку кількість гостей, у менеджера каналів одна опція
      -- заселеності; per_person — своя ціна на кожну кількість дорослих з
      -- джерелом ціни. Словник закритий (docs/NAMING.md), перевіряє писач;
      -- CHECK стоїть з 05.09.2026 (0067): у новій базі — тут, у Postgres —
      -- міграцією; наявна SQLite його не дістане (ALTER ADD CHECK там немає),
      -- і читач на це готовий — невідоме читає як per_person з рядком у
      -- журналі. Без вибору — per_person: так заводились усі тарифи.
      sell_mode TEXT NOT NULL DEFAULT 'per_person' CHECK (sell_mode IN ('per_room', 'per_person')),
      cancellation_policy TEXT,
      meal_plan TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      included_services_json TEXT NOT NULL DEFAULT '[]',
      is_hidden INTEGER NOT NULL DEFAULT 0,
      -- Похідний тариф (Блок 2 крок 2, Ц28): ціна доби = ціна базового
      -- тарифу на дату ± коригування, рендериться в price_calendar рядком
      -- тарифу з source = 'derived'. Словники закриті (docs/NAMING.md);
      -- «похідний від похідного» відмовляє писач, не схема. І тут, і в ALTER
      -- нижче (AGENTS §4).
      pricing_type TEXT NOT NULL DEFAULT 'manual' CHECK (pricing_type IN ('manual', 'derived')),
      based_on_rate_plan_id TEXT REFERENCES rate_plans(id),
      adjustment_kind TEXT CHECK (adjustment_kind IN ('percent', 'fixed')),
      adjustment_value REAL,
      adjustment_direction TEXT CHECK (adjustment_direction IN ('increase', 'decrease')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(property_id, code)
    );

    -- Guests
    CREATE TABLE guests (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      country TEXT,
      city TEXT,
      address TEXT,
      document_type TEXT,
      document_number TEXT,
      date_of_birth TEXT,
      notes TEXT,
      -- Звідки цей рядок прийшов: система, таблиця, ідентифікатор у ній
      -- (INC-301, міграція 0301). Порожньо — завели в нас. Тримає повторний
      -- прогін імпорту від подвоєння, і тримає це UNIQUE-індекс, а не цикл.
      external_ref TEXT,
      -- Хто злив і коли (INC-304, міграція 0302). Колонками, а не журналом:
      -- це факт САМОГО рядка, буває рівно раз, і окремий журнал розділив би
      -- одну правду на два місця, які розходяться при першій же чистці.
      merged_at TEXT,
      merged_by TEXT,
      -- Кого лишили, коли цей рядок злили дублікатом (INC-300, міграція 0300).
      -- Рядок злитого гостя НЕ ВИДАЛЯЄТЬСЯ: посилання на нього лежать у
      -- виданих документах і в чужих системах, і «такого гостя немає» — гірша
      -- відповідь, ніж «це та сама людина». Ланцюгів не буває: злиття
      -- перенацілює старі посилання, тож це завжди один крок до живого.
      merged_into TEXT REFERENCES guests(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Списки гостей питають «живі, тобто не злиті» на кожному екрані.
    CREATE INDEX IF NOT EXISTS idx_guests_merged_into
      ON guests (organization_id) WHERE merged_into IS NULL;

    -- Унікальність включає орендаря: ADRESSEN.LNR = 1 є в кожній базі
    -- Winhotel, тож тотальний індекс зробив би неможливим імпорт другого
    -- готелю. Предикат — щоб гості без походження (їх більшість) не
    -- конфліктували між собою.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_external_ref
      ON guests (organization_id, external_ref) WHERE external_ref IS NOT NULL;

    -- «Це різні люди» — рішення, яке мусить памʼятатись (INC-304, 0302).
    --
    -- Пара, а не напрямок: злиття має бік, відмова — ні. Порядок тримає
    -- CHECK, а не домовленість у коді: інакше в таблиці зʼявились би (A,B) і
    -- (B,A) як дві різні відмови, і шукач, що питає одну форму, показав би
    -- пару, яку вже відхилили.
    CREATE TABLE guest_not_duplicates (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      guest_low_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      guest_high_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      decided_by TEXT,
      decided_at TEXT NOT NULL DEFAULT (datetime('now')),
      note TEXT,
      CHECK (guest_low_id < guest_high_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_not_duplicates_pair
      ON guest_not_duplicates (organization_id, guest_low_id, guest_high_id);
    CREATE INDEX IF NOT EXISTS idx_guest_not_duplicates_org
      ON guest_not_duplicates (organization_id);

    -- Згоди GDPR живуть на ОСОБІ й переживають бронь (INC-300, міграція 0300).
    --
    -- Колонки consent_* у guest_registrations лишаються і значать ІНШЕ: згоду на
    -- ЦЬОМУ перебуванні, частину Meldeschein. Ця пара таблиць — про особу:
    -- «цій людині можна слати листи», і воно переживає всі її брони, включно
    -- з нульом броней. Через місяць вони виглядатимуть як дублікати одне
    -- одного — не зливайте: перше зруйнує Meldeschein, друге — доказ згоди.
    CREATE TABLE consent_texts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      consent_kind TEXT NOT NULL,
      version TEXT NOT NULL,
      locale TEXT NOT NULL,
      body TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Версію обирає людина, тож унікальність включає організацію (інваріант 3).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_texts_org_kind_version
      ON consent_texts (organization_id, consent_kind, version, locale);
    CREATE INDEX IF NOT EXISTS idx_consent_texts_org ON consent_texts (organization_id);

    -- Журнал згод особи. Колонка revoked_at замість видалення рядка: наглядачеві
    -- показують «згода була і її відкликали тоді-то», а рядка, якого немає,
    -- не досить в ОБИДВА боки.
    CREATE TABLE guest_consents (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      consent_kind TEXT NOT NULL,
      version TEXT NOT NULL,
      source TEXT NOT NULL,
      given_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_guest_consents_org ON guest_consents (organization_id);
    CREATE INDEX IF NOT EXISTS idx_guest_consents_guest
      ON guest_consents (organization_id, guest_id, consent_kind);

    -- Reservations
    CREATE TABLE reservations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT REFERENCES organizations(id),
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      -- NULL = номер ще не призначено (CP3). Жодних бектиків у коментарях
      -- цього блоку: уся схема — один шаблонний рядок JS, і бектик навколо
      -- імені колонки обриває його. Це вже ламало збірку двічі.
      --
      -- Channex про units не знає нічого — він адресує ТИП номера, тож
      -- бронь з OTA приходить без кімнати, і рецепція призначає її потім.
      --
      -- Обʼєкт (property_id) при цьому лишається NOT NULL: він відомий
      -- завжди і саме через нього бронь досягає орендаря. Nullable там був
      -- би дірою в ізоляції, а не гнучкістю.
      --
      -- Читачі переведені на LEFT JOIN ДО цієї зміни, окремим комітом:
      -- INNER JOIN на NULL не падає, він фільтрує, і бронь мовчки зникла б
      -- зі списків. Тримає check-unit-join.mjs.
      unit_id TEXT REFERENCES units(id),
      -- Which category was sold, as opposed to which room it landed in.
      -- Nullable: every reservation made at the desk has a room from the
      -- start, and only a booking arriving from a channel knows the type
      -- before it knows the room. Nothing assigns the room automatically yet
      -- — that is phase 5 and a product decision of its own.
      unit_type_id TEXT REFERENCES unit_types(id),
      guest_id TEXT NOT NULL REFERENCES guests(id),
      rate_plan_id TEXT REFERENCES rate_plans(id),
      -- company_id (0093) тут НЕМАЄ навмисно: таблиця companies народжується
      -- в runMigrations, а засів (seedData) пише в reservations раніше — з
      -- FK на ще не створену таблицю перший INSERT падає «no such table».
      -- Колонка додається ALTER-ом у блоці 0093, як і решта пізніших колонок
      -- цієї таблиці (invoice_company_*, registration_status …).
      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      nights INTEGER NOT NULL DEFAULT 1,
      adults INTEGER NOT NULL DEFAULT 1,
      children INTEGER NOT NULL DEFAULT 0,
      infants INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft', 'tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
      payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'payment_requested', 'partial', 'prepaid', 'paid')),
      source TEXT NOT NULL DEFAULT 'direct' CHECK (source IN ('direct', 'phone', 'whatsapp', 'booking_com', 'airbnb', 'other_ota')),
      total_price REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CZK',
      notes TEXT,
      internal_notes TEXT,
      -- Копія units.is_pool на самій броні (INC-045, міграція 0133).
      --
      -- На Postgres подвійне бронювання забороняє EXCLUDE USING gist, а він не
      -- вміє джойнитись — тож ознака службового фонду мусить лежати колонкою
      -- ТУТ, інакше обмеження зробило б кемпінг непродаваним. На SQLite
      -- обмеження немає й колонку ніхто не читає; вона тут лише тому, що
      -- db/postgres/schema.sql генерується з ЦІЄЇ схеми, і без неї свіжий
      -- Postgres-клієнт отримав би колонку не зі schema.sql, а лише з ALTER-у
      -- в 0133 — рівно та розбіжність, про яку AGENTS §4 каже про індекси.
      is_pool_unit INTEGER NOT NULL DEFAULT 0,
      -- Походження імпорту (INC-301). Окремо від external_uid: те поле
      -- ділять iCal-синк і канали, воно навмисно не ключ, і класти туди ще
      -- й імпорт означало б, що «звідки ця бронь» відповідає той, хто
      -- записав останнім.
      external_ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Payments
    CREATE TABLE payments (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CZK',
      method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'invoice', 'online', 'booking_platform')),
      type TEXT NOT NULL CHECK (type IN ('deposit', 'full', 'partial', 'refund', 'service')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
      paid_at TEXT,
      notes TEXT,
      auto_created INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Fees & Taxes
    --
    -- No backticks below: this whole schema is one JS template literal, and a
    -- backtick around a column name would end the string. (It did, once.)
    --
    -- "type" is the multiplier — how the amount is spread over nights and
    -- guests. applies_to and collected_for answer two different questions the
    -- multiplier alone cannot:
    --
    --   applies_to    — WHO is counted. Many jurisdictions exempt children
    --                   from the tourist levy; that is an exemption rule, not
    --                   a different meaning of the word "person" (see the
    --                   header of modules/pricing/domain/fees.ts).
    --   collected_for — WHOSE money it is. 'property' = the hotel sells it
    --                   (cleaning, breakfast) and it is ordinary revenue;
    --                   'authority' = the hotel collects it for a public body
    --                   and passes it on (city tax, Kurtaxe, турзбір).
    --
    -- collected_for is deliberately jurisdiction-neutral: it says what kind
    -- of money this is, never how one country's receipt must show it. The
    -- country-specific reading — Ukraine's non-VAT line 11, Germany's
    -- durchlaufender Posten — belongs to the fiscal module for that country
    -- (AGENTS.md invariant 22).
    CREATE TABLE fees_taxes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('per_night', 'per_stay', 'per_person', 'per_person_per_night', 'percentage')),
      amount REAL NOT NULL DEFAULT 0,
      applies_to TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'adults')),
      collected_for TEXT NOT NULL DEFAULT 'property' CHECK (collected_for IN ('property', 'authority')),
      is_included_in_price INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- App Users
    CREATE TABLE app_users (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      password_hash TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'receptionist' CHECK (role IN ('owner', 'director', 'manager', 'receptionist', 'housekeeper', 'maintenance', 'accountant')),
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login TEXT,
      -- One person's override. NULL means "whatever the hotel uses", which is
      -- what almost everyone wants — and it keeps following the hotel if the
      -- hotel later changes its mind.
      language TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Sessions
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Per-user permission overrides
    CREATE TABLE user_permissions (
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, permission)
    );

    -- Audit Log
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES app_users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      old_values TEXT,
      new_values TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX idx_units_property ON units(property_id);
    CREATE INDEX idx_units_category ON units(category_id);
    CREATE INDEX idx_units_unit_type ON units(unit_type_id);
    CREATE INDEX idx_reservations_property ON reservations(property_id);
    CREATE INDEX idx_reservations_unit ON reservations(unit_id);
    CREATE INDEX idx_reservations_guest ON reservations(guest_id);
    CREATE INDEX idx_reservations_dates ON reservations(check_in, check_out);
    CREATE INDEX idx_reservations_status ON reservations(status);
    CREATE INDEX idx_guests_org ON guests(organization_id);
    CREATE INDEX idx_guests_name ON guests(last_name, first_name);
  `);

  // ─── Tables that used to be created as a side effect ──────────────────
  // availability_blocks is read by the public booking widget, yet it was only
  // ever created by the Hostex bootstrap — so a tenant not using Hostex got
  // "no such table" and could not take bookings. email_processed was written by
  // the CRM mail poller but created nowhere at all. Central schema owns them
  // now; integrations may write rows but must never create tables.
  database.exec(`
    CREATE TABLE IF NOT EXISTS availability_blocks (
      id TEXT PRIMARY KEY,
      unit_id TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      reason TEXT DEFAULT 'blocked',
      notes TEXT,
      hostex_code TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_processed (
      message_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_availability_blocks_unit ON availability_blocks(unit_id, date_from, date_to);
  `);

  // ─── Seed initial data ────────────────────────────────
  //
  // Demo data — a sample hotel, twenty bookings and an owner account — is for
  // local evaluation. In production it is refused unless the operator names a
  // password: a fresh production database used to come up with a known owner
  // login, and that account sat on a public domain until somebody noticed.
  //
  // A production instance is populated with scripts/provision-org.mjs, which
  // creates a real customer and prints a generated password once.
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !process.env.SEED_ADMIN_PASSWORD) {
    console.warn(
      '[Seed] Production database created empty — demo data is not seeded without ' +
      'SEED_ADMIN_PASSWORD. Create the first customer with ' +
      'node scripts/provision-org.mjs --name … --slug … --email …',
    );
    return;
  }
  seedData(database);
}

// Migrate existing databases — add new columns safely
function runMigrations(database: any) {
  // --- Finance PR #6: check if we have migrated to unified fin_operations ---
  // Used below to guard legacy table re-creation after DROP in migration block.
  const finOpsMigrated = !!database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='fin_operations'"
  ).get();

  // --- Check if app_users needs role migration ---
  // The probe must reference a real organization: app_users.organization_id is a
  // foreign key and `foreign_keys` is ON, so a hardcoded id that does not exist
  // in this database fails for the wrong reason and drops us into the rebuild
  // branch below — which recreates app_users WITHOUT password_hash (see the
  // re-insert further down) and drops audit_log outright.
  //
  // ЦЕЙ `LIMIT 1` ЗАКОННИЙ, і це сказано прямо, щоб наступний не взяв його за
  // зразок (INC-028, п.4). Решта чотирьох копій того самого рядка сіяли ДАНІ
  // конкретному орендареві — і саме тому були вадою: «перший, хто трапився»
  // не є відповіддю на питання «чий це рядок» (інваріант 1).
  //
  // Тут питання інше й не про орендаря взагалі: чи приймає CHECK на
  // `app_users.role` нинішній перелік ролей. Це властивість СХЕМИ, однакова
  // для всієї бази; організація потрібна лише як будь-який дійсний
  // зовнішній ключ, щоб пробний `INSERT` не впав з іншої причини. Рядок
  // одразу видаляється, нічого нікому не належить.
  //
  // Ознака, за якою відрізняти: якщо від вибору організації залежить, ЧИЇ
  // дані зʼявляться в базі, — `LIMIT 1` заборонений. Якщо результат той
  // самий для будь-якої — це проба, і вона законна.
  const probeOrg = database.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined;
  let roleCheckIsCurrent = true;
  if (probeOrg) {
    try {
      // SQLite CHECK only fires on INSERT/UPDATE, not SELECT.
      database
        .prepare("INSERT INTO app_users (id, organization_id, email, full_name, role) VALUES ('__role_test__', ?, '__test__', '__test__', 'owner')")
        .run(probeOrg.id);
      database.prepare("DELETE FROM app_users WHERE id = '__role_test__'").run();
    } catch {
      roleCheckIsCurrent = false;
    }
  }
  if (!roleCheckIsCurrent) {
    // CHECK constraint is old — need to recreate app_users table
    console.log('[DB] Migrating app_users table to new role system');
    try {
      const existingUsers = database.prepare('SELECT * FROM app_users').all();
      database.exec('DROP TABLE IF EXISTS audit_log'); // depends on app_users
      database.exec('DROP TABLE IF EXISTS app_users');
      database.exec(`
        CREATE TABLE app_users (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          full_name TEXT NOT NULL,
          phone TEXT,
          password_hash TEXT,
          avatar_url TEXT,
          role TEXT NOT NULL DEFAULT 'receptionist' CHECK (role IN ('owner', 'director', 'manager', 'receptionist', 'housekeeper', 'maintenance', 'accountant')),
          is_active INTEGER NOT NULL DEFAULT 1,
          last_login TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      database.exec(`
        CREATE TABLE audit_log (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id TEXT REFERENCES app_users(id),
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          old_values TEXT,
          new_values TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      // Re-insert with role mapping. password_hash must be carried over —
      // omitting it silently locks every existing user out of the system.
      const ins = database.prepare('INSERT INTO app_users (id, organization_id, email, full_name, password_hash, role, is_active, last_login, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
      for (const u of existingUsers as any[]) {
        let newRole = u.role;
        if (newRole === 'admin') newRole = 'owner';
        if (newRole === 'operator') newRole = 'receptionist';
        ins.run(u.id, u.organization_id, u.email, u.full_name, u.password_hash ?? null, newRole, u.is_active, u.last_login, u.created_at, u.updated_at);
      }
      console.log('[DB] app_users table migrated successfully');
    } catch (e: any) {
      console.error('[DB] app_users migration error:', e.message);
    }
  }

  // --- Migration: add new columns if missing ---
  try {
    const userCols = database.prepare("PRAGMA table_info(app_users)").all() as { name: string }[];
    const hasPasswordHash = userCols.some((c: any) => c.name === 'password_hash');
    if (!hasPasswordHash) {
      database.exec("ALTER TABLE app_users ADD COLUMN password_hash TEXT");
      database.exec("ALTER TABLE app_users ADD COLUMN phone TEXT");
      database.exec("ALTER TABLE app_users ADD COLUMN avatar_url TEXT");
      console.log('[DB] Added password_hash, phone, avatar_url to app_users');
    }
  } catch (e: any) {
    console.log('[DB] columns migration note:', e.message);
  }

  // --- One address, one account per hotel ---
  //
  // `app_users.email` carried no UNIQUE in either schema, and `login` looks a
  // person up by email alone (it has nothing else to go on). It read ONE row,
  // with no ORDER BY, and always the same one — so a second account with the
  // same address could never be signed into, with a correct password and no
  // message saying why.
  //
  // Per hotel, not per server: one person really can own two hotels, and on
  // prod one does. The half that makes this work is in login.handlers.ts —
  // the password is checked against every row with that address, and when more
  // than one matches, the form asks which hotel. Без цього індекс дозволив би
  // другий рядок, у який так само не можна увійти.
  try {
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_org_email ON app_users (organization_id, lower(email))');
  } catch (e: any) {
    // Two rows with one address inside ONE hotel is a data error, and naming
    // it is the useful thing to do — deciding which of the pair is the real
    // one is not something a boot script should do quietly.
    const dupes = database.prepare(
      'SELECT organization_id, lower(email) AS email, COUNT(*) AS n FROM app_users GROUP BY organization_id, lower(email) HAVING n > 1'
    ).all() as { organization_id: string; email: string; n: number }[];
    console.warn(
      `[DB] ⚠️ app_users: одна адреса двічі в одному готелі: ${dupes.map((d) => `${d.email} @ ${d.organization_id} ×${d.n}`).join(', ') || e.message}. ` +
      'Другий такий акаунт не зможе увійти. Приберіть зайвий рядок, і індекс створиться при наступному старті.');
  }

  // --- Migration: set secure random password for users without one ---
  try {
    const usersWithoutPw: any[] = database.prepare(
      "SELECT id FROM app_users WHERE password_hash IS NULL OR password_hash = ''"
    ).all();
    if (usersWithoutPw.length > 0) {
      const randomPw = crypto.randomBytes(16).toString('hex');
      const hash = bcrypt.hashSync(randomPw, 10);
      const stmt = database.prepare('UPDATE app_users SET password_hash = ? WHERE id = ?');
      for (const u of usersWithoutPw) {
        stmt.run(hash, u.id);
      }
      console.warn(`[DB] ⚠️ Set random password for ${usersWithoutPw.length} user(s). Reset passwords manually via admin panel.`);
    }
  } catch (e: any) {
    console.log('[DB] password hash note:', e.message);
  }

  // --- Migration: add default_cash_account_id to app_users ---
  // Each admin can have their own cash account so that when they record
  // a cash payment from a booking, it goes to their register, not the
  // first one in sort order (which happens to be Олег's).
  try {
    const userCols2 = database.prepare("PRAGMA table_info(app_users)").all() as { name: string }[];
    if (!userCols2.some((c: any) => c.name === 'default_cash_account_id')) {
      database.exec("ALTER TABLE app_users ADD COLUMN default_cash_account_id TEXT REFERENCES finance_accounts(id)");
      console.log('[DB] Added default_cash_account_id to app_users');
    }

    // Backfill: runs every startup for users with NULL default_cash_account_id.
    // Safe to re-run — only updates rows where the column is still NULL.
    const NAME_TO_ACCOUNT: Record<string, string> = {
      'Андрій': 'Андріїв cash',
      'Андрей': 'Андріїв cash',
      'Andrii': 'Андріїв cash',
      'Andrey': 'Андріїв cash',
      'Олег':  'Олег наличные',
      'Oleg':  'Олег наличные',
      'Наталія': 'Каса Кемпінг і проживання',
      'Наташа': 'Каса Кемпінг і проживання',
      'Natasha': 'Каса Кемпінг і проживання',
      'Nataly': 'Каса Кемпінг і проживання',
      'Антон': 'Антон Готівка',
      'Anton': 'Антон Готівка',
    };
    const usersToBackfill = database.prepare(
      'SELECT id, full_name, organization_id FROM app_users WHERE default_cash_account_id IS NULL'
    ).all() as any[];
    for (const u of usersToBackfill) {
      for (const [namePart, acctName] of Object.entries(NAME_TO_ACCOUNT)) {
        if (u.full_name && u.full_name.includes(namePart)) {
          const acct = database.prepare(
            "SELECT id FROM finance_accounts WHERE organization_id = ? AND name = ? AND is_active = 1 LIMIT 1"
          ).get(u.organization_id, acctName) as any;
          if (acct) {
            database.prepare('UPDATE app_users SET default_cash_account_id = ? WHERE id = ?').run(acct.id, u.id);
            console.log(`[DB] Mapped ${u.full_name} → ${acctName} (${acct.id})`);
          }
          break;
        }
      }
    }
  } catch (e: any) {
    console.log('[DB] default_cash_account_id migration:', e.message);
  }

  // --- Migration: create sessions table if not exists ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // --- Finance security: opt-in step-up passphrase ---------------------------
  // Second password protecting the finance module. Stored as a bcrypt hash plus
  // a KDF salt reserved for at-rest encryption (future phase). Per-session unlock
  // state lives in sessions.finance_unlocked_until.
  database.exec(`
    CREATE TABLE IF NOT EXISTS finance_security (
      user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      passphrase_hash TEXT NOT NULL,
      kdf_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  try {
    const sessCols = database.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    if (!sessCols.some((c: any) => c.name === 'finance_unlocked_until')) {
      database.exec("ALTER TABLE sessions ADD COLUMN finance_unlocked_until TEXT");
      console.log('[DB] Added finance_unlocked_until to sessions');
    }
  } catch (e: any) {
    console.log('[DB] finance_unlocked_until migration note:', e.message);
  }

  // --- Migration: create user_permissions table if not exists ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, permission)
    )
  `);

  // --- Migration: create booking_sources table if not exists ---
  const bsExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='booking_sources'"
  ).get();
  if (!bsExists) {
    console.log('[DB] Creating booking_sources table');
    database.exec(`
      CREATE TABLE booking_sources (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        icon_letter TEXT NOT NULL DEFAULT '?',
        color TEXT NOT NULL DEFAULT '#6c7086',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Seed default sources
    const propRow = database.prepare("SELECT id FROM properties LIMIT 1").get() as any;
    if (propRow) {
      const ins = database.prepare('INSERT INTO booking_sources (id, property_id, name, code, icon_letter, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
      ins.run('bs_direct', propRow.id, 'Direct', 'direct', 'D', '#22c55e', 1);
      ins.run('bs_phone', propRow.id, 'Phone', 'phone', '📞', '#3b82f6', 2);
      ins.run('bs_whatsapp', propRow.id, 'WhatsApp', 'whatsapp', 'W', '#25D366', 3);
      ins.run('bs_booking_com', propRow.id, 'Booking.com', 'booking_com', 'B', '#003580', 4);
      ins.run('bs_airbnb', propRow.id, 'Airbnb', 'airbnb', 'A', '#FF5A5F', 5);
      ins.run('bs_other_ota', propRow.id, 'Other OTA', 'other_ota', 'O', '#f59e0b', 6);
      console.log('[DB] Seeded 6 default booking sources');
    }
  }

  // --- Migration: remove CHECK constraint from reservations.source ---
  // Check if reservations table still has the old CHECK constraint
  try {
    const createSql = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='reservations'"
    ).get() as any;
    if (createSql?.sql && createSql.sql.includes("CHECK (source IN")) {
      console.log('[DB] Removing CHECK constraint from reservations.source');
      const rows = database.prepare('SELECT * FROM reservations').all();
      database.exec('DROP TABLE reservations');
      database.exec(`
        CREATE TABLE reservations (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
          -- Nullable і тут: ця перебудова знімає CHECK із source, але вона
          -- ПЕРЕСТВОРЮЄ таблицю, тож лишити тут NOT NULL означало б
          -- повернути його на кожній базі, яка через цю гілку проходить.
          -- (Без бектиків — це шаблонний рядок, див. коментар у CREATE.)
          unit_id TEXT REFERENCES units(id),
          guest_id TEXT NOT NULL REFERENCES guests(id),
          rate_plan_id TEXT REFERENCES rate_plans(id),
          check_in TEXT NOT NULL,
          check_out TEXT NOT NULL,
          nights INTEGER NOT NULL DEFAULT 1,
          adults INTEGER NOT NULL DEFAULT 1,
          children INTEGER NOT NULL DEFAULT 0,
          infants INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft', 'tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
          payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'payment_requested', 'partial', 'prepaid', 'paid')),
          source TEXT NOT NULL DEFAULT 'direct',
          total_price REAL NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'CZK',
          notes TEXT,
          internal_notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      // Restore data
      const insR = database.prepare('INSERT INTO reservations (id, property_id, unit_id, guest_id, rate_plan_id, check_in, check_out, nights, adults, children, infants, status, payment_status, source, total_price, currency, notes, internal_notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const r of rows as any[]) {
        insR.run(r.id, r.property_id, r.unit_id, r.guest_id, r.rate_plan_id, r.check_in, r.check_out, r.nights, r.adults, r.children, r.infants, r.status, r.payment_status, r.source, r.total_price, r.currency, r.notes, r.internal_notes, r.created_at, r.updated_at);
      }
      // Recreate indexes
      database.exec('CREATE INDEX IF NOT EXISTS idx_reservations_property ON reservations(property_id)');
      database.exec('CREATE INDEX IF NOT EXISTS idx_reservations_unit ON reservations(unit_id)');
      database.exec('CREATE INDEX IF NOT EXISTS idx_reservations_guest ON reservations(guest_id)');
      database.exec('CREATE INDEX IF NOT EXISTS idx_reservations_dates ON reservations(check_in, check_out)');
      database.exec('CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status)');
      console.log('[DB] reservations table migrated (source CHECK removed)');
    }
  } catch (e: any) {
    console.error('[DB] reservations migration error:', e.message);
  }

  // --- Migration: add commission_percent to booking_sources ---
  try {
    const bsCols = database.prepare("PRAGMA table_info(booking_sources)").all() as { name: string }[];
    if (!bsCols.some((c: any) => c.name === 'commission_percent')) {
      database.exec("ALTER TABLE booking_sources ADD COLUMN commission_percent REAL NOT NULL DEFAULT 0");
      // Set default commissions for known OTAs
      database.exec("UPDATE booking_sources SET commission_percent = 15 WHERE code = 'booking_com'");
      database.exec("UPDATE booking_sources SET commission_percent = 15 WHERE code = 'airbnb'");
      database.exec("UPDATE booking_sources SET commission_percent = 10 WHERE code = 'other_ota'");
      console.log('[DB] Added commission_percent to booking_sources');
    }
  } catch (e: any) {
    console.log('[DB] commission_percent migration note:', e.message);
  }

  // --- Migration: add commission_amount to reservations ---
  try {
    const resCols2 = database.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
    if (!resCols2.some((c: any) => c.name === 'commission_amount')) {
      database.exec("ALTER TABLE reservations ADD COLUMN commission_amount REAL NOT NULL DEFAULT 0");
      console.log('[DB] Added commission_amount to reservations');
    }
  } catch (e: any) {
    console.log('[DB] commission_amount migration note:', e.message);
  }

  // --- Migration: add guest_page_token to reservations ---
  try {
    const resCols3 = database.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
    if (!resCols3.some((c: any) => c.name === 'guest_page_token')) {
      database.exec("ALTER TABLE reservations ADD COLUMN guest_page_token TEXT");
      database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_guest_token ON reservations(guest_page_token)");
      // Generate tokens for existing confirmed/checked_in bookings
      const existing = database.prepare("SELECT id FROM reservations WHERE status IN ('confirmed', 'checked_in') AND (guest_page_token IS NULL OR guest_page_token = '')").all() as any[];
      if (existing.length > 0) {
        const upd = database.prepare("UPDATE reservations SET guest_page_token = ? WHERE id = ?");
        for (const r of existing) {
          const token = generateGuestToken();
          upd.run(token, r.id);
        }
        console.log(`[DB] Generated guest_page_token for ${existing.length} existing booking(s)`);
      }
      console.log('[DB] Added guest_page_token to reservations');
    }
  } catch (e: any) {
    console.log('[DB] guest_page_token migration note:', e.message);
  }

  // --- Migration: create reservation_guests table (for check-in registration) ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS reservation_guests (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      date_of_birth TEXT,
      address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // --- Migration: add photos column to unit_types ---
  try {
    const utCols = database.prepare("PRAGMA table_info(unit_types)").all() as { name: string }[];
    if (!utCols.some((c: any) => c.name === 'photos')) {
      database.exec("ALTER TABLE unit_types ADD COLUMN photos TEXT");
      console.log('[DB] Added photos column to unit_types');
    }
  } catch (e: any) {
    console.log('[DB] unit_types photos migration note:', e.message);
  }

  // --- Migration: add photos column to site_listings ---
  try {
    const slCols = database.prepare("PRAGMA table_info(site_listings)").all() as { name: string }[];
    if (!slCols.some((c: any) => c.name === 'photos')) {
      database.exec("ALTER TABLE site_listings ADD COLUMN photos TEXT");
      console.log('[DB] Added photos column to site_listings');
    }
  } catch (e: any) {
    console.log('[DB] site_listings photos migration note:', e.message);
  }

  // --- Migration: add document & nationality fields to reservation_guests ---
  const rgCols = database.prepare("PRAGMA table_info(reservation_guests)").all().map((c: any) => c.name);
  if (!rgCols.includes('nationality')) {
    try { database.exec("ALTER TABLE reservation_guests ADD COLUMN nationality TEXT"); } catch { /* already exists */ }
  }
  if (!rgCols.includes('document_type')) {
    try { database.exec("ALTER TABLE reservation_guests ADD COLUMN document_type TEXT"); } catch { /* already exists */ }
  }
  if (!rgCols.includes('document_number')) {
    try { database.exec("ALTER TABLE reservation_guests ADD COLUMN document_number TEXT"); } catch { /* already exists */ }
  }
  // --- Migration: add guest_id column to reservation_guests ---
  if (!rgCols.includes('guest_id')) {
    try { database.exec("ALTER TABLE reservation_guests ADD COLUMN guest_id TEXT REFERENCES guests(id)"); } catch { /* already exists */ }
  }

  // --- Migration: add reg_status and doc_photo_url to guest_registrations ---
  // reg_status tracks per-guest registration progress: not_started / draft / completed
  // doc_photo_url stores the local path to the uploaded document photo
  try {
    const grCols2 = database.prepare("PRAGMA table_info(guest_registrations)").all().map((c: any) => c.name);
    if (!grCols2.includes('reg_status')) {
      database.exec("ALTER TABLE guest_registrations ADD COLUMN reg_status TEXT NOT NULL DEFAULT 'not_started'");
      console.log('[DB] Added reg_status to guest_registrations');
    }
    if (!grCols2.includes('doc_photo_url')) {
      database.exec("ALTER TABLE guest_registrations ADD COLUMN doc_photo_url TEXT");
      console.log('[DB] Added doc_photo_url to guest_registrations');
    }
  } catch (e: any) {
    console.log('[DB] guest_registrations reg_status migration note:', e.message);
  }

  // --- Migration: add payment_id to reservations ---
  try {
    const resCols = database.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
    if (!resCols.some((c: any) => c.name === 'payment_id')) {
      database.exec("ALTER TABLE reservations ADD COLUMN payment_id TEXT");
      console.log('[DB] Added payment_id column to reservations');
    }
  } catch (e: any) {
    console.log('[DB] payment_id migration note:', e.message);
  }

  // --- Migration: create additional_services table ---
  const asExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='additional_services'"
  ).get();
  if (!asExists) {
    database.exec(`
      CREATE TABLE additional_services (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        name_en TEXT,
        description TEXT,
        price REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CZK',
        unit_label TEXT NOT NULL DEFAULT 'за послугу',
        icon TEXT,
        category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('food', 'wellness', 'sport', 'entertainment', 'other')),
        available_for TEXT NOT NULL DEFAULT 'all',
        is_active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        vat_split TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Seed default services
    const propRow = database.prepare("SELECT id FROM properties LIMIT 1").get() as any;
    if (propRow) {
      const insAS = database.prepare('INSERT INTO additional_services (id, property_id, name, name_en, description, price, unit_label, icon, category, available_for, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      // Generic sample services only. Anything specific to one property's
      // offering belongs in that tenant's own data, not in every new database.
      insAS.run('svc_breakfast', propRow.id, 'Breakfast', 'Breakfast', 'Breakfast served in the restaurant', 250, 'per person/day', '🍳', 'food', 'all', 1);
      insAS.run('svc_parking', propRow.id, 'Parking', 'Parking', 'Reserved parking space', 150, 'per day', '🅿️', 'other', 'all', 2);
      console.log('[DB] Created additional_services table with sample services');
    }
  }

  // --- Migration: create service_orders table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS service_orders (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL REFERENCES additional_services(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1,
      total_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // --- Migration: create unit_type_photos table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS unit_type_photos (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      unit_type_id TEXT NOT NULL REFERENCES unit_types(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      caption TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // --- Migration: create property_photos table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS property_photos (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      caption TEXT,
      photo_type TEXT NOT NULL DEFAULT 'common' CHECK (photo_type IN ('building', 'territory', 'common', 'aerial')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // --- Migration: create guest_page_config table ---
  const gpcExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='guest_page_config'"
  ).get();
  if (!gpcExists) {
    database.exec(`
      CREATE TABLE guest_page_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        unit_type_id TEXT NOT NULL UNIQUE REFERENCES unit_types(id) ON DELETE CASCADE,
        amenities TEXT,
        check_in_instructions TEXT,
        external_amenities TEXT,
        faq_items TEXT,
        rules TEXT,
        wifi_network TEXT,
        wifi_password TEXT,
        restaurant_name TEXT,
        restaurant_hours TEXT,
        restaurant_menu_url TEXT,
        useful_info TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // No content seeding, deliberately. This block used to write the FIRST
    // CUSTOMER'S life as "defaults" for every unit type — their town, GPS
    // pin, driving directions, shops, pet price in their currency. The same
    // family of leak as the wifi/lock-code DEFAULTs (migration 0023). An
    // empty config means the guest page shows nothing until the hotel writes
    // its own words, which is the only honest default.
    console.log('[DB] Created guest_page_config table');
  }

  // --- Migration: add lock_code, maps_url, territory_map_url to guest_page_config ---
  const gpcCols = database.prepare("PRAGMA table_info(guest_page_config)").all().map((c: any) => c.name);
  if (!gpcCols.includes('lock_code')) {
    // No default: an unset door code is EMPTY. The previous default was the
    // first customer's real lock code, born into every new database.
    try { database.exec("ALTER TABLE guest_page_config ADD COLUMN lock_code TEXT"); } catch { /* */ }
  }
  if (!gpcCols.includes('maps_url')) {
    try { database.exec("ALTER TABLE guest_page_config ADD COLUMN maps_url TEXT"); } catch { /* */ }
  }
  if (!gpcCols.includes('territory_map_url')) {
    try { database.exec("ALTER TABLE guest_page_config ADD COLUMN territory_map_url TEXT"); } catch { /* */ }
  }

  // --- Migration: add guest_page_expires_at to reservations ---
  try {
    const resCols = database.prepare("PRAGMA table_info(reservations)").all().map((c: any) => c.name);
    if (!resCols.includes('guest_page_expires_at')) {
      database.exec("ALTER TABLE reservations ADD COLUMN guest_page_expires_at TEXT");
      // Backfill: set expiry to check_out + 2 days for existing reservations
      database.exec("UPDATE reservations SET guest_page_expires_at = datetime(check_out, '+2 days') WHERE guest_page_expires_at IS NULL AND guest_page_token IS NOT NULL");
    }
  } catch { /* */ }

  // early_bookings was created here and never read by anything.
  // The cleanup below drops it where it already exists.

  // --- Migration: create rate_limits table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      token TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Clean old rate limit entries (older than 1 hour)
  try { database.exec("DELETE FROM rate_limits WHERE created_at < datetime('now', '-1 hour')"); } catch { /* */ }

  // --- Migration: create ical_channels table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS ical_channels (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      channel_type TEXT NOT NULL DEFAULT 'unit' CHECK (channel_type IN ('unit')),
      unit_id TEXT REFERENCES units(id) ON DELETE CASCADE,
      source_code TEXT NOT NULL DEFAULT 'vrbo',
      ical_url TEXT,
      export_token TEXT UNIQUE,
      sync_interval_minutes INTEGER NOT NULL DEFAULT 15,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // --- Migration: ical_channels carries its tenant ---
  // The export URL is the credential a channel manager holds, so the feed is
  // read with no session. Postgres then needs the row to be reachable by the
  // token alone, and everything the feed reads afterwards — units,
  // reservations — needs the hotel. Reading it back out of `properties` is not
  // possible from inside the token context, so the channel names its own
  // tenant. AGENTS.md §3 invariant 2.
  try {
    const icalCols = database.prepare("PRAGMA table_info(ical_channels)").all().map((c: any) => c.name);
    if (!icalCols.includes('organization_id')) {
      database.exec('ALTER TABLE ical_channels ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE');
      database.exec(`UPDATE ical_channels SET organization_id = (
        SELECT p.organization_id FROM properties p WHERE p.id = ical_channels.property_id)
        WHERE organization_id IS NULL`);
    }
  } catch { /* table not created yet on a fresh database */ }
  database.exec('CREATE INDEX IF NOT EXISTS idx_ical_channels_org ON ical_channels(organization_id)');

  // --- Migration: create ical_sync_log table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS ical_sync_log (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      channel_id TEXT NOT NULL REFERENCES ical_channels(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('success', 'error')),
      events_found INTEGER NOT NULL DEFAULT 0,
      events_created INTEGER NOT NULL DEFAULT 0,
      events_updated INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // --- Migration: reservations name their own organization ---
  //
  // The guest portal is reached with a token and nothing else, and `reservations`
  // was scoped only through `guests.organization_id`. On Postgres that meant a
  // guest link could not find its own booking: the policy needs an organization,
  // and the token lookup is what discovers it. Same fix booking_sites got — one
  // column, so the public entry point can name its own hotel.
  try {
    const resColsOrg = database.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
    if (!resColsOrg.some((c: any) => c.name === 'organization_id')) {
      database.exec("ALTER TABLE reservations ADD COLUMN organization_id TEXT REFERENCES organizations(id)");
      database.exec(`UPDATE reservations SET organization_id = (
        SELECT g.organization_id FROM guests g WHERE g.id = reservations.guest_id
      ) WHERE organization_id IS NULL`);
      database.exec("CREATE INDEX IF NOT EXISTS idx_reservations_org ON reservations(organization_id)");
      console.log('[DB] Added organization_id column to reservations');
    }
  } catch (e: any) {
    console.log('[DB] reservations.organization_id migration note:', e.message);
  }

  // --- Migration: add external_uid to reservations ---
  try {
    const resCols4 = database.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
    if (!resCols4.some((c: any) => c.name === 'external_uid')) {
      database.exec("ALTER TABLE reservations ADD COLUMN external_uid TEXT");
      database.exec("CREATE INDEX IF NOT EXISTS idx_reservations_external_uid ON reservations(external_uid)");
      console.log('[DB] Added external_uid column to reservations');
    }
  } catch (e: any) {
    console.log('[DB] external_uid migration note:', e.message);
  }

  // --- Migration: add VRBO booking source ---
  try {
    const vrboExists = database.prepare("SELECT id FROM booking_sources WHERE code = 'vrbo'").get();
    if (!vrboExists) {
      const propRow = database.prepare("SELECT id FROM properties LIMIT 1").get() as any;
      if (propRow) {
        database.prepare(
          'INSERT INTO booking_sources (id, property_id, name, code, icon_letter, color, sort_order, commission_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run('bs_vrbo', propRow.id, 'VRBO', 'vrbo', 'V', '#1E40AF', 7, 8);
        console.log('[DB] Added VRBO booking source');
      }
    }
  } catch (e: any) {
    console.log('[DB] VRBO source migration note:', e.message);
  }

  // --- Migration: add included_services_json and is_hidden to rate_plans ---
  try {
    const rpCols = database.prepare("PRAGMA table_info(rate_plans)").all().map((c: any) => c.name);
    if (!rpCols.includes('included_services_json')) {
      database.exec("ALTER TABLE rate_plans ADD COLUMN included_services_json TEXT NOT NULL DEFAULT '[]'");
      console.log('[DB] Added included_services_json to rate_plans');
    }
    if (!rpCols.includes('is_hidden')) {
      database.exec("ALTER TABLE rate_plans ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0");
      console.log('[DB] Added is_hidden to rate_plans');
    }
    // Блок 2.2 (0063): режим ціни тарифу. І в CREATE, і тут.
    if (!rpCols.includes('sell_mode')) {
      database.exec("ALTER TABLE rate_plans ADD COLUMN sell_mode TEXT NOT NULL DEFAULT 'per_person'");
      console.log('[DB] Added sell_mode to rate_plans');
    }
    // Блок 2 крок 2 (0069, Ц28): похідний тариф. І в CREATE, і тут.
    if (!rpCols.includes('pricing_type')) {
      database.exec("ALTER TABLE rate_plans ADD COLUMN pricing_type TEXT NOT NULL DEFAULT 'manual' CHECK (pricing_type IN ('manual', 'derived'))");
      database.exec('ALTER TABLE rate_plans ADD COLUMN based_on_rate_plan_id TEXT REFERENCES rate_plans(id)');
      database.exec("ALTER TABLE rate_plans ADD COLUMN adjustment_kind TEXT CHECK (adjustment_kind IN ('percent', 'fixed'))");
      database.exec('ALTER TABLE rate_plans ADD COLUMN adjustment_value REAL');
      database.exec("ALTER TABLE rate_plans ADD COLUMN adjustment_direction TEXT CHECK (adjustment_direction IN ('increase', 'decrease'))");
      console.log('[DB] Added derived rate plan columns to rate_plans (0069)');
    }

    // --- Migration 0070: надбавки за заселеність (Блок 2 крок 3, Ц30) ---
    //
    // Правило — рядок: тариф (NULL = усі), тип (NULL = усі), гість (дорослий |
    // дитина з вилкою або на всі вилки), проживання і харчування відсотком
    // від ціни ночі або сумою, додаткове ліжко. Точніше правило перебиває
    // загальне; два однакової точності на одну клітинку — відмова писача.
    database.exec(`
      CREATE TABLE IF NOT EXISTS extra_occupancy_rules (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        rate_plan_id    TEXT REFERENCES rate_plans(id) ON DELETE CASCADE,
        unit_type_id    TEXT REFERENCES unit_types(id) ON DELETE CASCADE,
        guest_kind      TEXT NOT NULL CHECK (guest_kind IN ('adult', 'child')),
        age_band_index  INTEGER,
        lodging_mode    TEXT CHECK (lodging_mode IN ('fixed', 'percent')),
        lodging_value   REAL,
        meal_mode       TEXT CHECK (meal_mode IN ('fixed', 'percent')),
        meal_value      REAL,
        extra_bed       INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_extra_occupancy_rules_org ON extra_occupancy_rules(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_extra_occupancy_rules_property ON extra_occupancy_rules(property_id)');
    // Ціна дитини з тарифу (0057, Ц12) → правило «дитина, усі вилки, сумою»
    // на цьому тарифі; колонка йде разом із читачами (інваріант 16). Один
    // раз: після DROP COLUMN колонки немає, і гілка не виконується.
    if (rpCols.includes('child_extra_gross')) {
      const moved = database.prepare(`
        INSERT INTO extra_occupancy_rules (id, organization_id, property_id, rate_plan_id, unit_type_id, guest_kind, age_band_index, lodging_mode, lodging_value, meal_mode, meal_value, extra_bed)
        SELECT lower(hex(randomblob(16))), p.organization_id, rp.property_id, rp.id, NULL, 'child', NULL, 'fixed', rp.child_extra_gross, NULL, NULL, 0
          FROM rate_plans rp JOIN properties p ON p.id = rp.property_id
         WHERE rp.child_extra_gross IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM extra_occupancy_rules r WHERE r.rate_plan_id = rp.id AND r.unit_type_id IS NULL AND r.guest_kind = 'child' AND r.age_band_index IS NULL)
      `).run().changes;
      database.exec('ALTER TABLE rate_plans DROP COLUMN child_extra_gross');
      console.log(`[DB] rate_plans.child_extra_gross → ${moved} extra_occupancy_rules row(s); column dropped (0070)`);
    }
    // Правила цін і промо (0071, Блок 2 крок 4, Ц31): знижка або надбавка до
    // ціни ночі ПІСЛЯ надбавок за заселеність і ДО зборів. Умови — період
    // (проживання по ночах / заїзду / виїзду), дні тижня, тарифи, типи,
    // тривалість, за скільки днів заброньовано, заселеність; дія — мінус чи
    // плюс, відсотком або сумою; пріоритет. Промо — те саме правило з кодом
    // (`kind = 'promo'`): діє лише з названим кодом, лічить використання, може
    // бути «лише онлайн». Списки — JSON у TEXT (SQLite не має масивів).
    database.exec(`
      CREATE TABLE IF NOT EXISTS price_rules (
        id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        property_id             TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        name                    TEXT NOT NULL,
        title_for_guest         TEXT,
        kind                    TEXT NOT NULL DEFAULT 'rule' CHECK (kind IN ('rule', 'promo')),
        code                    TEXT,
        condition_kind          TEXT CHECK (condition_kind IN ('period_of_stay', 'period_of_checkin', 'period_of_checkout')),
        date_from               TEXT,
        date_to                 TEXT,
        week_days               TEXT,
        rate_plan_ids           TEXT,
        unit_type_ids           TEXT,
        min_los                 INTEGER,
        max_los                 INTEGER,
        booked_days_before_from INTEGER,
        booked_days_before_to   INTEGER,
        occupancy_from          INTEGER,
        occupancy_to            INTEGER,
        action                  TEXT NOT NULL CHECK (action IN ('decrease', 'increase')),
        value                   REAL NOT NULL,
        value_kind              TEXT NOT NULL CHECK (value_kind IN ('percent', 'fixed')),
        priority                INTEGER NOT NULL DEFAULT 100,
        is_active               INTEGER NOT NULL DEFAULT 1,
        online_only             INTEGER NOT NULL DEFAULT 0,
        max_uses                INTEGER,
        current_uses            INTEGER NOT NULL DEFAULT 0,
        created_at              TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_price_rules_org ON price_rules(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_price_rules_property ON price_rules(property_id, priority)');
    // Промокод унікальний у межах ОРГАНІЗАЦІЇ (інваріант 3), без регістру; лише
    // там, де він є. Звичайні правила коду не мають і під індекс не потрапляють.
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_price_rules_promo_code ON price_rules(organization_id, lower(code)) WHERE code IS NOT NULL");
    // Тут стояв ADD COLUMN власної ціни. Видалений разом зі створенням, а не
    // прикритий DROP-ом у кінці (AGENTS §4): у вже наявних локальних базах
    // колонка лишиться сиротою, і це нікого не турбує — її не читає ніхто.
    // Справжнє видалення на Postgres робить міграція 0055, і лише якщо в ній
    // порожньо.
  } catch (e: any) {
    console.log('[DB] rate_plans migration note:', e.message);
  }

  // ═══════════════════════════════════════════════════════
  // BOOKING SERVICE v2 TABLES
  // ═══════════════════════════════════════════════════════

  // --- Migration: add gender column to guests ---
  try {
    const guestsCols = database.prepare("PRAGMA table_info(guests)").all().map((c: any) => c.name);
    if (!guestsCols.includes('gender')) {
      database.exec("ALTER TABLE guests ADD COLUMN gender TEXT CHECK (gender IN ('female', 'male', 'other'))");
      console.log('[DB] Added gender column to guests');
    }
  } catch (e: any) {
    console.log('[DB] gender migration note:', e.message);
  }

  // --- Migration: add is_pool column to units ---
  // A pool unit is where a booking with no room yet waits: a real row, so the
  // existing PATCH unit_id flow works unchanged, filtered out of every list
  // that sells rooms (calendar, occupancy, availability) so it is never
  // offered as one.
  //
  // Тут же стояв засів такого юніта — але лише для будови з кодом «F», тобто
  // для одного клієнта. Іншим готелям pool-юніт не створювався ніколи, і
  // чернетки їм не було куди класти. Будов більше немає; pool-юніт заводить
  // provision-org.mjs разом із рештою обʼєкта, для кожного готеля однаково.
  try {
    const unitsCols = database.prepare("PRAGMA table_info(units)").all().map((c: any) => c.name);
    if (!unitsCols.includes('is_pool')) {
      database.exec("ALTER TABLE units ADD COLUMN is_pool INTEGER NOT NULL DEFAULT 0");
      console.log('[DB] Added is_pool column to units');
    }
  } catch (e: any) {
    console.log('[DB] is_pool migration note:', e.message);
  }

  // --- Migration: extend additional_services with service_type, duration, photo ---
  try {
    const asCols = database.prepare("PRAGMA table_info(additional_services)").all().map((c: any) => c.name);
    if (!asCols.includes('service_type')) {
      database.exec("ALTER TABLE additional_services ADD COLUMN service_type TEXT DEFAULT 'simple'");
      // simple | slot_booking | menu_selection | per_day
    }
    if (!asCols.includes('duration_minutes')) {
      database.exec("ALTER TABLE additional_services ADD COLUMN duration_minutes INTEGER");
    }
    if (!asCols.includes('photo_url')) {
      database.exec("ALTER TABLE additional_services ADD COLUMN photo_url TEXT");
    }
    if (!asCols.includes('min_quantity')) {
      database.exec("ALTER TABLE additional_services ADD COLUMN min_quantity INTEGER DEFAULT 0");
    }
    if (!asCols.includes('max_quantity')) {
      database.exec("ALTER TABLE additional_services ADD COLUMN max_quantity INTEGER DEFAULT 10");
    }
    if (!asCols.includes('options_schema')) {
      database.exec("ALTER TABLE additional_services ADD COLUMN options_schema TEXT");
    }
    if (!asCols.includes('name_cs')) {
      database.exec("ALTER TABLE additional_services ADD COLUMN name_cs TEXT");
    }
    if (!asCols.includes('name_de')) {
      database.exec("ALTER TABLE additional_services ADD COLUMN name_de TEXT");
    }
    if (!asCols.includes('vat_split')) {
      // Фіскальний поділ однієї послуги: гість бачить «Frühstück 15 €», а на
      // рахунок ідуть Speisen 7% і Getränke 19% — вимога бухгалтера, не меню.
      database.exec("ALTER TABLE additional_services ADD COLUMN vat_split TEXT");
    }
    // Тут стояли сім UPDATE-ів, які на КОЖНОМУ старті переписували рядки
    // `svc_sauna`, `svc_pool` і `svc_breakfast`: тип послуги, тривалість,
    // чеські й німецькі назви — і ціну, «UPDATE … SET price = 600».
    //
    // Дві причини прибрати. По-перше, `svc_sauna` і `svc_pool` не сіються
    // ніде (сіється лише `svc_breakfast`, і той узагальнений), тож на будь-якій
    // новій базі ці рядки не влучали нікуди — мертвий код, що виглядав як
    // налаштування. По-друге, там, де ті рядки Є — у першого клієнта, — цикл
    // працював проти нього: він міняв ціну сауни в інтерфейсі, а найближчий
    // рестарт повертав 600. Ціна послуги належить готелю, і застосунок не має
    // права її переписувати щостарту.
    database.exec("UPDATE additional_services SET service_type = 'menu_selection' WHERE id = 'svc_breakfast' AND service_type IS NULL");
    console.log('[DB] Extended additional_services with service_type columns');
  } catch (e: any) {
    console.log('[DB] additional_services extension note:', e.message);
  }

  // --- Migration: create service_time_slots table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS service_time_slots (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      service_id TEXT NOT NULL REFERENCES additional_services(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      max_capacity INTEGER NOT NULL DEFAULT 1,
      booked_count INTEGER NOT NULL DEFAULT 0,
      is_available INTEGER NOT NULL DEFAULT 1,
      reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
      booking_session_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_id, date, start_time)
    )
  `);

  // --- Migration: create menu_items table ---
  const miExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='menu_items'"
  ).get();
  if (!miExists) {
    database.exec(`
      CREATE TABLE menu_items (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        service_id TEXT NOT NULL REFERENCES additional_services(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        name_en TEXT,
        name_cs TEXT,
        name_de TEXT,
        description TEXT,
        weight_grams INTEGER,
        price REAL NOT NULL DEFAULT 0,
        photo_url TEXT,
        is_available INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Seed 3 breakfast menu items — ONLY where their parent service exists.
    //
    // svc_breakfast is itself seeded conditionally (`if (propRow)`, further
    // up): a database with no property gets no services. This seed ran
    // unconditionally, so on exactly that database it violated the foreign
    // key — and because it runs inside first boot, getDb() threw, and EVERY
    // route that still touches the legacy handle answered 500.
    //
    // That is not a theoretical shape. It is why the CI live job was red from
    // the day it existed: a production server whose data lives in Postgres
    // boots an empty SQLite alongside — no property, no svc_breakfast — and
    // the first request into a getDb() route died on this line. Locally it
    // never showed, because a dev boot seeds a demo property first.
    const svcBreakfast = database.prepare(
      "SELECT 1 FROM additional_services WHERE id = 'svc_breakfast'").get();
    if (svcBreakfast) {
      const insMI = database.prepare(
        'INSERT INTO menu_items (id, service_id, name, name_en, name_cs, name_de, description, weight_grams, price, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      insMI.run('mi_breakfast_1', 'svc_breakfast', 'Classic Breakfast', 'Classic Breakfast', 'Klasická snídaně', 'Klassisches Frühstück',
        'Eggs, toast, butter, jam, fresh vegetables, coffee or tea', 400, 250, 1);
      insMI.run('mi_breakfast_2', 'svc_breakfast', 'Pancakes with Berries', 'Pancakes with Berries', 'Lívanečky s ovocem', 'Pfannkuchen mit Beeren',
        'Fluffy pancakes with seasonal berries, honey and sour cream', 350, 280, 2);
      insMI.run('mi_breakfast_3', 'svc_breakfast', 'Granola Bowl', 'Granola Bowl', 'Granola mísa', 'Granola Schüssel',
        'House granola with yoghurt, fruit and honey', 300, 220, 3);
      console.log('[DB] Created menu_items table with 3 breakfast items');
    }
  }

  // --- Migration: create booking_service_orders table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS booking_service_orders (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      reservation_id TEXT REFERENCES reservations(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL REFERENCES additional_services(id) ON DELETE CASCADE,
      menu_item_id TEXT REFERENCES menu_items(id) ON DELETE SET NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      service_date TEXT,
      time_slot_id TEXT REFERENCES service_time_slots(id) ON DELETE SET NULL,
      options_json TEXT,
      unit_price REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);

  // --- Migration: add Teya payment columns to booking_service_orders ---
  try {
    database.exec(`ALTER TABLE booking_service_orders ADD COLUMN payment_id TEXT`);
    database.exec(`ALTER TABLE booking_service_orders ADD COLUMN payment_status TEXT DEFAULT 'none' CHECK (payment_status IN ('none', 'pending', 'paid', 'failed', 'refunded'))`);
    console.log('[DB] Added payment columns to booking_service_orders');
  } catch {
    // Columns already exist — ignore
  }

  // --- Migration: add coupon_code column to booking_service_orders ---
  try {
    database.exec(`ALTER TABLE booking_service_orders ADD COLUMN coupon_code TEXT`);
    console.log('[DB] Added coupon_code column to booking_service_orders');
  } catch {
    // Column already exists — ignore
  }

  // --- Migration: create coupons table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      code TEXT UNIQUE NOT NULL,
      description TEXT,
      discount_type TEXT NOT NULL DEFAULT 'fixed_price' CHECK (discount_type IN ('fixed_price', 'percentage', 'fixed_amount')),
      offer_amount REAL NOT NULL,
      applicable_services TEXT,
      valid_from TEXT,
      valid_until TEXT,
      max_uses INTEGER,
      current_uses INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // No promo codes are seeded: a discount tied to one property's sauna pricing
  // has no meaning in another tenant's database.

  // --- Migration: create sauna_addons table for broom etc ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS service_addons (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      service_id TEXT NOT NULL REFERENCES additional_services(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_en TEXT,
      name_cs TEXT,
      name_de TEXT,
      price REAL NOT NULL DEFAULT 0,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  // No add-ons are seeded — they belong to a specific property's service list.

  // --- Migration: add extra_person_charge, pet_allowed, pet_charge to unit_types ---
  try {
    const utCols = (database.prepare("PRAGMA table_info(unit_types)").all() as any[]).map(c => c.name);
    if (!utCols.includes('extra_person_charge')) {
      database.exec("ALTER TABLE unit_types ADD COLUMN extra_person_charge INTEGER NOT NULL DEFAULT 1000");
      console.log('[DB] Added extra_person_charge to unit_types (default 1000 CZK)');
    }
    if (!utCols.includes('pet_allowed')) {
      database.exec("ALTER TABLE unit_types ADD COLUMN pet_allowed INTEGER NOT NULL DEFAULT 1");
      console.log('[DB] Added pet_allowed to unit_types');
    }
    if (!utCols.includes('pet_charge')) {
      database.exec("ALTER TABLE unit_types ADD COLUMN pet_charge INTEGER NOT NULL DEFAULT 400");
      console.log('[DB] Added pet_charge to unit_types (default 400 CZK)');
    }
    // Halls rented by time block; money flows through folios. Migration 0024.
    database.exec(`
      CREATE TABLE IF NOT EXISTS event_spaces (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        name TEXT NOT NULL, code TEXT NOT NULL,
        capacity_note TEXT, block_prices TEXT,
        vat_code TEXT NOT NULL DEFAULT 'standard',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(property_id, code)
      )
    `);
    // UNIQUE вище тримає правило; міграція 0024 тримає те саме ІМЕНОВАНИМ
    // індексом idx_event_spaces_row. Ім'я мусить існувати й у цій базі:
    // schema.sql генерується з неї, і без нього check-schema-drift показує
    // «міграція створює, а schema.sql — ні». Так само чотири idx_*_row нижче.
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_event_spaces_row ON event_spaces(property_id, code)');
    database.exec(`
      CREATE TABLE IF NOT EXISTS event_addons (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        name TEXT NOT NULL, kind TEXT NOT NULL,
        price_gross REAL NOT NULL DEFAULT 0,
        vat_code TEXT NOT NULL DEFAULT 'standard',
        note TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(property_id, name),
        CHECK (kind IN ('per_person','flat','per_hour','per_piece'))
      )
    `);
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_event_addons_row ON event_addons(property_id, name)');
    database.exec(`
      CREATE TABLE IF NOT EXISTS event_bookings (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        space_id TEXT NOT NULL REFERENCES event_spaces(id) ON DELETE CASCADE,
        event_date TEXT NOT NULL, time_from TEXT NOT NULL, time_to TEXT NOT NULL,
        persons INTEGER NOT NULL DEFAULT 0,
        customer_name TEXT NOT NULL, customer_email TEXT, customer_phone TEXT, company TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed',
        notes TEXT, folio_id TEXT,
        -- Рядок фоліо, який несе саму залу. Не прапорець «виставлено»: рядок
        -- відповідає і на «чи вже в рахунку», і на «чи його сторновано».
        -- Див. міграцію 0034.
        hall_charge_item_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (status IN ('draft','confirmed','cancelled')),
        CHECK (time_from < time_to)
      )
    `);
    // Для баз, створених до 0034.
    try {
      const ebCols = database.prepare('PRAGMA table_info(event_bookings)').all() as { name: string }[];
      if (!ebCols.some((c) => c.name === 'hall_charge_item_id')) {
        database.exec('ALTER TABLE event_bookings ADD COLUMN hall_charge_item_id TEXT');
        console.log('[DB] event_bookings: added hall_charge_item_id');
      }
    } catch (e: any) {
      console.log('[DB] hall_charge_item_id migration note:', e.message);
    }
    // The collision query reads a hall's day on every booking attempt. The
    // index lived only in migration 0024, so a database created fresh — every
    // new hotel — never got it.
    database.exec('CREATE INDEX IF NOT EXISTS idx_event_bookings_day ON event_bookings(property_id, space_id, event_date)');
    // How a property's guest page differs from the section registry in code.
    // No rows = registry defaults. See migration 0022.
    database.exec(`
      CREATE TABLE IF NOT EXISTS guest_page_sections (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        section TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER,
        config TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(property_id, section)
      )
    `);
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_page_sections_row ON guest_page_sections(property_id, section)');

    // Reception can sell it, the website cannot. See migration 0021.
    if (!utCols.includes('bookable_online')) {
      database.exec("ALTER TABLE unit_types ADD COLUMN bookable_online INTEGER NOT NULL DEFAULT 1");
    }
    // NULL defers to the channel rule — middle level of booking → type → rule.
    if (!utCols.includes('breakfast_included')) {
      database.exec("ALTER TABLE unit_types ADD COLUMN breakfast_included INTEGER");
    }
  } catch (e: any) {
    console.log('[DB] unit_types extension note:', e.message);
  }

  // --- Migration: add parking_photo_url to property_guest_config ---
  try {
    database.exec(`ALTER TABLE property_guest_config ADD COLUMN parking_photo_url TEXT`);
    console.log('[DB] Added parking_photo_url to property_guest_config');
  } catch {
    // Column already exists — ignore
  }

  // --- Migration: add payment columns to service_orders ---
  try {
    database.exec(`ALTER TABLE service_orders ADD COLUMN payment_id TEXT`);
    database.exec(`ALTER TABLE service_orders ADD COLUMN payment_status TEXT DEFAULT 'none' CHECK (payment_status IN ('none', 'pending', 'paid', 'failed', 'refunded'))`);
    console.log('[DB] Added payment columns to service_orders');
  } catch {
    // Columns already exist — ignore
  }

  // --- Migration: add description_en/cs/de to menu_items ---
  try {
    database.exec(`ALTER TABLE menu_items ADD COLUMN description_en TEXT`);
    database.exec(`ALTER TABLE menu_items ADD COLUMN description_cs TEXT`);
    database.exec(`ALTER TABLE menu_items ADD COLUMN description_de TEXT`);
    console.log('[DB] Added description_en/cs/de to menu_items');
  } catch {
    // Columns already exist — ignore
  }
  // Backfill English/Czech/German descriptions for the 3 seed breakfast items
  try {
    const bfDesc: Record<string, { en: string; cs: string; de: string }> = {
      'mi_breakfast_1': {
        en: 'Scrambled eggs, toast, butter, jam, fresh vegetables, coffee/tea',
        cs: 'Míchaná vejce, toast, máslo, džem, čerstvá zelenina, káva/čaj',
        de: 'Rührei, Toast, Butter, Marmelade, frisches Gemüse, Kaffee/Tee',
      },
      'mi_breakfast_2': {
        en: 'Fluffy pancakes with seasonal berries, honey and sour cream',
        cs: 'Nadýchané lívanečky se sezónním ovocem, medem a zakysanou smetanou',
        de: 'Lockere Pfannkuchen mit Saisonbeeren, Honig und saurer Sahne',
      },
      'mi_breakfast_3': {
        en: 'Homemade granola with yoghurt, fruits and honey',
        cs: 'Domácí granola s jogurtem, ovocem a medem',
        de: 'Hausgemachte Granola mit Joghurt, Früchten und Honig',
      },
    };
    const upd = database.prepare('UPDATE menu_items SET description_en=?, description_cs=?, description_de=? WHERE id=? AND description_en IS NULL');
    for (const [id, d] of Object.entries(bfDesc)) {
      upd.run(d.en, d.cs, d.de, id);
    }
  } catch (e: any) {
    console.warn('[DB] menu_items backfill note:', e.message);
  }

  // --- Migration: seed generic checkout/checkin services ---
  // Property-specific wellness services are deliberately not seeded here.
  try {
    const propRow2 = database.prepare("SELECT id FROM properties LIMIT 1").get() as any;
    if (propRow2) {
      const lateExists = database.prepare("SELECT id FROM additional_services WHERE id = 'svc_late_checkout'").get();
      if (!lateExists) {
        database.prepare(
          'INSERT INTO additional_services (id, property_id, name, name_en, name_cs, name_de, description, price, unit_label, icon, category, available_for, sort_order, service_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run('svc_late_checkout', propRow2.id, 'Late Checkout', 'Late Checkout', 'Pozdní odhlášení', 'Später Check-out', 'Check out at 14:00 instead of 11:00', 500, 'one-off', '🕐', 'other', 'all', 10, 'toggle');
        console.log('[DB] Seeded service: svc_late_checkout (500 CZK)');
      }
      const earlyExists = database.prepare("SELECT id FROM additional_services WHERE id = 'svc_early_checkin'").get();
      if (!earlyExists) {
        database.prepare(
          'INSERT INTO additional_services (id, property_id, name, name_en, name_cs, name_de, description, price, unit_label, icon, category, available_for, sort_order, service_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run('svc_early_checkin', propRow2.id, 'Early Check-in', 'Early Check-in', 'Brzký příjezd', 'Früher Check-in', 'Check in from 12:00 instead of 15:00', 500, 'one-off', '🕛', 'other', 'all', 11, 'toggle');
        console.log('[DB] Seeded service: svc_early_checkin (500 CZK)');
      }
    }
  } catch (e: any) {
    console.log('[DB] New services seed note:', e.message);
  }

  // --- Migration: create content_translations table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS content_translations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      text_hash   TEXT NOT NULL,
      source_text TEXT NOT NULL,
      lang        TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(text_hash, lang)
    )
  `);

  // --- Migration: add per-language columns to additional_services ---
  const svcLangCols = [
    'name_pl', 'name_nl', 'name_fr',
    'description_en', 'description_de', 'description_cs', 'description_pl', 'description_nl', 'description_fr',
    'unit_label_en', 'unit_label_de', 'unit_label_cs', 'unit_label_pl', 'unit_label_nl', 'unit_label_fr',
  ];
  for (const col of svcLangCols) {
    try { database.exec(`ALTER TABLE additional_services ADD COLUMN ${col} TEXT`); }
    catch { /* already exists */ }
  }

  // ═══════════════════════════════════════════════════════
  // FINANCE MODULE TABLES
  // ═══════════════════════════════════════════════════════

  // --- Migration: create business_units table ---
  const buExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='business_units'"
  ).get();
  if (!buExists) {
    database.exec(`
      CREATE TABLE business_units (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        -- Будинок, або NULL = «на весь рахунок» (Д54). Колонка нульова
        -- навмисно: обовʼязкова вимагала б вигадати будинок кожному наявному
        -- рядку і зламала б готель з одним обʼєктом.
        property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        unit_type TEXT,
        is_shared INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Рядків тут БІЛЬШЕ НЕ СІЄМО (INC-025). Тут стояло
    // `SELECT id FROM organizations LIMIT 1` і два літеральні ключі
    // (`bu_shared`, `bu_review`) — тобто структурні юніти діставались готелю,
    // який завівся першим, а другий не мав жодного. Засів переїхав у 0097
    // (для кожної організації) і в `provisionOrganization` (для нової).
    console.log('[DB] Created business_units table');
  }

  // --- Migration: add parent_id to business_units for hierarchy (Finmap PR #3) ---
  try {
    const buCols = database.prepare("PRAGMA table_info(business_units)").all() as { name: string }[];
    const hasParent = buCols.some((c) => c.name === 'parent_id');
    if (!hasParent) {
      database.exec("ALTER TABLE business_units ADD COLUMN parent_id TEXT REFERENCES business_units(id)");
      database.exec("CREATE INDEX IF NOT EXISTS idx_bu_parent ON business_units(parent_id)");
      console.log('[DB] Added parent_id column to business_units for hierarchy');
    }
  } catch (e: any) {
    console.log('[DB] business_units hierarchy migration note:', e.message);
  }

  // --- Migration: create expense_categories table ---
  const ecExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='expense_categories'"
  ).get();
  if (!ecExists) {
    database.exec(`
      CREATE TABLE expense_categories (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        -- Будинок, або NULL = «на весь рахунок» (Д54).
        property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        std_group TEXT NOT NULL DEFAULT 'OPEX',
        pnl_line TEXT NOT NULL,
        include_in_pnl INTEGER NOT NULL DEFAULT 1,
        include_in_cash INTEGER NOT NULL DEFAULT 1,
        alloc_method TEXT NOT NULL DEFAULT 'DIRECT',
        is_capex INTEGER NOT NULL DEFAULT 0,
        icon TEXT,
        color TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // План рахунків тут БІЛЬШЕ НЕ СІЄМО (INC-025). Тут стояло
    // `SELECT id FROM organizations LIMIT 1` і пʼятнадцять ЛІТЕРАЛЬНИХ
    // первинних ключів (`ec_accommodation`, …), тож другий комплект був
    // неможливий за означенням PK: статті діставались готелю, який завівся
    // першим, а місток платежів пришпилював `'ec_accommodation'` кожному.
    // Засів переїхав у 0097 (для кожної організації) і в
    // `provisionOrganization` (для нової), а сталою величиною став `code`.
    console.log('[DB] Created expense_categories table');
  }

  // --- Migration: add hierarchy + op_type + classifier to expense_categories (Finmap PR #2) ---
  try {
    const ecCols = database.prepare("PRAGMA table_info(expense_categories)").all() as { name: string }[];
    const hasOpType = ecCols.some((c) => c.name === 'op_type');
    if (!hasOpType) {
      database.exec("ALTER TABLE expense_categories ADD COLUMN parent_id TEXT REFERENCES expense_categories(id)");
      database.exec("ALTER TABLE expense_categories ADD COLUMN op_type TEXT");
      database.exec("ALTER TABLE expense_categories ADD COLUMN classifier TEXT");
      database.exec("CREATE INDEX IF NOT EXISTS idx_ec_parent ON expense_categories(parent_id)");

      // Backfill: map existing std_group → op_type + classifier
      //
      // Три рядки цього списку стояли ЗА ЛІТЕРАЛЬНИМ КЛЮЧЕМ — `WHERE id =
      // 'ec_variable'`, `'ec_investors'`, `'ec_transfer'`. Відколи ключ
      // випадковий і належить готелю (INC-025), така умова не виконується в
      // жодного готелю й мовчить про це (Р12.4, `check-catalogue-ids`). Їх
      // забрано звідси: те саме робиться нижче, у блоці 0097, за `code` —
      // тобто вже після того, як колонка кодів зʼявилась.
      // Осі — з ОДНІЄЇ мапи (`AXIS_BY_STD_GROUP`), не зі списку, набраного тут
      // руками (Р13.6). Той список був неправильний двічі: `Revenue` діставав
      // `classifier = 'other'` — проживання переставало бути виручкою, — а
      // `Financing` не потрапляв у жоден `WHEN` узагалі й падав в останній
      // рядок `other/other`, тобто надходження від інвестора рахувалося
      // виручкою. Обидва значення НЕПОРОЖНІ, тож наступний бекфіл, який лікує
      // порожнє, не спрацьовував уже ніколи, а `--list` показував «без осей: 0».
      for (const [group, axis] of Object.entries(AXIS_BY_STD_GROUP_SEED)) {
        database.prepare(
          'UPDATE expense_categories SET op_type = ?, classifier = ? WHERE std_group = ?')
          .run(axis.opType, axis.classifier, group);
      }
      // Група, якої немає в мапі, вісь НЕ отримує: вгадана вісь це гроші в
      // чужому рядку звіту. Такі статті називає читач П&L названою відмовою
      // (`pnl-classifier.check`), а `seed-chart-of-accounts.mjs --list` — по
      // імені (інваріант 13).

      console.log('[DB] Extended expense_categories with parent_id/op_type/classifier + backfilled seed rows');
    }
  } catch (e: any) {
    console.log('[DB] expense_categories hierarchy migration note:', e.message);
  }

  // --- Every-startup backfill: categories created via the legacy CRUD used to
  // get NULL op_type/classifier, making them invisible to matrix reports.
  // Idempotent — only touches rows that are still unclassified.
  try {
    const fixes: string[] = [
      "UPDATE expense_categories SET op_type='income',   classifier=COALESCE(NULLIF(classifier,''),'revenue')     WHERE std_group='Revenue'   AND (op_type IS NULL OR op_type='')",
      "UPDATE expense_categories SET op_type='expense',  classifier=COALESCE(NULLIF(classifier,''),'cogs')        WHERE std_group='COGS'      AND (op_type IS NULL OR op_type='')",
      "UPDATE expense_categories SET op_type='expense',  classifier=COALESCE(NULLIF(classifier,''),'operational') WHERE std_group='OPEX'      AND (op_type IS NULL OR op_type='')",
      "UPDATE expense_categories SET op_type='expense',  classifier=COALESCE(NULLIF(classifier,''),'tax')         WHERE std_group='Taxes'     AND (op_type IS NULL OR op_type='')",
      "UPDATE expense_categories SET op_type='expense',  classifier=COALESCE(NULLIF(classifier,''),'capex')       WHERE std_group='CAPEX'     AND (op_type IS NULL OR op_type='')",
      "UPDATE expense_categories SET op_type='expense',  classifier=COALESCE(NULLIF(classifier,''),'financing')   WHERE std_group='Financing' AND (op_type IS NULL OR op_type='')",
      "UPDATE expense_categories SET op_type='transfer', classifier=COALESCE(NULLIF(classifier,''),'other')       WHERE std_group='Transfer'  AND (op_type IS NULL OR op_type='')",
      "UPDATE expense_categories SET op_type='other',    classifier=COALESCE(NULLIF(classifier,''),'other')       WHERE op_type IS NULL OR op_type=''",
      "UPDATE expense_categories SET classifier='other' WHERE classifier IS NULL OR classifier=''",
    ];
    let fixed = 0;
    for (const sql of fixes) fixed += database.prepare(sql).run().changes;
    if (fixed > 0) console.log(`[DB] Classified ${fixed} legacy expense_categories rows (op_type/classifier backfill)`);
  } catch (e: any) {
    console.log('[DB] expense_categories classifier backfill note:', e.message);
  }

  // --- One-shot: attribute reservation income to the STAY period ------------
  // Historically accrued_at defaulted to paid_at, so the "accrual" P&L basis
  // was a fiction. Point reservation-linked income at check_in (stay month)
  // and fill period_from/to. paid_at (cash truth) is untouched. Guarded via
  // fin_system_state so it runs once.
  try {
    const done = database.prepare(
      "SELECT value FROM fin_system_state WHERE key = 'accrued_at_stay_backfilled'"
    ).get() as { value: string } | undefined;
    if (!done) {
      const r = database.prepare(`
        UPDATE fin_operations SET
          accrued_at = (SELECT r.check_in FROM reservations r WHERE r.id = fin_operations.reservation_id),
          period_from = COALESCE(period_from, (SELECT r.check_in FROM reservations r WHERE r.id = fin_operations.reservation_id)),
          period_to = COALESCE(period_to, (SELECT r.check_out FROM reservations r WHERE r.id = fin_operations.reservation_id))
        WHERE op_type = 'income'
          AND reservation_id IS NOT NULL
          AND accrued_at = paid_at
          AND EXISTS (SELECT 1 FROM reservations r WHERE r.id = fin_operations.reservation_id AND r.check_in IS NOT NULL)
      `).run();
      database.prepare(
        "INSERT OR REPLACE INTO fin_system_state (key, value, updated_at) VALUES ('accrued_at_stay_backfilled', ?, datetime('now'))"
      ).run(`re-attributed ${r.changes} reservation income ops to stay period`);
      if (r.changes > 0) console.log(`[DB] Accrual backfill: ${r.changes} reservation income ops now accrue on check-in date`);
    }
  } catch (e: any) {
    console.log('[DB] accrued_at stay backfill note:', e.message);
  }

  // --- Migration: create expenses table (skipped after fin_operations migration) ---
  if (!finOpsMigrated) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES expense_categories(id),
        business_unit_id TEXT REFERENCES business_units(id),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CZK',
        description TEXT NOT NULL,
        counterparty TEXT,
        method TEXT CHECK (method IN ('cash', 'card', 'bank_transfer', 'invoice')),
        expense_date TEXT NOT NULL,
        month TEXT NOT NULL,
        receipt_id TEXT,
        needs_review INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_by TEXT REFERENCES app_users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_expenses_bu ON expenses(business_unit_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(month)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)');
  }

  // --- Migration: create receipts table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
      file_path TEXT NOT NULL,
      file_type TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ═══════════════════════════════════════════════════════
  // FINANCE MODULE PHASE 2 TABLES
  // ═══════════════════════════════════════════════════════

  // --- Migration: create capex_items table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS capex_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      business_unit_id TEXT REFERENCES business_units(id),
      name TEXT NOT NULL,
      asset_type TEXT DEFAULT 'construction',
      amount REAL NOT NULL,
      counterparty TEXT,
      purchase_date TEXT NOT NULL,
      month TEXT NOT NULL,
      useful_life_months INTEGER,
      depreciation_monthly REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_by TEXT REFERENCES app_users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_capex_org ON capex_items(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_capex_bu ON capex_items(business_unit_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_capex_month ON capex_items(month)');

  // --- Migration: create accruals table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS accruals (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      business_unit_id TEXT REFERENCES business_units(id),
      category_id TEXT REFERENCES expense_categories(id),
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      month TEXT NOT NULL,
      accrual_type TEXT NOT NULL DEFAULT 'expense',
      status TEXT NOT NULL DEFAULT 'pending',
      -- Без REFERENCES expenses(id): таблиці expenses немає з часу переходу
      -- на fin_operations. Посилання тут коштувало трьох індексів у КОЖНОГО
      -- нового клієнта: воно вмикало перебудову нижче, а та зносила
      -- таблицю разом з індексами, створеними трьома рядками нижче.
      paid_expense_id TEXT,
      notes TEXT,
      created_by TEXT REFERENCES app_users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_accruals_org ON accruals(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_accruals_month ON accruals(month)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_accruals_status ON accruals(status)');

  // bank_statements and bank_transactions used to be created here. The
  // statement import that filled them was removed with the finance wrapper,
  // so they could only ever be empty; the cleanup at the end of this
  // function drops them from databases that still carry them.

  // ═══════════════════════════════════════════════════════
  // FINANCE MODULE PHASE 3 — Accounts, Income, Transfers
  // ═══════════════════════════════════════════════════════

  database.exec(`
    CREATE TABLE IF NOT EXISTS finance_accounts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      -- Будинок, або NULL = «на весь рахунок» (Д54). Каса стоїть у будинку.
      property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'cash' CHECK (type IN ('cash', 'bank', 'card', 'investment', 'other')),
      currency TEXT NOT NULL DEFAULT 'CZK',
      initial_balance REAL NOT NULL DEFAULT 0,
      credit_limit REAL,
      color TEXT DEFAULT '#6366f1',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_fin_acct_org ON finance_accounts(organization_id)');

  // Migration: rebuild finance_accounts to add 'card' to type CHECK and credit_limit column.
  // SQLite cannot ALTER a CHECK constraint, so we rebuild via swap-and-rename.
  try {
    const acctCols = database.prepare("PRAGMA table_info(finance_accounts)").all() as { name: string }[];
    const hasCreditLimit = acctCols.some((c) => c.name === 'credit_limit');
    if (!hasCreditLimit) {
      database.exec(`
        CREATE TABLE finance_accounts_new (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'cash' CHECK (type IN ('cash', 'bank', 'card', 'investment', 'other')),
          currency TEXT NOT NULL DEFAULT 'CZK',
          initial_balance REAL NOT NULL DEFAULT 0,
          credit_limit REAL,
          color TEXT DEFAULT '#6366f1',
          is_active INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO finance_accounts_new
          (id, organization_id, name, type, currency, initial_balance, color, is_active, sort_order, created_at)
        SELECT id, organization_id, name, type, currency, initial_balance, color, is_active, sort_order, created_at
        FROM finance_accounts;
        DROP TABLE finance_accounts;
        ALTER TABLE finance_accounts_new RENAME TO finance_accounts;
        CREATE INDEX IF NOT EXISTS idx_fin_acct_org ON finance_accounts(organization_id);
      `);
      console.log('[DB] Rebuilt finance_accounts: added card type and credit_limit column');
    }
  } catch (e: any) {
    console.log('[DB] finance_accounts rebuild note:', e.message);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS finance_exchange_rates (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL CHECK (rate > 0),
      effective_from TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(organization_id, from_currency, to_currency, effective_from)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_fx_org ON finance_exchange_rates(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_fx_pair ON finance_exchange_rates(from_currency, to_currency, effective_from)');

  // --- Finance PR #4: counterparties with hierarchy and aliases for auto-matching ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS finance_counterparties (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      -- Будинок, або NULL = «на весь рахунок» (Д54).
      property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_id TEXT REFERENCES finance_counterparties(id),
      kind TEXT,
      note TEXT,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      icon TEXT,
      color TEXT DEFAULT '#6b7280',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_cp_org ON finance_counterparties(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cp_parent ON finance_counterparties(parent_id)');

  // --- Finance PR #11: bank inbox (IMAP poller for KB statements) ---
  // Add iban column to finance_accounts so XML statements auto-route to correct account
  try {
    const acctCols = database.prepare("PRAGMA table_info(finance_accounts)").all() as { name: string }[];
    if (!acctCols.some((c) => c.name === 'iban')) {
      database.exec("ALTER TABLE finance_accounts ADD COLUMN iban TEXT");
      database.exec("CREATE INDEX IF NOT EXISTS idx_fin_acct_iban ON finance_accounts(iban)");
    }
  } catch (e: any) { console.log('[DB] finance_accounts iban migration note:', e.message); }

  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_bank_inboxes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL DEFAULT 993,
      imap_user TEXT NOT NULL,
      imap_password_encrypted TEXT NOT NULL,
      imap_folder TEXT NOT NULL DEFAULT 'INBOX',
      use_tls INTEGER NOT NULL DEFAULT 1,
      sender_filter TEXT,
      subject_filter TEXT,
      attachment_format TEXT NOT NULL DEFAULT 'auto',
      last_uid INTEGER,
      last_synced_at TEXT,
      last_error TEXT,
      last_email_at TEXT,
      emails_processed INTEGER NOT NULL DEFAULT 0,
      operations_imported INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_inbox_org ON fin_bank_inboxes(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_inbox_active ON fin_bank_inboxes(is_active, last_synced_at)');

  // --- Finance PR #10: budgets (plan/fact) ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_budgets (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      category_id TEXT REFERENCES expense_categories(id),
      project_id TEXT REFERENCES business_units(id),
      planned_amount REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(organization_id, year, month, category_id, project_id)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_budgets_period ON fin_budgets(organization_id, year, month)');

  // --- Finance PR #8: recurring templates + system state ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_recurring_templates (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      op_type TEXT NOT NULL CHECK (op_type IN ('income','expense','transfer')),
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CZK',
      account_from_id TEXT REFERENCES finance_accounts(id),
      account_to_id TEXT REFERENCES finance_accounts(id),
      category_id TEXT REFERENCES expense_categories(id),
      project_id TEXT REFERENCES business_units(id),
      counterparty_id TEXT REFERENCES finance_counterparties(id),
      comment TEXT,
      schedule TEXT NOT NULL CHECK (schedule IN ('daily','weekly','monthly','yearly')),
      schedule_day INTEGER,
      next_run_at TEXT NOT NULL,
      end_at TEXT,
      last_run_at TEXT,
      runs_created INTEGER NOT NULL DEFAULT 0,
      -- Чому шаблон не спрацював і скільки разів поспіль (Р13.7). Доти
      -- рушій ловив виняток і мовчки ставив is_active = FALSE: помилка
      -- конфігурації вимикала готелю регулярний платіж, і жодного слова про
      -- це не лишалось ніде, крім логу контейнера, який ніхто не читає.
      failed_runs INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_error_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_rt_org ON fin_recurring_templates(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_rt_next_run ON fin_recurring_templates(next_run_at, is_active)');

  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_system_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // --- Finance PR #7: auto-rules + match log ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_auto_rules (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      op_type TEXT NOT NULL CHECK (op_type IN ('income','expense','any')),
      conditions_json TEXT NOT NULL DEFAULT '[]',
      actions_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      stop_on_match INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      -- Поля правила, чиє посилання веде в чужий довідник (Р13.1). Варта
      -- стоїть на збереженні, але правило могло лягти в базу ДО неї; тоді
      -- спрацювання його пропускає, а готель бачить чому — тут, а не в логу.
      broken_fields TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_ar_org ON fin_auto_rules(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_ar_active ON fin_auto_rules(is_active, sort_order)');

  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_auto_rule_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT NOT NULL REFERENCES fin_auto_rules(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL REFERENCES fin_operations(id) ON DELETE CASCADE,
      matched_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_arm_rule ON fin_auto_rule_matches(rule_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_arm_op ON fin_auto_rule_matches(operation_id)');

  // --- Finance PR #5: flat tags table (cross-cutting labels on operations) ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS finance_tags (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_org_name ON finance_tags(organization_id, LOWER(name))');
  database.exec('CREATE INDEX IF NOT EXISTS idx_tags_org ON finance_tags(organization_id)');

  if (!finOpsMigrated) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS income (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        account_id TEXT REFERENCES finance_accounts(id),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CZK',
        category TEXT,
        counterparty TEXT,
        description TEXT NOT NULL,
        income_date TEXT NOT NULL,
        month TEXT NOT NULL,
        business_unit_id TEXT REFERENCES business_units(id),
        notes TEXT,
        created_by TEXT REFERENCES app_users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_income_org ON income(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_income_date ON income(income_date)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_income_month ON income(month)');

    database.exec(`
      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        from_account_id TEXT REFERENCES finance_accounts(id),
        to_account_id TEXT REFERENCES finance_accounts(id),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CZK',
        transfer_date TEXT NOT NULL,
        notes TEXT,
        created_by TEXT REFERENCES app_users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_transfers_org ON transfers(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_transfers_date ON transfers(transfer_date)');

    try {
      database.exec("ALTER TABLE expenses ADD COLUMN account_id TEXT REFERENCES finance_accounts(id)");
    } catch { /* column already exists */ }
    try {
      database.exec("ALTER TABLE payments ADD COLUMN account_id TEXT REFERENCES finance_accounts(id)");
    } catch { /* column already exists */ }
  }

  // ═══════════════════════════════════════════════════════
  // FINANCE PR #6: UNIFIED fin_operations TABLE
  // One-time hard migration from payments + expenses + income + transfers
  // ═══════════════════════════════════════════════════════
  if (!finOpsMigrated) {
    // 1) Create fin_operations table
    database.exec(`
      CREATE TABLE fin_operations (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

        op_type TEXT NOT NULL CHECK (op_type IN ('income', 'expense', 'transfer')),

        account_from_id TEXT REFERENCES finance_accounts(id),
        account_to_id   TEXT REFERENCES finance_accounts(id),

        amount         REAL NOT NULL,
        currency       TEXT NOT NULL DEFAULT 'CZK',
        amount_to      REAL,
        currency_to    TEXT,
        fx_rate        REAL,
        amount_company REAL NOT NULL,

        paid_at      TEXT NOT NULL,
        accrued_at   TEXT NOT NULL,
        period_from  TEXT,
        period_to    TEXT,

        category_id     TEXT REFERENCES expense_categories(id),
        project_id      TEXT REFERENCES business_units(id),
        counterparty_id TEXT REFERENCES finance_counterparties(id),

        reservation_id  TEXT REFERENCES reservations(id) ON DELETE CASCADE,
        status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','pending','failed','refunded')),
        method          TEXT,
        payment_subtype TEXT,
        -- 0096: рядок у книзі гостя, який СТВОРИЛА ця операція (В3, Р10.6).
        -- Порожньо — операція у фоліо нічого не клала, і видалення її звідти
        -- нічого не знімає. Без цього посилання видалення ручної проводки
        -- бухгалтера забирало з рахунку гостя чужі гроші: реверс не мав чим
        -- відрізнити свій платіж від будь-якого доходу по броні.
        folio_payment_id TEXT,

        comment     TEXT,
        is_planned  INTEGER NOT NULL DEFAULT 0,
        source      TEXT NOT NULL DEFAULT 'manual',
        source_ref  TEXT,

        created_by TEXT REFERENCES app_users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_org ON fin_operations(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_type ON fin_operations(op_type)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_paid ON fin_operations(paid_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_accrued ON fin_operations(accrued_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_acct_from ON fin_operations(account_from_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_acct_to ON fin_operations(account_to_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_reservation ON fin_operations(reservation_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_status ON fin_operations(status)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_source_ref ON fin_operations(source, source_ref)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_category ON fin_operations(category_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_project ON fin_operations(project_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fop_counterparty ON fin_operations(counterparty_id)');

    database.exec(`
      CREATE TABLE fin_operation_tags (
        operation_id TEXT NOT NULL REFERENCES fin_operations(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES finance_tags(id) ON DELETE CASCADE,
        PRIMARY KEY (operation_id, tag_id)
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_fot_tag ON fin_operation_tags(tag_id)');

    // 2) Migration: copy rows from legacy tables.
    // Income → op_type='income'
    database.exec(`
      INSERT INTO fin_operations
        (id, organization_id, op_type, account_to_id, amount, currency, amount_company,
         paid_at, accrued_at, project_id,
         comment, status, source, created_by, created_at, updated_at)
      SELECT
        id, organization_id, 'income', account_id, amount, COALESCE(currency, 'CZK'), amount,
        income_date, income_date, business_unit_id,
        COALESCE(notes, description), 'completed', 'manual', created_by, created_at, updated_at
      FROM income
    `);

    // Expenses → op_type='expense'
    database.exec(`
      INSERT INTO fin_operations
        (id, organization_id, op_type, account_from_id, amount, currency, amount_company,
         paid_at, accrued_at, category_id, project_id,
         comment, method, source, created_by, created_at, updated_at)
      SELECT
        id, organization_id, 'expense', account_id, amount, COALESCE(currency, 'CZK'), amount,
        expense_date, expense_date, category_id, business_unit_id,
        COALESCE(notes, description, counterparty), method, 'manual', created_by, created_at, updated_at
      FROM expenses
    `);

    // Transfers → op_type='transfer'
    database.exec(`
      INSERT INTO fin_operations
        (id, organization_id, op_type, account_from_id, account_to_id,
         amount, currency, amount_company, paid_at, accrued_at,
         comment, source, created_by, created_at, updated_at)
      SELECT
        id, organization_id, 'transfer', from_account_id, to_account_id,
        amount, COALESCE(currency, 'CZK'), amount, transfer_date, transfer_date,
        notes, 'manual', created_by, created_at, created_at
      FROM transfers
    `);

    // Payments → op_type='income' (or 'expense' for refund). Derive source from notes.
    // reservations has no organization_id — pull it through properties.
    database.exec(`
      INSERT INTO fin_operations
        (id, organization_id, op_type, account_from_id, account_to_id,
         amount, currency, amount_company, paid_at, accrued_at,
         reservation_id, status, method, payment_subtype,
         comment, source, source_ref, created_at, updated_at)
      SELECT
        p.id, prop.organization_id,
        CASE WHEN p.type = 'refund' THEN 'expense' ELSE 'income' END,
        CASE WHEN p.type = 'refund' THEN p.account_id ELSE NULL END,
        CASE WHEN p.type = 'refund' THEN NULL ELSE p.account_id END,
        p.amount, COALESCE(p.currency, 'CZK'), p.amount,
        COALESCE(p.paid_at, p.created_at), COALESCE(p.paid_at, p.created_at),
        p.reservation_id, COALESCE(p.status, 'completed'), p.method, p.type,
        p.notes,
        CASE
          WHEN p.auto_created = 1 AND p.notes LIKE '%Hostex%' THEN 'hostex'
          WHEN p.auto_created = 1 AND (p.notes LIKE '%Teya%' OR p.notes LIKE '%Teia%') THEN 'teia'
          WHEN p.auto_created = 1 AND p.method = 'online' THEN 'booking_widget'
          WHEN p.auto_created = 1 THEN 'booking_widget'
          ELSE 'manual'
        END,
        p.reservation_id,
        p.created_at, p.created_at
      FROM payments p
      JOIN reservations r ON p.reservation_id = r.id
      JOIN properties prop ON r.property_id = prop.id
    `);

    // 3) Rename bank_transactions FK: matched_expense_id + matched_payment_id → matched_operation_id
    // PRAGMA on a missing table returns nothing rather than throwing, so the
    // ALTER below would be the thing that fails. bank_transactions no longer
    // exists on a fresh database.
    const btxCols = database.prepare("PRAGMA table_info(bank_transactions)").all() as { name: string }[];
    if (btxCols.length && !btxCols.some((c) => c.name === 'matched_operation_id')) {
      database.exec('ALTER TABLE bank_transactions ADD COLUMN matched_operation_id TEXT REFERENCES fin_operations(id)');
      database.exec(`
        UPDATE bank_transactions
        SET matched_operation_id = COALESCE(matched_expense_id, matched_payment_id)
        WHERE matched_expense_id IS NOT NULL OR matched_payment_id IS NOT NULL
      `);
      database.exec('CREATE INDEX IF NOT EXISTS idx_btx_matched_op ON bank_transactions(matched_operation_id)');
    }

    // 4) Add link-columns to capex_items / accruals / invoices (placeholders for future)
    for (const tbl of ['capex_items', 'accruals', 'invoices']) {
      try {
        const cols = database.prepare(`PRAGMA table_info(${tbl})`).all() as { name: string }[];
        if (!cols.some((c) => c.name === 'fin_operation_id')) {
          database.exec(`ALTER TABLE ${tbl} ADD COLUMN fin_operation_id TEXT REFERENCES fin_operations(id)`);
        }
      } catch { /* table may not exist on fresh DBs */ }
    }

    // 5) Verification. Use the same JOIN chain as the INSERT (payments → reservations → properties)
    const counts = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM income) +
        (SELECT COUNT(*) FROM expenses) +
        (SELECT COUNT(*) FROM transfers) +
        (SELECT COUNT(*) FROM payments p
           JOIN reservations r ON p.reservation_id = r.id
           JOIN properties prop ON r.property_id = prop.id) AS old_total,
        (SELECT COUNT(*) FROM fin_operations) AS new_total
    `).get() as { old_total: number; new_total: number };
    if (counts.old_total !== counts.new_total) {
      throw new Error(`[DB] fin_operations migration count mismatch: old=${counts.old_total}, new=${counts.new_total}`);
    }
    const sums = database.prepare(`
      SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM income) +
        (SELECT COALESCE(SUM(amount), 0) FROM expenses) +
        (SELECT COALESCE(SUM(amount), 0) FROM transfers) +
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
           JOIN reservations r ON p.reservation_id = r.id
           JOIN properties prop ON r.property_id = prop.id) AS old_sum,
        (SELECT COALESCE(SUM(amount), 0) FROM fin_operations) AS new_sum
    `).get() as { old_sum: number; new_sum: number };
    if (Math.abs(sums.old_sum - sums.new_sum) > 0.01) {
      throw new Error(`[DB] fin_operations migration sum mismatch: old=${sums.old_sum}, new=${sums.new_sum}`);
    }
    console.log(`[DB] fin_operations migration verified: ${counts.new_total} rows, sum=${sums.new_sum.toFixed(2)} ✓`);

    // 6) DROP legacy tables
    database.exec('DROP TABLE payments');
    database.exec('DROP TABLE expenses');
    database.exec('DROP TABLE income');
    database.exec('DROP TABLE transfers');
    console.log('[DB] Dropped legacy tables: payments, expenses, income, transfers');
  }

  // ═══════════════════════════════════════════════════════
  // PRICING MODULE
  // ═══════════════════════════════════════════════════════

  // --- Migration: create price_calendar table ---
  //
  // `rate_plan_id` NULL is the unit type's base price — every row written
  // before rate plans reached the calendar, and every row a hotel that sells
  // one rate will ever write. A non-null row is that rate plan's price for
  // that day, and it wins over the base one (§10.11 of docs/CHANNEX-INTEGRATION.md).
  //
  // There is deliberately no `UNIQUE(unit_type_id, rate_plan_id, date)` here:
  // the column is nullable, and UNIQUE does not constrain NULL — in SQLite or
  // in Postgres. Two base rows for the same day would both be accepted and
  // which one priced the night would come down to row order. The unique INDEX
  // with COALESCE below is what actually holds, exactly as
  // `idx_price_occupancy_row` does for the rate card.
  database.exec(`
    CREATE TABLE IF NOT EXISTS price_calendar (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      unit_type_id TEXT NOT NULL REFERENCES unit_types(id) ON DELETE CASCADE,
      rate_plan_id TEXT REFERENCES rate_plans(id),
      date TEXT NOT NULL,
      base_price REAL,
      weekend_price REAL,
      -- Обмеження (0072, Ц32 переглянуто 07.09): nullable і без дефолту. На
      -- рядку ПАРИ NULL означає «як у типу»; базовий рядок писачі заповнюють
      -- явно. Дефолт колонки поставив би новому рядку пари власне значення,
      -- якого ніхто не називав.
      min_stay INTEGER,
      max_stay INTEGER,
      closed INTEGER,
      cta INTEGER,
      ctd INTEGER,
      -- Звідки ціна цього дня (Блок 2 крок 1, Ц27): season — розгорнута з
      -- клітинки сезону; manual — редактор дня чи масовий, тобто точкове
      -- перевизначення, яке перерендер сезону НЕ затирає; import — файл
      -- готелю. Обмеження джерела не мають — вони живуть на рядку типу.
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('season', 'manual', 'import', 'derived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // І в CREATE, і тут (AGENTS §4): наявна база дістає колонку ALTER-ом, усі
  // старі рядки — «manual»: набрані рукою до сезонів і є перевизначеннями.
  try {
    const pcCols = (database.prepare('PRAGMA table_info(price_calendar)').all() as any[]).map((c: any) => c.name);
    if (!pcCols.includes('source')) {
      database.exec("ALTER TABLE price_calendar ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('season', 'manual', 'import', 'derived'))");
      console.log('[DB] Added source to price_calendar (0068)');
    }
  } catch (e: any) {
    console.error('[DB] price_calendar source:', e.message);
  }

  // --- Migration 0069: `derived` серед джерел ціни (Блок 2 крок 2, Ц28) ---
  //
  // База, що дістала CHECK на `source` з 0068 без «derived», не може прийняти
  // рядок похідного тарифу — а розширити CHECK у SQLite можна лише
  // перебудовою. Правило AGENTS §4: sql індексів знімається до підміни,
  // повертається після, лічильники рядків і індексів звіряються — саме так
  // уже двічі зникав унікальний індекс на гостьовий токен і три індекси
  // `accruals`. Свіжа база сюди не потрапляє: її CREATE вище вже з «derived».
  try {
    const pcCreate = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='price_calendar'").get() as { sql?: string } | undefined)?.sql ?? '';
    if (pcCreate.includes('CHECK (source IN') && !pcCreate.includes("'derived'")) {
      console.log('[DB] price_calendar: source CHECK → + derived (0069) — перебудова зі збереженням індексів');
      const before = (database.prepare('SELECT COUNT(*) AS n FROM price_calendar').get() as { n: number }).n;
      const indexSql = (database.prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='price_calendar' AND sql IS NOT NULL",
      ).all() as { sql: string }[]).map((r) => r.sql);
      const live = (database.prepare('PRAGMA table_info(price_calendar)').all() as { name: string }[]).map((c) => c.name);
      const carried = [
        'id', 'unit_type_id', 'rate_plan_id', 'date', 'base_price', 'weekend_price',
        'min_stay', 'max_stay', 'closed', 'cta', 'ctd', 'source', 'created_at', 'updated_at',
      ].filter((c) => live.includes(c));

      database.exec('PRAGMA foreign_keys = OFF');
      database.exec(`
        CREATE TABLE price_calendar_new (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          unit_type_id TEXT NOT NULL REFERENCES unit_types(id) ON DELETE CASCADE,
          rate_plan_id TEXT REFERENCES rate_plans(id),
          date TEXT NOT NULL,
          base_price REAL,
          weekend_price REAL,
          min_stay INTEGER,
          max_stay INTEGER,
          closed INTEGER,
          cta INTEGER,
          ctd INTEGER,
          source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('season', 'manual', 'import', 'derived')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      database.exec(`INSERT INTO price_calendar_new (${carried.join(', ')}) SELECT ${carried.join(', ')} FROM price_calendar`);
      database.exec('DROP TABLE price_calendar');
      database.exec('ALTER TABLE price_calendar_new RENAME TO price_calendar');
      for (const sql of indexSql) database.exec(sql);
      database.exec('PRAGMA foreign_keys = ON');

      const after = (database.prepare('SELECT COUNT(*) AS n FROM price_calendar').get() as { n: number }).n;
      if (after !== before) throw new Error(`price_calendar rebuild lost rows: ${before} -> ${after}`);
      const restored = (database.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name='price_calendar' AND sql IS NOT NULL",
      ).get() as { n: number }).n;
      if (restored !== indexSql.length) throw new Error(`price_calendar rebuild lost indexes: ${indexSql.length} -> ${restored}`);
      console.log(`[DB] price_calendar rebuilt with source 'derived' allowed (${after} rows, ${restored} indexes carried)`);
    }
  } catch (e: any) {
    console.error('[DB] price_calendar source derived migration error:', e.message);
  }

  // --- Migration 0072: обмеження на ПАРІ — колонки nullable без дефолту ---
  //
  // Ц32 переглянуто 07.09: ефективне обмеження пари = рядок пари, якщо
  // задано, інакше базовий рядок типу. NOT NULL DEFAULT на колонках робив би
  // кожен новий рядок пари носієм «власного» дефолту. SQLite не вміє DROP NOT
  // NULL — перебудова за правилом AGENTS §4 (індекси зняти й повернути,
  // лічильники звірити), а рядки пар, що несли дефолти таблиці (їх ніхто не
  // читав — A1), обнуляються один раз, разом із перебудовою.
  try {
    const cols = database.prepare('PRAGMA table_info(price_calendar)').all() as { name: string; notnull: number }[];
    const minStay = cols.find((c) => c.name === 'min_stay');
    if (minStay && Number(minStay.notnull) === 1) {
      console.log('[DB] price_calendar: обмеження стають nullable (0072) — перебудова зі збереженням індексів');
      const before = (database.prepare('SELECT COUNT(*) AS n FROM price_calendar').get() as { n: number }).n;
      const indexSql = (database.prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='price_calendar' AND sql IS NOT NULL",
      ).all() as { sql: string }[]).map((r) => r.sql);
      const live = cols.map((c) => c.name);
      const carried = [
        'id', 'unit_type_id', 'rate_plan_id', 'date', 'base_price', 'weekend_price',
        'min_stay', 'max_stay', 'closed', 'cta', 'ctd', 'source', 'created_at', 'updated_at',
      ].filter((c) => live.includes(c));
      database.exec('PRAGMA foreign_keys = OFF');
      database.exec(`
        CREATE TABLE price_calendar_new (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          unit_type_id TEXT NOT NULL REFERENCES unit_types(id) ON DELETE CASCADE,
          rate_plan_id TEXT REFERENCES rate_plans(id),
          date TEXT NOT NULL,
          base_price REAL,
          weekend_price REAL,
          min_stay INTEGER,
          max_stay INTEGER,
          closed INTEGER,
          cta INTEGER,
          ctd INTEGER,
          source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('season', 'manual', 'import', 'derived')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      database.exec(`INSERT INTO price_calendar_new (${carried.join(', ')}) SELECT ${carried.join(', ')} FROM price_calendar`);
      database.exec('DROP TABLE price_calendar');
      database.exec('ALTER TABLE price_calendar_new RENAME TO price_calendar');
      for (const sql of indexSql) database.exec(sql);
      database.exec('PRAGMA foreign_keys = ON');
      const after = (database.prepare('SELECT COUNT(*) AS n FROM price_calendar').get() as { n: number }).n;
      if (after !== before) throw new Error(`price_calendar rebuild lost rows: ${before} -> ${after}`);
      const restored = (database.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name='price_calendar' AND sql IS NOT NULL",
      ).get() as { n: number }).n;
      if (restored !== indexSql.length) throw new Error(`price_calendar rebuild lost indexes: ${indexSql.length} -> ${restored}`);
      const nulled = database.prepare(
        'UPDATE price_calendar SET min_stay = NULL, max_stay = NULL, closed = NULL, cta = NULL, ctd = NULL WHERE rate_plan_id IS NOT NULL',
      ).run().changes;
      console.log(`[DB] price_calendar rebuilt with nullable restrictions (${after} rows, ${restored} indexes carried, ${nulled} pair rows reset to «як у типу»)`);
    }
  } catch (e: any) {
    console.error('[DB] price_calendar nullable restrictions migration error:', e.message);
  }

  // --- Migration: drop the old UNIQUE(unit_type_id, date) from price_calendar ---
  //
  // This one cannot be an ALTER. SQLite has no DROP CONSTRAINT, so a table
  // constraint is removed the only way there is: build the new shape, copy,
  // drop, rename. Postgres gets the same change as a one-line
  // `ALTER TABLE ... DROP CONSTRAINT` in migration 0048.
  //
  // Leaving it in place would not fail loudly. The second rate plan's price
  // for a day already carrying the base price would be rejected as a
  // duplicate — on a customer's database, at the first INSERT the new screen
  // makes, with a constraint error nobody reads as "the schema is a version
  // behind". A fresh database created after this commit never has the
  // constraint at all, which is precisely why it has to be removed by name
  // here rather than assumed gone.
  try {
    const pcSql = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='price_calendar'",
    ).get() as { sql?: string } | undefined;

    if (pcSql?.sql && /UNIQUE\s*\(\s*unit_type_id\s*,\s*date\s*\)/i.test(pcSql.sql)) {
      console.log('[DB] price_calendar: removing UNIQUE(unit_type_id, date) — rate plans need two rows per day');
      const before = (database.prepare('SELECT COUNT(*) AS n FROM price_calendar').get() as { n: number }).n;

      // Copy whatever the live table actually holds, not what this file
      // remembers it holding: a column added by a later migration would
      // otherwise be silently dropped on the way through.
      const live = (database.prepare('PRAGMA table_info(price_calendar)').all() as { name: string }[])
        .map((c) => c.name);
      const carried = [
        'id', 'unit_type_id', 'rate_plan_id', 'date', 'base_price', 'weekend_price',
        'min_stay', 'max_stay', 'closed', 'cta', 'ctd', 'created_at', 'updated_at',
      ].filter((c) => live.includes(c));

      database.exec('PRAGMA foreign_keys = OFF');
      database.exec(`
        CREATE TABLE price_calendar_new (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          unit_type_id TEXT NOT NULL REFERENCES unit_types(id) ON DELETE CASCADE,
          rate_plan_id TEXT REFERENCES rate_plans(id),
          date TEXT NOT NULL,
          base_price REAL,
          weekend_price REAL,
          min_stay INTEGER,
          max_stay INTEGER,
          closed INTEGER,
          cta INTEGER,
          ctd INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      database.exec(
        `INSERT INTO price_calendar_new (${carried.join(', ')}) SELECT ${carried.join(', ')} FROM price_calendar`,
      );
      database.exec('DROP TABLE price_calendar');
      database.exec('ALTER TABLE price_calendar_new RENAME TO price_calendar');
      database.exec('PRAGMA foreign_keys = ON');

      // A rebuild that loses rows is worse than the constraint it removed.
      const after = (database.prepare('SELECT COUNT(*) AS n FROM price_calendar').get() as { n: number }).n;
      if (after !== before) {
        throw new Error(`price_calendar rebuild lost rows: ${before} -> ${after}`);
      }
      console.log(`[DB] price_calendar rebuilt without the old UNIQUE (${after} rows carried)`);
    }
  } catch (e: any) {
    console.error('[DB] price_calendar UNIQUE migration error:', e.message);
  }

  // --- Migration: add rate_plan_id to price_calendar ---
  // The upgrade path for a database whose table was already rebuilt (or never
  // carried the constraint). Both halves exist on purpose: AGENTS.md §4 — a
  // column goes into the CREATE *and* the ALTER, or the next new customer
  // gets a schema the code reads a missing column from.
  try {
    const pcCols = database.prepare('PRAGMA table_info(price_calendar)').all() as { name: string }[];
    if (!pcCols.some((c) => c.name === 'rate_plan_id')) {
      database.exec('ALTER TABLE price_calendar ADD COLUMN rate_plan_id TEXT REFERENCES rate_plans(id)');
      console.log('[DB] Added rate_plan_id to price_calendar');
    }
  } catch (e: any) {
    console.log('[DB] price_calendar.rate_plan_id migration note:', e.message);
  }

  // --- Migration 0062: base_price nullable — ціни немає це NULL, не 0 ---
  //
  // 05.09.2026, бета: оператор поставив «мін. 2 ночі» на день без ціни, і
  // редактор дня записав `base_price = 0`, бо колонка була NOT NULL DEFAULT 0.
  // Нуль — це ціна: котирування продало б ніч за 0, батчер відправив 0 у
  // канал, звірка сказала «збігається». Відсутність ціни тепер NULL — ніч у
  // `missing`, обмеження лишається (інваріант 17). SQLite не вміє зняти NOT
  // NULL, тож таблиця перебудовується — за правилом AGENTS §4: sql індексів
  // знімається до підміни, повертається після, лічильник звіряється. Наявні
  // нулі стають NULL: жоден із них не був названою ціною — редактор дня писав
  // їх сам за оператора.
  try {
    const priceCol = (database.prepare('PRAGMA table_info(price_calendar)').all() as { name: string; notnull: number }[])
      .find((c) => c.name === 'base_price');
    if (priceCol && priceCol.notnull === 1) {
      console.log('[DB] price_calendar: base_price → nullable (0062) — обмеження без ціни більше не записує нуль');
      const before = (database.prepare('SELECT COUNT(*) AS n FROM price_calendar').get() as { n: number }).n;
      const indexSql = (database.prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='price_calendar' AND sql IS NOT NULL",
      ).all() as { sql: string }[]).map((r) => r.sql);
      const live = (database.prepare('PRAGMA table_info(price_calendar)').all() as { name: string }[]).map((c) => c.name);
      const carried = [
        'id', 'unit_type_id', 'rate_plan_id', 'date', 'base_price', 'weekend_price',
        'min_stay', 'max_stay', 'closed', 'cta', 'ctd', 'created_at', 'updated_at',
      ].filter((c) => live.includes(c));

      database.exec('PRAGMA foreign_keys = OFF');
      database.exec(`
        CREATE TABLE price_calendar_new (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          unit_type_id TEXT NOT NULL REFERENCES unit_types(id) ON DELETE CASCADE,
          rate_plan_id TEXT REFERENCES rate_plans(id),
          date TEXT NOT NULL,
          base_price REAL,
          weekend_price REAL,
          min_stay INTEGER,
          max_stay INTEGER,
          closed INTEGER,
          cta INTEGER,
          ctd INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      database.exec(`INSERT INTO price_calendar_new (${carried.join(', ')}) SELECT ${carried.join(', ')} FROM price_calendar`);
      database.exec('DROP TABLE price_calendar');
      database.exec('ALTER TABLE price_calendar_new RENAME TO price_calendar');
      for (const sql of indexSql) database.exec(sql);
      database.exec('PRAGMA foreign_keys = ON');

      const after = (database.prepare('SELECT COUNT(*) AS n FROM price_calendar').get() as { n: number }).n;
      if (after !== before) throw new Error(`price_calendar rebuild lost rows: ${before} -> ${after}`);
      const restored = (database.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name='price_calendar' AND sql IS NOT NULL",
      ).get() as { n: number }).n;
      if (restored !== indexSql.length) throw new Error(`price_calendar rebuild lost indexes: ${indexSql.length} -> ${restored}`);
      const zeroed = database.prepare('UPDATE price_calendar SET base_price = NULL WHERE base_price = 0').run().changes;
      console.log(`[DB] price_calendar rebuilt with nullable base_price (${after} rows, ${restored} indexes carried, ${zeroed} zero prices → NULL)`);
    }
  } catch (e: any) {
    console.error('[DB] price_calendar base_price nullable migration error:', e.message);
  }

  // --- Migration 0064: weekend_price 0 → NULL — ціна вихідних нуль теж не ціна ---
  //
  // 0062 прибрала нулі лише з `base_price`; нуль у `weekend_price` читався
  // як ціна пʼятниці–неділі. Читач тепер трактує 0 як «немає» сам
  // (`nightly-price.ts dayPrice`), а тут прибирається саме число — щоб екран
  // цін не показував 0 там, де ціни вихідних немає. Ідемпотентно.
  try {
    const zeroWeekend = database.prepare('UPDATE price_calendar SET weekend_price = NULL WHERE weekend_price <= 0').run().changes;
    if (zeroWeekend > 0) console.log(`[DB] price_calendar: ${zeroWeekend} zero weekend prices → NULL (0064)`);
  } catch (e: any) {
    console.error('[DB] price_calendar weekend_price zero migration error:', e.message);
  }

  database.exec('CREATE INDEX IF NOT EXISTS idx_price_cal_ut ON price_calendar(unit_type_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_price_cal_date ON price_calendar(date)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_price_cal_ut_date ON price_calendar(unit_type_id, date)');
  // What the dropped UNIQUE used to hold, now holding the nullable column too.
  // `''` stands in for "no rate plan" and is safe here because the column is
  // TEXT on both engines — `price_occupancy` needed date sentinels instead
  // only because Postgres types its columns DATE.
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_price_calendar_row
      ON price_calendar(unit_type_id, (COALESCE(rate_plan_id, '')), date)
  `);

  // --- Migration 0068: сезони (Блок 2 крок 1, Ц27) ---
  //
  // Сезон — сутність обʼєкта з датами (обидві межі включно, NAMING §2), і
  // клітинка ціни на сезон × тип × тариф. Клітинка НЕ джерело ціни для
  // котирування: вона РЕНДЕРИТЬСЯ в price_calendar тим самим писачем, що
  // масовий редактор (двері каналу, маска полів), а котирування читає
  // календар, як і досі — інваріант 16 цілий, канал і віджет читають те
  // саме. rate_plan_id NULL у клітинці — базова ціна типу в сезоні.
  // Сезони одного обʼєкта не перетинаються — тримає писач (гейт
  // seasons.repo.check), не схема: інтервальне обмеження на SQLite не сказати.
  database.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      date_from       TEXT NOT NULL,
      date_to         TEXT NOT NULL,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_seasons_org ON seasons(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_seasons_property ON seasons(property_id, date_from)');
  database.exec(`
    CREATE TABLE IF NOT EXISTS season_prices (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      season_id       TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      unit_type_id    TEXT NOT NULL REFERENCES unit_types(id) ON DELETE CASCADE,
      rate_plan_id    TEXT REFERENCES rate_plans(id) ON DELETE CASCADE,
      price           REAL NOT NULL,
      weekend_price   REAL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_season_prices_org ON season_prices(organization_id)');
  // Одна клітинка на сезон × тип × тариф; COALESCE — бо UNIQUE не обмежує
  // NULL (та сама пастка, що idx_price_calendar_row).
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_season_prices_cell
      ON season_prices(season_id, unit_type_id, (COALESCE(rate_plan_id, '')))
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_price_cal_rate_plan ON price_calendar(rate_plan_id)');

  // ═══════════════════════════════════════════════════════
  // CHANNEL MANAGER MODULE
  // ═══════════════════════════════════════════════════════
  //
  // Five tables used to be created here — channel_connections,
  // channel_room_mapping, ari_sync_queue, ari_sync_log, plus seven columns
  // bolted onto `reservations` — for the Connectivity API of Booking.com. That
  // integration was never connected to a live account and has been deleted;
  // migration 0032 drops the tables on Postgres and tells the story.
  //
  // channel_credentials stays, and stays here, because it outlived its origin:
  // the German fiscalisation keys live in it (@core/integration-credentials).

  database.exec(`
    CREATE TABLE IF NOT EXISTS channel_credentials (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'test',
      client_id TEXT NOT NULL DEFAULT '',
      client_secret TEXT NOT NULL DEFAULT '',
      access_token TEXT,
      token_expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(organization_id, channel, environment)
    )
  `);

  // Three of the seven Booking.com columns survive on their own merits: the
  // booking widget writes promotions_applied, and the CSV export reads
  // meal_plan and cancellation_policy. The other four were the wire format of
  // an API nobody ever spoke to.
  try {
    database.exec("ALTER TABLE reservations ADD COLUMN promotions_applied TEXT");
  } catch { /* column already exists */ }
  try {
    database.exec("ALTER TABLE reservations ADD COLUMN cancellation_policy TEXT");
  } catch { /* column already exists */ }
  try {
    database.exec("ALTER TABLE reservations ADD COLUMN meal_plan TEXT");
  } catch { /* column already exists */ }

  // --- Migration: add unit_type_id to reservations ---
  // A booking from an OTA arrives on a category, not on a room: Channex names
  // a room type, and which physical room the guest gets is the hotel's to
  // decide. `unit_id NOT NULL` left such a booking nowhere to go, so the raw
  // revision sat in the inbox and could never be reconciled against
  // `reservations` (§2.3 blocker 3 of docs/CHANNEX-INTEGRATION.md).
  //
  // The column only records the answer. No rule picks a room from the type —
  // that is phase 5, and inventing one here would quietly assign rooms in
  // every hotel on the server without anyone having asked for it.
  try {
    database.exec("ALTER TABLE reservations ADD COLUMN unit_type_id TEXT REFERENCES unit_types(id)");
  } catch { /* column already exists */ }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_reservations_unit_type ON reservations(unit_type_id)');
  } catch { /* index already exists */ }

  // --- Migration: add city_tax fields to reservations ---
  //
  // ЩО ТУТ ОЗНАЧАЄ `total_price` — це було неоднозначно, і саме тому
  // питання поставили вголос (31.08.2026). Відповідь прив'язана до
  // прапорця, а не окрема:
  //
  //   city_tax_included = 1  →  total_price ALL-IN: збір УСЕРЕДИНІ суми
  //   city_tax_included = 0  →  total_price БЕЗ збору: він поруч, окремо
  //
  // Тобто `total_price` — це те, що гість платить ЧЕРЕЗ ЦЕЙ КАНАЛ, а чи
  // входить туди збір, каже канал: `booking_sources.city_tax_included_default`
  // засіває прапорець за джерелом (Booking з інклюзивним налаштуванням і
  // Airbnb, який окремого поняття збору не має, → 1; пряма броня → 0, гість
  // платить на місці й `city_tax_paid` лишається 'pending').
  //
  // На ДОКУМЕНТІ це не змінює нічого: збір там завжди окремий рядок без
  // ПДВ. Керує цим `fin_folio_items.kind = 'city_tax'` із `vat_rate = 0`, а
  // не цей прапорець — прапорець лише каже `postStayCharges`, вирізати збір
  // із суми чи додати до неї. Дві різні речі, обидві потрібні.
  //
  // Прапорці тут INTEGER, не BOOLEAN: міграція 0046 перевела вісім колонок,
  // ці до неї не входили. Тому в SQL їх порівнюють з 1/0, а не з TRUE —
  // тримає check-boolean-flags.
  try {
    database.exec("ALTER TABLE reservations ADD COLUMN city_tax_amount REAL DEFAULT 0");
  } catch { /* column already exists */ }
  try {
    database.exec("ALTER TABLE reservations ADD COLUMN city_tax_included INTEGER DEFAULT 0");
  } catch { /* column already exists */ }
  try {
    database.exec("ALTER TABLE reservations ADD COLUMN city_tax_paid TEXT DEFAULT 'pending'");
  } catch { /* column already exists */ }

  // --- Migration: add city_tax_included_default to booking_sources ---
  try {
    database.exec("ALTER TABLE booking_sources ADD COLUMN city_tax_included_default INTEGER DEFAULT 0");
  } catch { /* column already exists */ }

  // --- Migration: booking_activity_log table ---
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS booking_activity_log (
        id TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
      )
    `);
  } catch { /* already exists */ }

  // --- Migration: add internal_notes to reservations ---
  try {
    database.exec("ALTER TABLE reservations ADD COLUMN internal_notes TEXT");
  } catch { /* column already exists */ }

  // --- Migration: guest_registrations table (multi-guest per reservation) ---
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS guest_registrations (
        id TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL,
        guest_id TEXT NOT NULL,
        is_primary INTEGER DEFAULT 0,
        registered_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        reg_status TEXT NOT NULL DEFAULT 'not_started',
        FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
        FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE
      )
    `);
  } catch { /* already exists */ }

  // --- Migration: add registration_status to reservations ---
  try {
    database.exec("ALTER TABLE reservations ADD COLUMN registration_status TEXT DEFAULT 'not_registered'");
  } catch { /* column already exists */ }

  // --- Migration: add nationality to guests ---
  try {
    database.exec("ALTER TABLE guests ADD COLUMN nationality TEXT");
  } catch { /* column already exists */ }

  // ═══════════════════════════════════════════════════════
  // CRM MODULE
  // ═══════════════════════════════════════════════════════

  // --- Migration: add whatsapp to guests for sync with leads ---
  const guestCols2 = database.prepare("PRAGMA table_info(guests)").all().map((c: any) => c.name);
  if (!guestCols2.includes('whatsapp')) {
    try { database.exec("ALTER TABLE guests ADD COLUMN whatsapp TEXT"); } catch { /* */ }
  }
  if (!guestCols2.includes('language')) {
    try { database.exec("ALTER TABLE guests ADD COLUMN language TEXT"); } catch { /* */ }
  }

  // --- Migration: property_guest_config (shared property-level settings) ---
  const pgcExists = database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='property_guest_config'"
  ).get();
  if (!pgcExists) {
    database.exec(`
      CREATE TABLE property_guest_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        property_id TEXT NOT NULL UNIQUE REFERENCES properties(id) ON DELETE CASCADE,
        wifi_network TEXT,
        wifi_password TEXT,
        restaurant_name TEXT,
        restaurant_hours TEXT,
        restaurant_menu_url TEXT,
        rules TEXT,
        useful_info TEXT,
        faq_items TEXT,
        maps_url TEXT,
        territory_map_url TEXT,
        pets_policy TEXT DEFAULT 'welcome',
        parking_info TEXT,
        video_guide_url TEXT,
        emergency_phone TEXT,
        weather_lat REAL,
        weather_lon REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        parking_photo_url TEXT,
        parking_maps_url TEXT,
        whatsapp_phone TEXT
      )
    `);
    // Seed from first existing guest_page_config
    try {
      const firstCfg = database.prepare('SELECT * FROM guest_page_config LIMIT 1').get() as any;
      const props = database.prepare('SELECT id FROM properties').all() as any[];
      if (firstCfg && props.length > 0) {
        for (const p of props) {
          database.prepare(`
            INSERT INTO property_guest_config (property_id, wifi_network, wifi_password, restaurant_name, restaurant_hours, restaurant_menu_url, rules, useful_info, faq_items, maps_url, territory_map_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(p.id, firstCfg.wifi_network, firstCfg.wifi_password, firstCfg.restaurant_name, firstCfg.restaurant_hours, firstCfg.restaurant_menu_url, firstCfg.rules, firstCfg.useful_info, firstCfg.faq_items, firstCfg.maps_url, firstCfg.territory_map_url);
        }
      }
    } catch { /* seed silently */ }
    console.log('[DB] Created property_guest_config table');
  }

  // The route to the parking is its own link (mirror of Postgres 0029).
  // ALTER after the CREATE above — on a fresh database the table is created
  // with the column already in place and this block is a no-op; an ALTER
  // that runs before its CREATE breaks a fresh bootstrap.
  try {
    const pgcCols = (database.prepare('PRAGMA table_info(property_guest_config)').all() as any[]).map((c: any) => c.name);
    if (!pgcCols.includes('parking_maps_url')) {
      database.exec('ALTER TABLE property_guest_config ADD COLUMN parking_maps_url TEXT');
      console.log('[DB] Added parking_maps_url to property_guest_config');
    }
  } catch (e: any) {
    console.log('[DB] parking_maps_url migration note:', e.message);
  }

  // The WhatsApp number belongs to the hotel (mirror of Postgres 0033). It was
  // a literal in the guest page — one number for every hotel on the platform —
  // so a guest tapping the most prominent button on that page reached the pilot
  // hotel's owner. ALTER after the CREATE above, same reason as the block
  // before it.
  try {
    const pgcCols = (database.prepare('PRAGMA table_info(property_guest_config)').all() as any[]).map((c: any) => c.name);
    if (!pgcCols.includes('whatsapp_phone')) {
      database.exec('ALTER TABLE property_guest_config ADD COLUMN whatsapp_phone TEXT');
      console.log('[DB] Added whatsapp_phone to property_guest_config');
    }
  } catch (e: any) {
    console.log('[DB] whatsapp_phone migration note:', e.message);
  }

  // `guest_chat_messages` тут БУЛА і не створюється більше.
  //
  // Листування гостя й готелю мало жити в ній — і не жило: таблиця
  // створювалась, індексувалась і жоден рядок коду її не читав і не писав.
  // Приїхала разом із мостом Hostex, який видалений; чат гостя, коли він
  // зʼявиться, буде іншим і матиме свою таблицю. Порожня таблиця з чужої
  // інтеграції — не заготовка, а обіцянка, яку читає наступний.
  // Прибирає міграція 0043.

  // --- Migration: add pets_policy, entry_photo_url to guest_page_config ---
  try {
    const gpcCols2 = database.prepare("PRAGMA table_info(guest_page_config)").all().map((c: any) => c.name);
    if (!gpcCols2.includes('pets_policy')) {
      database.exec("ALTER TABLE guest_page_config ADD COLUMN pets_policy TEXT DEFAULT 'welcome'");
    }
    if (!gpcCols2.includes('entry_photo_url')) {
      database.exec("ALTER TABLE guest_page_config ADD COLUMN entry_photo_url TEXT");
    }
  } catch { /* ok */ }

  // --- Migration: content_translations table (pre-computed translations) ---
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS content_translations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text_hash TEXT NOT NULL,
        source_text TEXT NOT NULL,
        lang TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(text_hash, lang)
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_ct_hash ON content_translations(text_hash)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_ct_lang ON content_translations(text_hash, lang)');
  } catch { /* ok */ }

  // ═══════════════════════════════════════════════════════
  // CRITICAL FIX: Recreate payments table with extended CHECK constraints
  // Old table rejected type='service' (Teya) and method='booking_platform' (Hostex)
  // causing INSERT OR IGNORE to silently discard payment records
  // Skipped after PR #6 — payments table no longer exists, replaced by fin_operations.
  // ═══════════════════════════════════════════════════════
  // finOpsMigrated was read before PR #6 ran in THIS process — probe the
  // table itself, or on a fresh boot this recreated a table dropped a moment
  // earlier and logged an error every time.
  const paymentsStillExists = !!database.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='payments'"
  ).get();
  if (!finOpsMigrated && paymentsStillExists) try {
    // Check if payments table has restrictive CHECK by trying an insert with 'service' type
    const testId = '_check_test_' + Date.now();
    const testRes = database.prepare("SELECT id FROM reservations LIMIT 1").get() as any;
    if (testRes) {
      try {
        database.prepare(
          "INSERT INTO payments (id, reservation_id, amount, currency, method, type, status) VALUES (?, ?, 0, 'CZK', 'online', 'service', 'pending')"
        ).run(testId, testRes.id);
        // If it succeeded, constraint is already OK — clean up
        database.prepare("DELETE FROM payments WHERE id = ?").run(testId);
      } catch {
        // CHECK constraint blocked 'service' type — need to recreate table
        console.log('[DB] Recreating payments table with extended CHECK constraints...');
        database.exec(`
          CREATE TABLE payments_new (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CZK',
            method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'invoice', 'online', 'booking_platform')),
            type TEXT NOT NULL CHECK (type IN ('deposit', 'full', 'partial', 'refund', 'service')),
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
            paid_at TEXT,
            notes TEXT,
            auto_created INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        // Copy all existing data
        const cols = (database.prepare("PRAGMA table_info(payments)").all() as any[]).map((c: any) => c.name);
        const hasAutoCreated = cols.includes('auto_created');
        const selectCols = hasAutoCreated
          ? 'id, reservation_id, amount, currency, method, type, status, paid_at, notes, auto_created, created_at'
          : 'id, reservation_id, amount, currency, method, type, status, paid_at, notes, 0, created_at';
        database.exec(`INSERT INTO payments_new (id, reservation_id, amount, currency, method, type, status, paid_at, notes, auto_created, created_at) SELECT ${selectCols} FROM payments`);
        database.exec('DROP TABLE payments');
        database.exec('ALTER TABLE payments_new RENAME TO payments');
        console.log('[DB] Payments table recreated with service/booking_platform support');
      }
    }
  } catch (e: any) {
    console.error('[DB] Payments migration error:', e.message);
  }

  // ═══════════════════════════════════════════════════════
  // BOOKING SITES MODULE
  // ═══════════════════════════════════════════════════════

  // --- Migration: create booking_sites table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS booking_sites (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      slug          TEXT,
      site_url      TEXT,
      type          TEXT NOT NULL DEFAULT 'widget'
                      CHECK (type IN ('widget', 'self-hosted')),
      currency      TEXT NOT NULL DEFAULT 'CZK',
      status        TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'paused', 'deleted')),
      design_config TEXT,
      widget_config TEXT,
      created_by    TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_booking_sites_property ON booking_sites(property_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_booking_sites_status ON booking_sites(status)');

  // --- Migration: add slug and site_url to booking_sites if missing ---
  try {
    const bsCols = database.prepare("PRAGMA table_info(booking_sites)").all().map((c: any) => c.name);
    if (!bsCols.includes('slug')) {
      database.exec("ALTER TABLE booking_sites ADD COLUMN slug TEXT");
      // Generate slugs for existing sites
      const sites = database.prepare("SELECT id, name FROM booking_sites").all() as any[];
      const upd = database.prepare("UPDATE booking_sites SET slug = ? WHERE id = ?");
      for (const s of sites) {
        const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        upd.run(slug || s.id, s.id);
      }
      database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_sites_slug ON booking_sites(slug)");
      console.log('[DB] Added slug to booking_sites');
    } else {
      // For fresh DBs or already migrated ones, just ensure index exists
      database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_sites_slug ON booking_sites(slug)");
    }
    if (!bsCols.includes('site_url')) {
      database.exec("ALTER TABLE booking_sites ADD COLUMN site_url TEXT");
      console.log('[DB] Added site_url to booking_sites');
    }
    // The public entry point names its own organization.
    //
    // A guest is not a tenant: the widget arrives with a site key and nothing
    // else, and finding the row is HOW the hotel is discovered — the same
    // chicken-and-egg as login. Under row-level security that lookup has to be
    // readable before any organization is set, and reaching one through
    // property_id meant opening `properties` to anonymous reads as well: the
    // name, city and address of every hotel on the server. One self-describing
    // column keeps the exception to a single table.
    if (!bsCols.includes('organization_id')) {
      database.exec("ALTER TABLE booking_sites ADD COLUMN organization_id TEXT REFERENCES organizations(id)");
      database.exec(`
        UPDATE booking_sites SET organization_id = (
          SELECT p.organization_id FROM properties p WHERE p.id = booking_sites.property_id
        )
      `);
      database.exec('CREATE INDEX IF NOT EXISTS idx_booking_sites_org ON booking_sites(organization_id)');
      console.log('[DB] booking_sites names its own organization');
    }
    if (!bsCols.includes('payment_config')) {
      database.exec("ALTER TABLE booking_sites ADD COLUMN payment_config TEXT");
      console.log('[DB] Added payment_config to booking_sites');
    }
  } catch (e: any) {
    console.log('[DB] booking_sites extension note:', e.message);
  }

  // --- Migration: create site_listings table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS site_listings (
      id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      site_id            TEXT NOT NULL REFERENCES booking_sites(id) ON DELETE CASCADE,
      unit_id            TEXT REFERENCES units(id)      ON DELETE CASCADE,
      unit_type_id       TEXT REFERENCES unit_types(id) ON DELETE CASCADE,
      price_override     REAL,
      rules_override     TEXT,
      has_rules_override INTEGER NOT NULL DEFAULT 0,
      max_inventory      INTEGER,
      external_url       TEXT,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      photos TEXT
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_site_listings_site ON site_listings(site_id)');
  try { database.exec('ALTER TABLE site_listings ADD COLUMN thank_you_url TEXT'); } catch { /* already exists */ }
  try { database.exec('ALTER TABLE site_listings ADD COLUMN default_lang TEXT'); } catch { /* already exists */ }

  // --- Migration: create site_rate_plans table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS site_rate_plans (
      id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      site_id                 TEXT NOT NULL REFERENCES booking_sites(id) ON DELETE CASCADE,
      name                    TEXT NOT NULL,
      is_default              INTEGER NOT NULL DEFAULT 0,
      cancellation_policy     TEXT NOT NULL DEFAULT 'non_refundable'
                                CHECK (cancellation_policy IN ('non_refundable', 'full_refund', 'flexible')),
      payment_schedule        TEXT NOT NULL DEFAULT '[{"percent": 100, "trigger": "on_booking"}]',
      meals_included          TEXT NOT NULL DEFAULT '[]',
      min_days_before_checkin INTEGER NOT NULL DEFAULT 0,
      same_day_cutoff_hour    INTEGER,
      min_stay                INTEGER NOT NULL DEFAULT 1,
      max_stay                INTEGER NOT NULL DEFAULT 999,
      pricing_mode            TEXT NOT NULL DEFAULT 'independent'
                                CHECK (pricing_mode IN ('independent', 'dependent')),
      applied_listings        TEXT NOT NULL DEFAULT '[]',
      is_active               INTEGER NOT NULL DEFAULT 1,
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_site_rate_plans_site ON site_rate_plans(site_id)');

  // --- Migration: add pricing dependent fields to site_rate_plans ---
  try { database.exec('ALTER TABLE site_rate_plans ADD COLUMN pricing_modifier_percent REAL'); } catch { /* */ }
  try { database.exec("ALTER TABLE site_rate_plans ADD COLUMN pricing_modifier_type TEXT DEFAULT 'less'"); } catch { /* */ }
  try { database.exec('ALTER TABLE site_rate_plans ADD COLUMN derived_from_plan_id TEXT'); } catch { /* */ }
  try { database.exec('ALTER TABLE site_rate_plans ADD COLUMN valid_weekdays TEXT'); } catch { /* */ }


  // --- Migration: create site_services table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS site_services (
      id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      site_id        TEXT NOT NULL REFERENCES booking_sites(id) ON DELETE CASCADE,
      service_id     TEXT NOT NULL REFERENCES additional_services(id) ON DELETE CASCADE,
      is_enabled     INTEGER NOT NULL DEFAULT 1,
      price_override REAL,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      photo_override TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(site_id, service_id)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_site_services_site ON site_services(site_id)');

  // --- Migration: site_id columns for related tables ---
  try { database.exec('ALTER TABLE payment_accounts ADD COLUMN site_id TEXT REFERENCES booking_sites(id) ON DELETE SET NULL'); } catch { /* */ }
  try { database.exec('ALTER TABLE payment_accounts ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0'); } catch { /* */ }

  try { database.exec('ALTER TABLE coupons ADD COLUMN site_id TEXT REFERENCES booking_sites(id) ON DELETE SET NULL'); } catch { /* */ }
  try { database.exec('ALTER TABLE coupons ADD COLUMN redemption_limit INTEGER'); } catch { /* */ }
  try { database.exec('ALTER TABLE coupons ADD COLUMN applied_listings TEXT'); } catch { /* */ }
  try { database.exec('ALTER TABLE coupons ADD COLUMN max_nights INTEGER'); } catch { /* */ }
  try { database.exec('ALTER TABLE coupons ADD COLUMN allowed_days TEXT'); } catch { /* */ }
  try { database.exec("ALTER TABLE coupons ADD COLUMN applies_to TEXT DEFAULT 'services'"); } catch { /* */ }

  try { database.exec('ALTER TABLE booking_service_orders ADD COLUMN site_id TEXT REFERENCES booking_sites(id) ON DELETE SET NULL'); } catch { /* */ }
  try { database.exec('ALTER TABLE site_services ADD COLUMN photo_override TEXT'); } catch { /* */ }
  console.log('[DB] Booking Sites module tables ready');

  // --- Migration: add allowed_domains to booking_sites ---
  try {
    const bsSiteCols = database.prepare("PRAGMA table_info(booking_sites)").all().map((c: any) => c.name);
    if (!bsSiteCols.includes('allowed_domains')) {
      database.exec("ALTER TABLE booking_sites ADD COLUMN allowed_domains TEXT");
      console.log('[DB] Added allowed_domains to booking_sites');
    }
  } catch (e: any) { console.log('[DB] allowed_domains migration note:', e.message); }

  // --- Migration: create site_incoming_leads table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS site_incoming_leads (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      site_id     TEXT NOT NULL REFERENCES booking_sites(id) ON DELETE CASCADE,
      full_name   TEXT,
      email       TEXT,
      phone       TEXT,
      message     TEXT,
      status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
      -- source_url and raw_data used to be here and are not in
      -- db/postgres/schema.sql, so a fresh SQLite database had two columns
      -- Postgres does not — and a live SQLite database created before they
      -- were added has neither. A query written against them answered on one
      -- engine and threw «no such column» on the others. Nothing writes this
      -- table yet; the shape that survives is the one Postgres has.
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_incoming_leads_site ON site_incoming_leads(site_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_incoming_leads_status ON site_incoming_leads(status)');
  console.log('[DB] Site Form Capture tables ready');


  // --- Migration: create invoices table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL DEFAULT (datetime('now')),
      due_date TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CZK',
      status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled', 'storno', 'corrected')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_reservation ON invoices(reservation_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_issued ON invoices(issued_at)');

  // --- Migration: per-channel invoice series + monthly period locking ---
  // Additive only — existing invoices keep their invoice_number; they default to
  // the HOUSE series and remain editable.
  try {
    const invCols = (database.prepare('PRAGMA table_info(invoices)').all() as any[]).map((c: any) => c.name);
    if (!invCols.includes('series')) database.exec("ALTER TABLE invoices ADD COLUMN series TEXT DEFAULT 'HOUSE'");
    if (!invCols.includes('period')) database.exec('ALTER TABLE invoices ADD COLUMN period TEXT'); // YYYY-MM of the document date
    if (!invCols.includes('locked')) database.exec('ALTER TABLE invoices ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');

    database.exec(`
      CREATE TABLE IF NOT EXISTS invoice_counters (
        series  TEXT NOT NULL,
        year    INTEGER NOT NULL,
        last_no INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (series, year)
      )
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS invoice_periods (
        series    TEXT NOT NULL,
        month     TEXT NOT NULL,
        status    TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')),
        locked_at TEXT,
        PRIMARY KEY (series, month)
      )
    `);

    // Seed the HOUSE counter from existing plain "YYYY-NNN" numbers so new
    // allocations never collide with legacy invoices.
    const yr = new Date().getFullYear();
    const seed = database.prepare(
      "SELECT MAX(CAST(substr(invoice_number, instr(invoice_number,'-')+1) AS INTEGER)) AS mx " +
      "FROM invoices WHERE invoice_number LIKE ?"
    ).get(`${yr}-%`) as { mx: number | null } | undefined;
    if (seed?.mx) {
      database.prepare(
        "INSERT INTO invoice_counters (series, year, last_no) VALUES ('HOUSE', ?, ?) " +
        "ON CONFLICT(series, year) DO UPDATE SET last_no = MAX(last_no, excluded.last_no)"
      ).run(yr, seed.mx);
    }
  } catch (e: any) {
    console.error('[db] invoice series/lock migration:', e.message);
  }

  // --- Migration: invoice numbering is per organization ---
  // invoice_counters was keyed (series, year) and invoice_number was UNIQUE
  // across the whole table. On one hotel that is fine; on a shared server the
  // second hotel's first invoice of the year comes out numbered 002, because it
  // read a counter the first hotel had already advanced — and once two hotels
  // both reach "2026-001" the UNIQUE constraint refuses the second one
  // outright. An invoice number is a legal document identifier: each company
  // must own its own sequence starting at 1.
  try {
    const counterCols = (database.prepare('PRAGMA table_info(invoice_counters)').all() as any[]).map((c: any) => c.name);
    if (!counterCols.includes('organization_id')) {
      // Counters are derived data: whatever is in them can be rebuilt from the
      // invoices themselves, so they are recreated rather than guessed at.
      // Форма ВІДРАЗУ з віссю обʼєкта (INC-038): новий клієнт не має проходити
      // через проміжний вигляд, який блок наприкінці ланцюжка все одно
      // перебудує. Обмеження — унікальний індекс по `COALESCE`, а не PRIMARY
      // KEY: нульова колонка в ключі інакше не працює.
      database.exec(`
        DROP TABLE IF EXISTS invoice_counters;
        CREATE TABLE invoice_counters (
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
          series  TEXT NOT NULL,
          year    INTEGER NOT NULL,
          last_no INTEGER NOT NULL DEFAULT 0
        )
      `);
    }

    const periodCols = (database.prepare('PRAGMA table_info(invoice_periods)').all() as any[]).map((c: any) => c.name);
    if (!periodCols.includes('organization_id')) {
      // A lock is a real decision, not derived, so existing rows are kept when
      // there is exactly one organization to attribute them to.
      const orgs = database.prepare('SELECT id FROM organizations').all() as any[];
      database.exec(`
        ALTER TABLE invoice_periods RENAME TO invoice_periods_old;
        CREATE TABLE invoice_periods (
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
          series    TEXT NOT NULL,
          month     TEXT NOT NULL,
          status    TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')),
          locked_at TEXT
        )
      `);
      if (orgs.length === 1) {
        database.prepare(
          'INSERT INTO invoice_periods (organization_id, series, month, status, locked_at) ' +
          'SELECT ?, series, month, status, locked_at FROM invoice_periods_old'
        ).run(orgs[0].id);
      } else {
        const n = (database.prepare('SELECT COUNT(*) c FROM invoice_periods_old').get() as any).c;
        if (n) console.error(`[db] invoice_periods: ${n} rows dropped, ${orgs.length} organizations — cannot attribute`);
      }
      database.exec('DROP TABLE invoice_periods_old');
    }

    const invCols2 = (database.prepare('PRAGMA table_info(invoices)').all() as any[]).map((c: any) => c.name);
    if (!invCols2.includes('organization_id')) {
      // Dropping the global UNIQUE on invoice_number needs a table rebuild;
      // SQLite has no ALTER for it. The organization comes from the
      // reservation's property, which is where it was implied all along.
      database.exec('ALTER TABLE invoices RENAME TO invoices_old');
      database.exec(`
        CREATE TABLE invoices (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
          invoice_number TEXT NOT NULL,
          issued_at TEXT NOT NULL DEFAULT (datetime('now')),
          due_date TEXT,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'CZK',
          status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled', 'storno', 'corrected')),
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          series TEXT DEFAULT 'HOUSE',
          period TEXT,
          locked INTEGER NOT NULL DEFAULT 0,
          confirmed INTEGER NOT NULL DEFAULT 0,
          confirmation_source TEXT,
          UNIQUE (organization_id, invoice_number)
        )
      `);
      // Anything a later migration had already ALTERed on is re-added, so a
      // rebuild never silently drops a column the app writes to.
      const newCols = (database.prepare('PRAGMA table_info(invoices)').all() as any[]).map((c: any) => c.name);
      for (const c of (database.prepare('PRAGMA table_info(invoices_old)').all() as any[])) {
        if (newCols.includes(c.name)) continue;
        const def = c.dflt_value != null ? ` DEFAULT ${c.dflt_value}` : '';
        database.exec(`ALTER TABLE invoices ADD COLUMN ${c.name} ${c.type || 'TEXT'}${def}`);
        newCols.push(c.name);
      }
      const carried = invCols2.filter((c) => newCols.includes(c));
      // An invoice whose reservation lost its property has no organization and
      // no way to acquire one; it is left behind rather than filed under a
      // hotel it may not belong to.
      database.exec(`
        INSERT INTO invoices (organization_id, ${carried.join(', ')})
        SELECT p.organization_id, ${carried.map((c) => `i.${c}`).join(', ')}
        FROM invoices_old i
        JOIN reservations r ON r.id = i.reservation_id
        JOIN properties p ON p.id = r.property_id
      `);
      const before = (database.prepare('SELECT COUNT(*) c FROM invoices_old').get() as any).c;
      const after = (database.prepare('SELECT COUNT(*) c FROM invoices').get() as any).c;
      if (before !== after) console.error(`[db] invoices: ${before - after} of ${before} rows had no organization and were not carried over`);
      database.exec('DROP TABLE invoices_old');
      database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_reservation ON invoices(reservation_id)');
      database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(organization_id, invoice_number)');
      database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_issued ON invoices(issued_at)');
    }

    // Re-seed each organization's HOUSE counter from its own invoices, so a
    // fresh counter never re-issues a number that already exists.
    const yr2 = new Date().getFullYear();
    database.prepare(`
      INSERT INTO invoice_counters (organization_id, series, year, last_no)
      SELECT organization_id, COALESCE(series, 'HOUSE'), ?,
             MAX(CAST(substr(invoice_number, instr(invoice_number, '-') + 1) AS INTEGER))
      FROM invoices WHERE invoice_number LIKE ?
      GROUP BY organization_id, COALESCE(series, 'HOUSE')
      ON CONFLICT(organization_id, series, year)
      DO UPDATE SET last_no = MAX(last_no, excluded.last_no)
    `).run(yr2, `%${yr2}-%`);
  } catch (e: any) {
    console.error('[db] per-organization invoice numbering migration:', e.message);
  }

  // --- Migration: invoice confirmation (only Teya/cash-confirmed invoices count) ---
  // An invoice is "confirmed" when backed by a real payment: Teya webhook, Teya
  // CSV/POSLink reconciliation, an OTA statement, or operator-marked cash. A bare
  // "mark paid" in PMS is NOT confirmed and is excluded from the monthly ISDOC
  // export until reconciled. Existing invoices are grandfathered as confirmed so
  // historical exports are unaffected.
  try {
    const invCols2 = (database.prepare('PRAGMA table_info(invoices)').all() as any[]).map((c: any) => c.name);
    if (!invCols2.includes('confirmed')) {
      database.exec('ALTER TABLE invoices ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0');
      database.exec("ALTER TABLE invoices ADD COLUMN confirmation_source TEXT");
      // Grandfather every pre-existing invoice as confirmed.
      database.exec("UPDATE invoices SET confirmed = 1, confirmation_source = 'legacy' WHERE confirmation_source IS NULL");
    } else if (!invCols2.includes('confirmation_source')) {
      database.exec("ALTER TABLE invoices ADD COLUMN confirmation_source TEXT");
    }
  } catch (e: any) {
    console.error('[db] invoice confirmation migration:', e.message);
  }

  // --- Migration: camping-specific fields in reservations ---
  try {
    const resCols = (database.prepare("PRAGMA table_info(reservations)").all() as any[]).map((c: any) => c.name);
    // deposit / prepayment tracking
    if (!resCols.includes('deposit_amount'))
      database.exec("ALTER TABLE reservations ADD COLUMN deposit_amount INTEGER DEFAULT 0");
    if (!resCols.includes('deposit_status'))
      database.exec("ALTER TABLE reservations ADD COLUMN deposit_status TEXT DEFAULT 'none'");
    if (!resCols.includes('deposit_paid_at'))
      database.exec("ALTER TABLE reservations ADD COLUMN deposit_paid_at TEXT");
    // Invoice-to-company override: when invoice_company_name is set, the
    // generated faktura uses these fields instead of the personal guest data
    // for the Odberatel block. Other reservations keep rendering as physical-
    // person invoices.
    if (!resCols.includes('invoice_company_name'))
      database.exec("ALTER TABLE reservations ADD COLUMN invoice_company_name TEXT");
    if (!resCols.includes('invoice_company_ico'))
      database.exec("ALTER TABLE reservations ADD COLUMN invoice_company_ico TEXT");
    if (!resCols.includes('invoice_company_dic'))
      database.exec("ALTER TABLE reservations ADD COLUMN invoice_company_dic TEXT");
    if (!resCols.includes('invoice_company_address'))
      database.exec("ALTER TABLE reservations ADD COLUMN invoice_company_address TEXT");
    if (!resCols.includes('invoice_company_city'))
      database.exec("ALTER TABLE reservations ADD COLUMN invoice_company_city TEXT");
    if (!resCols.includes('invoice_company_country'))
      database.exec("ALTER TABLE reservations ADD COLUMN invoice_company_country TEXT");
    if (!resCols.includes('invoice_company_email'))
      database.exec("ALTER TABLE reservations ADD COLUMN invoice_company_email TEXT");
    console.log('[DB] deposit + invoice-company columns migrated');
    // Waitlist table
    database.exec(`
      CREATE TABLE IF NOT EXISTS waitlist (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        site_id TEXT NOT NULL REFERENCES booking_sites(id) ON DELETE CASCADE,
        unit_id TEXT REFERENCES units(id) ON DELETE CASCADE,
        check_in TEXT NOT NULL,
        check_out TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (e: any) {
    console.error('[DB] Camping migration error:', e.message);
  }

  // --- Migration: create cart_events table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS cart_events (
      id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      reservation_id        TEXT REFERENCES reservations(id) ON DELETE SET NULL,
      guest_token           TEXT NOT NULL,
      service_id            TEXT,
      event_type            TEXT NOT NULL CHECK (event_type IN ('add','remove','pay_now','checkout','abandon')),
      quantity              INTEGER DEFAULT 1,
      phase                 TEXT,
      cart_total            REAL,
      items_json            TEXT,
      abandon_notified_at   TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_cart_events_token ON cart_events(guest_token)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cart_events_type ON cart_events(event_type, abandon_notified_at)');

  // --- Migration: create booking_drafts table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS booking_drafts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      session_id TEXT UNIQUE,
      accommodation_type TEXT,
      unit_type TEXT,
      check_in TEXT,
      check_out TEXT,
      adults INTEGER DEFAULT 1,
      children INTEGER DEFAULT 0,
      extras TEXT,
      options TEXT,
      guest_name TEXT,
      guest_email TEXT,
      guest_phone TEXT,
      total_price REAL DEFAULT 0,
      deposit_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'pending_payment', 'paid', 'expired', 'cancelled')),
      teya_session_id TEXT,
      reservation_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Clean expired drafts older than 24h
  try { database.exec("DELETE FROM booking_drafts WHERE status = 'draft' AND created_at < datetime('now', '-24 hours')"); } catch { /* */ }

  // --- Migration: add available_in_widget to additional_services ---
  try {
    const asCols = database.prepare("PRAGMA table_info(additional_services)").all().map((c: any) => c.name);
    if (!asCols.includes('available_in_widget')) {
      database.exec("ALTER TABLE additional_services ADD COLUMN available_in_widget INTEGER DEFAULT 0");
      console.log('[DB] Added available_in_widget to additional_services');
    }
  } catch { /* */ }

  // --- Migration: add service_date + payment columns to service_orders ---
  try {
    const soCols = database.prepare("PRAGMA table_info(service_orders)").all().map((c: any) => c.name);
    if (!soCols.includes('service_date')) {
      database.exec("ALTER TABLE service_orders ADD COLUMN service_date TEXT");
      // Backfill: set service_date = check_in for existing orders
      database.exec(`
        UPDATE service_orders
        SET service_date = (
          SELECT r.check_in FROM reservations r WHERE r.id = service_orders.reservation_id
        )
        WHERE service_date IS NULL
      `);
      console.log('[DB] Added service_date to service_orders + backfilled from check_in');
    }
    if (!soCols.includes('payment_id'))
      database.exec("ALTER TABLE service_orders ADD COLUMN payment_id TEXT");
    if (!soCols.includes('payment_status'))
      database.exec("ALTER TABLE service_orders ADD COLUMN payment_status TEXT DEFAULT 'none'");
  } catch { /* */ }

  // --- Migration: create widget_price_list table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS widget_price_list (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      -- Без CHECK: тут стояв список із трьох слів першого клієнта.
      -- Готель із категоріями «Номери» і «Апартаменти» діставав відмову
      -- бази на власну категорію — не порожній список, а помилку запису.
      category TEXT NOT NULL,
      item_code TEXT NOT NULL UNIQUE,
      item_name TEXT NOT NULL,
      rate_standard REAL NOT NULL DEFAULT 0,
      rate_holiday REAL,
      rate_side_season REAL,
      unit_label TEXT NOT NULL DEFAULT 'night',
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // No price list is seeded. The rates that used to live here were one
  // property's real commercial pricing (tiny house, barn house, camping
  // pitches, tourist tax) and would have been shown to every other tenant.

  // --- Migration: add source column to guests (for analytics) ---
  try {
    const gCols = database.prepare('PRAGMA table_info(guests)').all().map((c: any) => c.name);
    if (!gCols.includes('source')) {
      database.exec("ALTER TABLE guests ADD COLUMN source TEXT DEFAULT 'direct'");
      console.log('[DB] Added source column to guests');
    }
  } catch { /* */ }

  // --- Migration: add guest_page_token to booking_drafts ---
  try {
    const bdCols = database.prepare('PRAGMA table_info(booking_drafts)').all().map((c: any) => c.name);
    if (!bdCols.includes('guest_page_token')) {
      database.exec('ALTER TABLE booking_drafts ADD COLUMN guest_page_token TEXT');
      console.log('[DB] Added guest_page_token to booking_drafts');
    }
  } catch { /* */ }

  // ═══════════════════════════════════════════════════════════════════
  // PR #15: Clearing accounts + channel receivables
  // ═══════════════════════════════════════════════════════════════════
  // Adds 'clearing' to finance_accounts.type CHECK constraint, seeds
  // default clearing accounts (Booking CZK/EUR, Airbnb EUR, VRBO EUR),
  // creates fin_channel_receivables to track expected payouts per
  // reservation, and backfills receivables for existing channel-sourced
  // reservations.
  // ═══════════════════════════════════════════════════════════════════
  try {
    const acctCols = database.prepare("PRAGMA table_info(finance_accounts)").all() as { name: string }[];
    if (acctCols.length > 0) {
      // Probe current CHECK constraint by attempting insert with a clearing-typed dummy.
      // Use sqlite_master to read the actual schema text.
      const schemaRow = database.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='finance_accounts'"
      ).get() as { sql: string } | undefined;
      const hasClearingType = schemaRow?.sql?.includes("'clearing'") ?? false;

      if (!hasClearingType) {
        // Clean up any orphan from a prior failed swap attempt (PR #18 hotfix:
        // first run failed at DROP TABLE because of FK references from
        // fin_operations.account_from_id/account_to_id, leaving the new table
        // behind. CREATE then errors with "table already exists" on retry.)
        database.exec("DROP TABLE IF EXISTS finance_accounts_pr15");

        // Disable FK enforcement during swap so DROP TABLE doesn't fail on
        // referenced rows. References in dependent tables (fin_operations,
        // bank_transactions) auto-migrate to the renamed table because they
        // store account_id strings, not row pointers.
        database.pragma('foreign_keys = OFF');
        // Вісь обʼєкта (INC-038, Д54) переживає цю перебудову тільки тому, що
        // названа тут ЯВНО. Перебудова старша за колонку: вона перелічує
        // стовпці поіменно, тож `property_id`, доданий у CREATE вище, мовчки
        // зникав би разом зі старою таблицею — рівно той клас, яким уже двічі
        // зникали УНІКАЛЬНІ індекси (AGENTS §4).
        //
        // Копіюється УМОВНО: на базі, яка цієї колонки ще не має (стара, що
        // не дійшла до кінця ланцюжка), `SELECT property_id` упав би, і
        // перебудова не відбулась би взагалі.
        const acctHasProperty = (database.prepare("PRAGMA table_info(finance_accounts)").all() as { name: string }[])
          .some((c) => c.name === 'property_id');
        const carry = acctHasProperty ? ', property_id' : '';
        try {
          database.exec(`
            CREATE TABLE finance_accounts_pr15 (
              id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
              organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
              property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              type TEXT NOT NULL DEFAULT 'cash' CHECK (type IN ('cash', 'bank', 'card', 'investment', 'clearing', 'other')),
              currency TEXT NOT NULL DEFAULT 'CZK',
              initial_balance REAL NOT NULL DEFAULT 0,
              credit_limit REAL,
              iban TEXT,
              color TEXT DEFAULT '#6366f1',
              is_active INTEGER NOT NULL DEFAULT 1,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO finance_accounts_pr15
              (id, organization_id, name, type, currency, initial_balance, credit_limit, iban, color, is_active, sort_order, created_at${carry})
            SELECT id, organization_id, name, type, currency, initial_balance, credit_limit, iban, color, is_active, sort_order, created_at${carry}
            FROM finance_accounts;
            DROP TABLE finance_accounts;
            ALTER TABLE finance_accounts_pr15 RENAME TO finance_accounts;
            CREATE INDEX IF NOT EXISTS idx_fin_acct_org ON finance_accounts(organization_id);
            CREATE INDEX IF NOT EXISTS idx_fin_acct_iban ON finance_accounts(iban);
          `);
        } finally {
          database.pragma('foreign_keys = ON');
        }
        console.log('[DB] PR #15: rebuilt finance_accounts to allow clearing type');
      }
    }
  } catch (e: any) { console.log('[DB] PR #15 finance_accounts CHECK migration:', e.message); }

  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_channel_receivables (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      clearing_account_id TEXT NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
      channel_source TEXT NOT NULL,
      external_reservation_id TEXT,
      gross_amount REAL NOT NULL,
      expected_net REAL NOT NULL,
      currency TEXT NOT NULL,
      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'in_statement', 'paid', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (reservation_id, clearing_account_id)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_recv_org ON fin_channel_receivables(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_recv_status ON fin_channel_receivables(status)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_recv_clearing ON fin_channel_receivables(clearing_account_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_recv_extid ON fin_channel_receivables(external_reservation_id)');

  // Clearing accounts are NOT seeded. One per channel/currency only makes sense
  // once that channel is actually connected; seeding Booking.com CZK/EUR,
  // Airbnb and VRBO unconditionally left four permanently-zero accounts in the
  // operations list of every tenant, including those selling none of them.
  // They are created when a channel connection is established.

  // Finance PR #A (is_pms_signal) was retired in clean-3: all readers are
  // gone, so new databases no longer get the column. Existing databases may
  // still carry it — harmless, ignored everywhere.
  try {
    const cols = database.prepare("PRAGMA table_info(fin_operations)").all() as { name: string }[];
    // PR #C: needs_review flag for ops where the channel→account resolver
    // had to fall back. Surfaces a queue for the admin to triage.
    if (!cols.some((c) => c.name === 'needs_review')) {
      database.exec("ALTER TABLE fin_operations ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0");
      database.exec("CREATE INDEX IF NOT EXISTS idx_fop_needs_review ON fin_operations(needs_review)");
    }
  } catch (e: any) { console.log('[DB] PR #C fin_operations columns:', e.message); }

  // `payment_webhook_log` тут БУЛА і не створюється більше.
  //
  // Журнал вебхуків Teya: створювався, отримував три індекси, у міграції
  // 0005 йому навіть дописували орендаря — і жоден рядок коду ніколи в
  // нього не писав і не читав. Teya видалена; шлюз оплат, коли зʼявиться,
  // матиме свій журнал і свою форму. Порожня таблиця з трьома індексами
  // виглядає як робоча підсистема — і саме тому гірша за її відсутність:
  // адміністратор, якому сказали «подивись у журнал вебхуків», побачить
  // порожньо й вирішить, що вебхук не приходив.
  // Прибирає міграція 0043.

  // ═══════════════════════════════════════════════════════════════════
  // Cleanup #D: backfill needs_review on legacy null-account ops.
  //
  // The migrations from `income`, `expenses`, `transfers`, `payments`
  // copied rows into fin_operations even when account_id was NULL.
  // createOperationInTx now rejects such rows on creation (see
  // operations.handlers.ts:185-192), but the historical leftovers stay
  // invisible — they don't show up in /finance/reconcile because their
  // needs_review flag was never set, and their balance impact is hidden
  // by PR #signals-filter (the latest fix).
  //
  // Mark them needs_review=1 so the operator sees them in the existing
  // triage queue (`/app/finance/operations?needs_review=1`) and can either
  // assign an account or archive them. Idempotent: only flips rows
  // currently at 0.
  // ═══════════════════════════════════════════════════════════════════
  try {
    const result = database.prepare(`
      UPDATE fin_operations
      SET needs_review = 1
      WHERE needs_review = 0
        AND (
          (op_type = 'income'   AND account_to_id   IS NULL) OR
          (op_type = 'expense'  AND account_from_id IS NULL) OR
          (op_type = 'transfer' AND (account_from_id IS NULL OR account_to_id IS NULL))
        )
    `).run();
    if (result.changes > 0) {
      console.log(`[DB] Cleanup #D: flagged ${result.changes} legacy null-account fin_operations as needs_review=1`);
    }
  } catch (e: any) {
    console.log('[DB] Cleanup #D needs_review backfill:', e.message);
  }

  // (Cleanup #E lived here — deleted legacy Hostex signal fin_operations.
  //  It served its purpose during clean-2 deploy. Since clean-3 drops the
  //  is_pms_signal column entirely, the migration is a no-op and was
  //  removed to avoid noisy «no such column» errors on every startup.)

  // (Cleanup #H REMOVED 2026-05-28: this ran on EVERY restart and deleted
  //  booking_widget / null-account operations, causing PIN-confirmed
  //  cash payments to vanish after each deploy. One-time job already done.)

  // (Cleanup #G REMOVED 2026-05-28: this ran on EVERY restart and deleted
  //  ALL fin_operations with source IN ('hostex','teia','booking_widget',
  //  'guest_page'). This was the ROOT CAUSE of 22+ missing cash payments —
  //  booking widget PIN confirmations use source='booking_widget', so they
  //  were wiped on every server restart. One-time job already done.)

  // ═══════════════════════════════════════════════════════════════════
  // Cleanup #I: drop dead FK columns on bank_transactions
  //
  // matched_payment_id REFERENCES payments(id) — payments table was DROPed
  // matched_expense_id REFERENCES expenses(id) — expenses table was DROPed
  //
  // Both were superseded by matched_operation_id (REFERENCES fin_operations)
  // in PR #6. The dead FK target makes ANY insert that touches these
  // columns blow up with "no such table: main.payments" (even when the
  // value is NULL — SQLite still validates FK target exists at write time
  // with foreign_keys=ON). bank-inbox-engine inserts into bank_transactions
  // on every parsed PDF row, hence the recurring email-import errors.
  //
  // SQLite ≥3.35 supports ALTER TABLE DROP COLUMN. Wrap in try in case
  // the column was already dropped on a fresh install.
  // ═══════════════════════════════════════════════════════════════════
  try {
    const btxCols = database.prepare("PRAGMA table_info(bank_transactions)").all() as { name: string }[];
    if (btxCols.some((c) => c.name === 'matched_payment_id')) {
      database.exec('ALTER TABLE bank_transactions DROP COLUMN matched_payment_id');
      console.log('[DB] Cleanup #I: dropped dead bank_transactions.matched_payment_id (FK→payments)');
    }
    if (btxCols.some((c) => c.name === 'matched_expense_id')) {
      database.exec('ALTER TABLE bank_transactions DROP COLUMN matched_expense_id');
      console.log('[DB] Cleanup #I: dropped dead bank_transactions.matched_expense_id (FK→expenses)');
    }
  } catch (e: any) {
    console.log('[DB] Cleanup #I drop dead FK columns:', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════
  // (Cleanup #H copy-2 REMOVED 2026-05-28: duplicate of the block above,
  //  same root-cause issue — see comment near line 3586.)

  // (Cleanup #G copy-2 REMOVED 2026-05-28: duplicate of the block above,
  //  same root-cause issue — see comment near line 3586.)

  // ═══════════════════════════════════════════════════════════════════
  // Cleanup #I: drop dead FK columns on bank_transactions
  //
  // matched_payment_id REFERENCES payments(id) — payments table was DROPed
  // matched_expense_id REFERENCES expenses(id) — expenses table was DROPed
  //
  // Both were superseded by matched_operation_id (REFERENCES fin_operations)
  // in PR #6. The dead FK target makes ANY insert that touches these
  // columns blow up with "no such table: main.payments" (even when the
  // value is NULL — SQLite still validates FK target exists at write time
  // with foreign_keys=ON). bank-inbox-engine inserts into bank_transactions
  // on every parsed PDF row, hence the recurring email-import errors.
  //
  // SQLite ≥3.35 supports ALTER TABLE DROP COLUMN. Wrap in try in case
  // the column was already dropped on a fresh install.
  // ═══════════════════════════════════════════════════════════════════
  try {
    const btxCols = database.prepare("PRAGMA table_info(bank_transactions)").all() as { name: string }[];
    if (btxCols.some((c) => c.name === 'matched_payment_id')) {
      database.exec('ALTER TABLE bank_transactions DROP COLUMN matched_payment_id');
      console.log('[DB] Cleanup #I: dropped dead bank_transactions.matched_payment_id (FK→payments)');
    }
    if (btxCols.some((c) => c.name === 'matched_expense_id')) {
      database.exec('ALTER TABLE bank_transactions DROP COLUMN matched_expense_id');
      console.log('[DB] Cleanup #I: dropped dead bank_transactions.matched_expense_id (FK→expenses)');
    }
  } catch (e: any) {
    console.log('[DB] Cleanup #I drop dead FK columns:', e.message);
  }


  // PR #33-#35: Generic spreadsheet import wizard
  // - import_formats: persisted column→field mappings per source format
  //   (Finmap, Booking, Airbnb, etc). Saves user time on repeat imports.
  // - import_entity_mappings: persisted entity resolution (source value
  //   an incoming account label → existing PMS account ID, OR action='create_new'
  //   to spawn fresh on commit, OR 'ignore' to skip).
  // - import_runs: audit log of each import attempt — file name, format,
  //   counts. Lets user see history.
  // ═══════════════════════════════════════════════════════════════════
  database.exec(`
    CREATE TABLE IF NOT EXISTS import_formats (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      detector_signature TEXT,
      field_mappings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_import_formats_org ON import_formats(organization_id)');

  database.exec(`
    CREATE TABLE IF NOT EXISTS import_entity_mappings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      format_id TEXT NOT NULL REFERENCES import_formats(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('account','category','project','counterparty')),
      source_value TEXT NOT NULL,
      pms_entity_id TEXT,
      action TEXT NOT NULL DEFAULT 'use_existing' CHECK (action IN ('use_existing','create_new','ignore')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(format_id, entity_type, source_value)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_iem_format ON import_entity_mappings(format_id, entity_type)');

  database.exec(`
    CREATE TABLE IF NOT EXISTS import_runs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      format_id TEXT REFERENCES import_formats(id) ON DELETE SET NULL,
      file_name TEXT,
      rows_total INTEGER NOT NULL DEFAULT 0,
      rows_created INTEGER NOT NULL DEFAULT 0,
      rows_skipped INTEGER NOT NULL DEFAULT 0,
      rows_dup INTEGER NOT NULL DEFAULT 0,
      errors_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'committed',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_import_runs_org ON import_runs(organization_id, created_at)');

  // PR #27: email-forward receipts inbox (separate from bank inbox)
  // User forwards email with invoice/receipt → IMAP poll extracts attachments
  // → drops them in fin_pending_receipts pool → user manually links to a
  // fin_operation. Optionally tries to auto-match by amount in subject/body.
  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_receipt_inboxes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL DEFAULT 993,
      imap_user TEXT NOT NULL,
      imap_password_encrypted TEXT NOT NULL,
      imap_folder TEXT NOT NULL DEFAULT 'INBOX',
      use_tls INTEGER NOT NULL DEFAULT 1,
      sender_filter TEXT,
      subject_filter TEXT,
      auto_match_threshold_pct REAL NOT NULL DEFAULT 1.0,
      last_uid INTEGER,
      last_synced_at TEXT,
      last_error TEXT,
      last_email_at TEXT,
      emails_processed INTEGER NOT NULL DEFAULT 0,
      receipts_imported INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_recv_inbox_org ON fin_receipt_inboxes(organization_id)');

  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_pending_receipts (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      inbox_id TEXT REFERENCES fin_receipt_inboxes(id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      sender_email TEXT,
      subject TEXT,
      received_at TEXT,
      detected_amount REAL,
      detected_currency TEXT,
      auto_matched_operation_id TEXT REFERENCES fin_operations(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'matched', 'attached', 'archived')),
      attached_attachment_id TEXT REFERENCES fin_operation_attachments(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_prec_org ON fin_pending_receipts(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_prec_status ON fin_pending_receipts(status)');

  // PR #26: suggested_recurring_id on fin_operations — bank-imported ops
  // get tagged with a candidate recurring template (similar amount + counterparty)
  // for one-click confirmation by user.
  try {
    const opCols = database.prepare("PRAGMA table_info(fin_operations)").all() as { name: string }[];
    if (opCols.length > 0 && !opCols.some((c) => c.name === 'suggested_recurring_id')) {
      database.exec("ALTER TABLE fin_operations ADD COLUMN suggested_recurring_id TEXT");
      database.exec("CREATE INDEX IF NOT EXISTS idx_fin_op_suggested_recurring ON fin_operations(suggested_recurring_id)");
      console.log('[DB] PR #26: added suggested_recurring_id column to fin_operations');
    }
  } catch (e: any) { console.log('[DB] PR #26 suggested_recurring_id migration:', e.message); }

  // PR #23: file attachments per fin_operation (invoices, receipts, photos)
  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_operation_attachments (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL REFERENCES fin_operations(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_attach_op ON fin_operation_attachments(operation_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_attach_org ON fin_operation_attachments(organization_id)');

  // PR #21: allow orphan receivables (reservation_id NULL).
  // When a statement upload has rows that don't match any PMS reservation
  // (Hostex sync gap, missed bookings), we still record the receivable so
  // accounting reflects what the platform paid. The UI surfaces orphans
  // distinctly so user can investigate / link later.
  try {
    const recvCols = database.prepare("PRAGMA table_info(fin_channel_receivables)").all() as { name: string; notnull: number }[];
    const ridCol = recvCols.find((c) => c.name === 'reservation_id');
    if (ridCol && ridCol.notnull === 1) {
      // SQLite can't drop NOT NULL via ALTER — rebuild table preserving data.
      database.pragma('foreign_keys = OFF');
      try {
        database.exec(`
          CREATE TABLE fin_channel_receivables_pr21 (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
            clearing_account_id TEXT NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
            channel_source TEXT NOT NULL,
            external_reservation_id TEXT,
            gross_amount REAL NOT NULL,
            expected_net REAL NOT NULL,
            currency TEXT NOT NULL,
            check_in TEXT NOT NULL,
            check_out TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'in_statement', 'paid', 'cancelled')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (reservation_id, clearing_account_id, external_reservation_id)
          );
          INSERT INTO fin_channel_receivables_pr21
            SELECT id, organization_id, reservation_id, clearing_account_id,
                   channel_source, external_reservation_id, gross_amount,
                   expected_net, currency, check_in, check_out,
                   status, created_at, updated_at
            FROM fin_channel_receivables;
          DROP TABLE fin_channel_receivables;
          ALTER TABLE fin_channel_receivables_pr21 RENAME TO fin_channel_receivables;
          CREATE INDEX IF NOT EXISTS idx_recv_org ON fin_channel_receivables(organization_id);
          CREATE INDEX IF NOT EXISTS idx_recv_status ON fin_channel_receivables(status);
          CREATE INDEX IF NOT EXISTS idx_recv_clearing ON fin_channel_receivables(clearing_account_id);
          CREATE INDEX IF NOT EXISTS idx_recv_extid ON fin_channel_receivables(external_reservation_id);
        `);
        console.log('[DB] PR #21: rebuilt fin_channel_receivables to allow NULL reservation_id (orphan receivables)');
      } finally {
        database.pragma('foreign_keys = ON');
      }
    }
  } catch (e: any) { console.log('[DB] PR #21 orphan receivables migration:', e.message); }

  // PR #20: add actual_gross to fin_channel_receivables for EUR-level reconciliation.
  // Statement-uploaded gross can differ from Hostex-stored gross (post-stay refunds,
  // partial cancellations, tariff changes). Comparing both reveals real discrepancies.
  try {
    const recvCols = database.prepare("PRAGMA table_info(fin_channel_receivables)").all() as { name: string }[];
    if (recvCols.length > 0 && !recvCols.some((c) => c.name === 'actual_gross')) {
      database.exec("ALTER TABLE fin_channel_receivables ADD COLUMN actual_gross REAL");
      console.log('[DB] PR #20: added actual_gross column to fin_channel_receivables');
    }
  } catch (e: any) { console.log('[DB] PR #20 actual_gross migration:', e.message); }

  // PR #16: track manual statement uploads (Booking/Airbnb/VRBO XLSX/CSV)
  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_statement_uploads (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      file_name TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      applied_count INTEGER NOT NULL DEFAULT 0,
      cancelled_count INTEGER NOT NULL DEFAULT 0,
      unmatched_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_stmt_upl_org ON fin_statement_uploads(organization_id)');

  // The PR #15 one-time receivables backfill used to live here. It loaded
  // the clearing engine with require('@/modules/...') — an alias only the
  // bundler understands, so under plain node it always threw, and after the
  // finance move Turbopack could not resolve it either and the BUILD failed.
  // The migration has run everywhere it was needed (fin_system_state carries
  // its flag); a one-time backfill is not worth an unresolvable import.

  // --- Migration: create gift_cards table (feature/gift_cards) ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS gift_cards (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      code            TEXT NOT NULL UNIQUE,
      template_id     TEXT NOT NULL DEFAULT 'custom',
      name            TEXT NOT NULL,
      type            TEXT NOT NULL DEFAULT 'open_date'
                      CHECK (type IN ('open_date', 'package', 'discount')),
      value_type      TEXT NOT NULL DEFAULT 'fixed_czk'
                      CHECK (value_type IN ('fixed_czk', 'fixed_eur', 'percent', 'nights')),
      face_value      REAL NOT NULL DEFAULT 0,
      currency        TEXT NOT NULL DEFAULT 'CZK',
      status          TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'active', 'paid', 'activated', 'expired', 'cancelled')),
      recipient_name  TEXT,
      recipient_email TEXT,
      buyer_name      TEXT,
      buyer_email     TEXT,
      buyer_phone     TEXT,
      message         TEXT,
      expires_at      TEXT,
      paid_at         TEXT,
      activated_at     TEXT,
      reservation_id  TEXT REFERENCES reservations(id) ON DELETE SET NULL,
      config_json     TEXT NOT NULL DEFAULT '{}',
      notes           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_gift_cards_property ON gift_cards(property_id)');
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status)');
  console.log('[DB] gift_cards table ready');

  // --- Migration: gift_card automation rules table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS gift_card_automation_rules (
      id               TEXT PRIMARY KEY,
      site_id          TEXT NOT NULL,
      template_id      TEXT,
      name             TEXT NOT NULL DEFAULT 'Автоматизований ваучер',
      discount_type    TEXT NOT NULL DEFAULT 'percentage',
      offer_amount   REAL NOT NULL DEFAULT 0,
      valid_from       TEXT,
      valid_until      TEXT,
      min_nights       INTEGER,
      max_nights       INTEGER,
      allowed_days     TEXT,
      applies_to       TEXT NOT NULL DEFAULT 'listings',
      redemption_limit INTEGER NOT NULL DEFAULT 1,
      generated_count  INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_var_site ON gift_card_automation_rules(site_id)');

  // --- Migration: add gift_card_rule_id to coupons ---
  try {
    database.exec(`ALTER TABLE coupons ADD COLUMN gift_card_rule_id TEXT REFERENCES gift_card_automation_rules(id) ON DELETE SET NULL`);
    console.log('[DB] Added gift_card_rule_id to coupons');
  } catch { /* column already exists */ }

  // --- Migration: add extra fields to coupons (min_nights, max_nights, redemption_limit, site_id, allowed_days, applies_to) ---
  for (const col of [
    'min_nights INTEGER',
    'max_nights INTEGER',
    'redemption_limit INTEGER',
    'site_id TEXT',
    'allowed_days TEXT',
    'applies_to TEXT DEFAULT \'services\'',
  ]) {
    try { database.exec(`ALTER TABLE coupons ADD COLUMN ${col}`); } catch { /* already exists */ }
  }

  console.log('[DB] gift_card_automation_rules ready');

  // --- Migration: cm_connections + cm_inbound_bookings (CP4) ---
  //
  // Приймання броней із менеджера каналів. Дві таблиці, і кожна відповідає
  // на своє питання.
  //
  // cm_connections — чим цей ОБʼЄКТ повʼязаний із менеджером каналів.
  // Ключ API сюди НЕ пишеться: він у channel_credentials (інваріант 7 —
  // жодних секретів у схемі, яку читає пів застосунку). webhook_token і
  // webhook_secret тут як виняток за необхідністю: обидва безглузді без
  // знання URL і відкликаються зміною рядка.
  //
  // cm_inbound_bookings — ЖУРНАЛ РЕВІЗІЙ, а не копія броней. Channex віддає
  // стрічку ревізій: booking_id стабільний між ними, id ревізії — ні.
  // UNIQUE(connection_id, remote_revision_id) — і є весь захист від дубля
  // при повторній доставці, однаково в обох двигунах.
  //
  // Чому журнал, а не просто INSERT у reservations: вебхуки приходять не в
  // тому порядку, у якому сталися події (документація Channex каже це
  // дослівно), а ack ми шлемо ПІСЛЯ коміту. Отже та сама ревізія цілком
  // нормально приїде вдруге — і має не створити другої броні.
  //
  // payload зберігається сирим (доказ у суперечці), але містить ПІБ, email і
  // телефон гостя. Рядок лишається назавжди, payload знеособлюється тим
  // самим циклом, що й решта — /api/cron/gdpr-retention; anonymized_at
  // фіксує, коли це сталося.
  database.exec(`
    CREATE TABLE IF NOT EXISTS cm_connections (
      id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      property_id        TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      -- Без DEFAULT: імені вендора в спільній схемі не буває (інваріант И1,
      -- гейт check-vendor-isolation). Зʼєднання без провайдера безглузде,
      -- і назвати його має адаптер, а не ядро, яке про вендорів не знає.
      provider           TEXT NOT NULL,
      environment        TEXT NOT NULL DEFAULT 'staging'
                           CHECK (environment IN ('staging', 'production')),
      remote_property_id TEXT,
      webhook_token      TEXT NOT NULL,
      webhook_secret     TEXT NOT NULL,
      remote_webhook_id  TEXT,
      is_enabled         INTEGER NOT NULL DEFAULT 0,
      -- Зсув ЦІЄЇ точки збуту у відсотках (рішення Ц7). ЖОДНИХ ЗВОРОТНИХ
      -- ЛАПОК: коментар усередині шаблонного рядка, одна лапка закриє його
      -- посеред SQL.
      --
      -- Число ЗНАКОВЕ: -10 це дешевше на 10%, +10 дорожче. Пари
      -- відсоток-плюс-напрямок тут немає навмисно: два поля можуть
      -- суперечити одне одному, і сайтова колонка саме на цьому ловилась.
      --
      -- Нуль означає не зсувати, і тому він дефолт: точка збуту, яка нічого
      -- не сказала, нічого й не міняє. Це НЕ той нуль, що в ціні дитини, де
      -- він був би вигаданою ціною; тут нуль це справді як база.
      --
      -- Модифікатор однієї точки збуту ніколи не потрапляє в іншу: зсув
      -- сайту живе в сайтовому дереві. Це і є визначення прямо дешевше.
      pricing_modifier_percent REAL NOT NULL DEFAULT 0,
      last_full_sync_at  TEXT,
      -- Коли каталог цього зʼєднання востаннє їздив до вендора (0130).
      -- Окремо від last_full_sync_at: та про ARI, ця про каталог. NULL —
      -- обʼєкта у вендора ще немає, розходитись нема з чим.
      catalog_synced_at  TEXT,
      -- Коли востаннє питали перелік каналів (0100, К2). На зʼєднанні, а не
      -- на рядках cm_channels: «каналів нуль» і «ще не питали» різні стани, а
      -- рядків у першому немає жодного.
      channels_synced_at TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(organization_id, property_id, provider, environment)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_connections_org ON cm_connections(organization_id)');
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_connections_token ON cm_connections(webhook_token)');

  database.exec(`
    CREATE TABLE IF NOT EXISTS cm_inbound_bookings (
      id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      connection_id        TEXT NOT NULL REFERENCES cm_connections(id) ON DELETE CASCADE,
      remote_revision_id   TEXT NOT NULL,
      remote_booking_id    TEXT NOT NULL,
      ota_reservation_code TEXT,
      ota_name             TEXT,
      status               TEXT NOT NULL CHECK (status IN ('new', 'modified', 'cancelled')),
      reservation_id       TEXT REFERENCES reservations(id) ON DELETE SET NULL,
      payload              TEXT NOT NULL,
      is_unmapped          INTEGER NOT NULL DEFAULT 0,
      received_at          TEXT NOT NULL DEFAULT (datetime('now')),
      applied_at           TEXT,
      confirmed_at         TEXT,
      anonymized_at        TEXT,
      UNIQUE(connection_id, remote_revision_id)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_inbound_org ON cm_inbound_bookings(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_inbound_booking ON cm_inbound_bookings(connection_id, remote_booking_id)');
  database.exec("CREATE INDEX IF NOT EXISTS idx_cm_inbound_unconfirmed ON cm_inbound_bookings(connection_id) WHERE confirmed_at IS NULL");

  // Дзеркало мапінгу: що з нашого чим стало на тому боці. Сам мапінг робить
  // оператор в iFrame менеджера каналів; тут — лише відповідність, без якої
  // чужий id типу номера в броні нема чим перекласти.
  //
  // occupancy NOT NULL DEFAULT 0, а не nullable: UNIQUE не обмежує NULL ні
  // тут, ні в Postgres, і саме на цьому вже обпікся price_occupancy. 0 —
  // значення поза доменом заселеності, тобто "сама сутність, не опція".
  //
  // unit_type_id — той самий прийом і з тієї ж причини, тільки для ПАРИ.
  // У нас тариф належить обʼєкту, у менеджера каналів — типу номера, тож наш
  // тариф із цінами на двох типах стає ДВОМА тарифами на тому боці (Ц6).
  // Ключ без типу затирав би перший рядок другим, і половина фонду лишалась
  // би без обміну беззвучно. Порожній рядок, а не NULL: у обʼєкта й типу
  // номера пари немає, і NULL зробив би для них UNIQUE недієвим.
  database.exec(`
    CREATE TABLE IF NOT EXISTS cm_mappings (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      connection_id   TEXT NOT NULL REFERENCES cm_connections(id) ON DELETE CASCADE,
      entity_type     TEXT NOT NULL CHECK (entity_type IN ('property', 'unit_type', 'rate_plan', 'rate_plan_option')),
      local_id        TEXT NOT NULL,
      unit_type_id    TEXT NOT NULL DEFAULT '',
      occupancy       INTEGER NOT NULL DEFAULT 0 CHECK (occupancy >= 0),
      remote_id       TEXT NOT NULL,
      synced_at       TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(connection_id, entity_type, local_id, unit_type_id, occupancy),
      UNIQUE(connection_id, entity_type, remote_id)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_mappings_org ON cm_mappings(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_mappings_lookup ON cm_mappings(connection_id, entity_type, remote_id)');

  // Перебудова під вісь пари: UNIQUE у SQLite не міняється ALTER-ом, а старий
  // — (connection_id, entity_type, local_id, occupancy) — ВІДХИЛИВ БИ другу
  // пару того самого тарифу. Тобто без цієї перебудови нова колонка існує, а
  // толку з неї нема.
  //
  // Індекси знімаються до підміни й повертаються після, а лічильник
  // звіряється: `DROP TABLE` зносить їх мовчки (AGENTS §4).
  try {
    const mapCols = (database.prepare('PRAGMA table_info(cm_mappings)').all() as any[]).map((c: any) => c.name);
    if (!mapCols.includes('unit_type_id')) {
      const indexes = (database.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cm_mappings' AND sql IS NOT NULL",
      ).all() as { sql: string }[]).map((r) => r.sql);

      database.exec('PRAGMA foreign_keys = OFF');
      database.exec('BEGIN');
      database.exec(`
        CREATE TABLE cm_mappings__rebuilt (
          id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          connection_id   TEXT NOT NULL REFERENCES cm_connections(id) ON DELETE CASCADE,
          entity_type     TEXT NOT NULL CHECK (entity_type IN ('property', 'unit_type', 'rate_plan', 'rate_plan_option')),
          local_id        TEXT NOT NULL,
          unit_type_id    TEXT NOT NULL DEFAULT '',
          occupancy       INTEGER NOT NULL DEFAULT 0 CHECK (occupancy >= 0),
          remote_id       TEXT NOT NULL,
          synced_at       TEXT,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(connection_id, entity_type, local_id, unit_type_id, occupancy),
          UNIQUE(connection_id, entity_type, remote_id)
        )
      `);
      database.exec(`
        INSERT INTO cm_mappings__rebuilt
          (id, organization_id, connection_id, entity_type, local_id, unit_type_id,
           occupancy, remote_id, synced_at, created_at, updated_at)
        SELECT id, organization_id, connection_id, entity_type, local_id, '',
               occupancy, remote_id, synced_at, created_at, updated_at
          FROM cm_mappings
      `);
      const before = (database.prepare('SELECT COUNT(*) c FROM cm_mappings').get() as any).c;
      database.exec('DROP TABLE cm_mappings');
      database.exec('ALTER TABLE cm_mappings__rebuilt RENAME TO cm_mappings');
      for (const ix of indexes) {
        database.exec(ix.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, (m) => `${m}IF NOT EXISTS `));
      }
      const after = (database.prepare('SELECT COUNT(*) c FROM cm_mappings').get() as any).c;
      if (after !== before) throw new Error(`cm_mappings rebuild lost rows: ${before} -> ${after}`);
      const restored = (database.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cm_mappings' AND sql IS NOT NULL",
      ).get() as { n: number }).n;
      if (restored < indexes.length) {
        throw new Error(`cm_mappings rebuild lost indexes: ${indexes.length} -> ${restored}`);
      }
      database.exec('COMMIT');
      database.exec('PRAGMA foreign_keys = ON');
      console.log(`[DB] cm_mappings: added unit_type_id axis (${before} row(s), ${restored} index(es) kept)`);
    }
  } catch (e: any) {
    try { database.exec('ROLLBACK'); } catch { /* not inside a transaction */ }
    database.exec('PRAGMA foreign_keys = ON');
    console.error('[DB] cm_mappings unit_type_id migration:', e.message);
  }

  // Черга вихідних змін. Тримає КООРДИНАТУ, а не значення: колонки під
  // число тут немає навмисно. Поточну наявність батчер читає через
  // availabilityByDay(), ціну через priceNights() — інакше два записи за
  // 40 секунд дали б дві відправки з різними числами, і в канал поїхало б
  // застаріле, виглядаючи як успіх.
  //
  // Дві смуги, бо менеджер каналів обробляє наявність окремим швидшим
  // шляхом; змішати їх означає сповільнити найтерміновіше.
  database.exec(`
    CREATE TABLE IF NOT EXISTS cm_outbox (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      connection_id   TEXT NOT NULL REFERENCES cm_connections(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL CHECK (kind IN ('availability', 'rate')),
      unit_type_id    TEXT,
      rate_plan_id    TEXT,
      stay_date       TEXT NOT NULL,
      stay_date_to    TEXT,
      claimed_at      TEXT,
      sent_at         TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_error      TEXT,
      receipt         TEXT,
      field_mask      INTEGER,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Ц15: координата може бути ДІАПАЗОНОМ ночей — stay_date..stay_date_to
  // включно, NULL = одна ніч. Запис матриці цін без дат це кожна майбутня
  // ніч: подобово — тисячі рядків на зʼєднання за одну правку, діапазоном —
  // один. І в CREATE, і тут: інакше новий клієнт отримає базу без колонки,
  // яку читає батчер (AGENTS §4).
  try {
    const obCols = (database.prepare('PRAGMA table_info(cm_outbox)').all() as any[]).map((c: any) => c.name);
    if (!obCols.includes('stay_date_to')) {
      database.exec('ALTER TABLE cm_outbox ADD COLUMN stay_date_to TEXT');
      console.log('[DB] Added stay_date_to to cm_outbox');
    }
    // П6: розписка вендора (task id) на відправленій координаті. Вендор
    // приймає ціну як задачу — без розписки асинхронний провал невидимий, а
    // форма сертифікації просить саме її. І в CREATE, і тут (AGENTS §4).
    if (!obCols.includes('receipt')) {
      database.exec('ALTER TABLE cm_outbox ADD COLUMN receipt TEXT');
      console.log('[DB] Added receipt to cm_outbox');
    }
    // Блок 0.5 (0066): маска змінених полів — біти в порядку RATE_FIELDS
    // домену; NULL = усі (повний синк, старі рядки). Лист Channex 05.09:
    // тіло несло весь стан замість дельти. І в CREATE, і тут (AGENTS §4).
    if (!obCols.includes('field_mask')) {
      database.exec('ALTER TABLE cm_outbox ADD COLUMN field_mask INTEGER');
      console.log('[DB] Added field_mask to cm_outbox');
    }
  } catch (e: any) {
    console.error('[DB] cm_outbox stay_date_to:', e.message);
  }
  // Злиття тримає СХЕМА, а не порядок викликів: «спитати й вставити» лишає
  // вікно між двома кроками, і злиття існує доти, доки писач один.
  // COALESCE обовʼязково — UNIQUE не обмежує NULL на жодному двигуні, а
  // rate_plan_id порожній у кожного рядка наявності (пастка price_occupancy).
  // Предикат claimed_at IS NULL — суть, а не оптимізація: захоплений рядок
  // уже в польоті, і нова зміна мусить стати ОКРЕМИМ рядком.
  // Кінець діапазону — частина ключа: той самий діапазон двічі це один
  // рядок, а два різні — два (перекриття безпечне, Ц13). Індекс без кінця
  // знімається один раз — CREATE IF NOT EXISTS за іменем його не оновив би.
  try {
    const coordIdx = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_cm_outbox_coord'",
    ).get() as { sql?: string } | undefined;
    if (coordIdx?.sql && !coordIdx.sql.includes('stay_date_to')) {
      database.exec('DROP INDEX idx_cm_outbox_coord');
      console.log('[DB] Rebuilding idx_cm_outbox_coord with the range end');
    }
  } catch (e: any) {
    console.error('[DB] idx_cm_outbox_coord:', e.message);
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_outbox_coord
      ON cm_outbox(connection_id, kind, (COALESCE(unit_type_id, '')), (COALESCE(rate_plan_id, '')), stay_date, (COALESCE(stay_date_to, stay_date)))
      WHERE claimed_at IS NULL AND sent_at IS NULL
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_outbox_org ON cm_outbox(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_outbox_pending ON cm_outbox(connection_id, kind) WHERE sent_at IS NULL AND claimed_at IS NULL');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_outbox_claimed ON cm_outbox(connection_id) WHERE claimed_at IS NOT NULL AND sent_at IS NULL');

  // Журнал відправлень з ТІЛОМ (Блок 0.5 п.4, 0066): кожен виклик до
  // менеджера каналів — рядком: смуга, тіло дослівно, статус, розписка,
  // скільки значень і які ключі (summary, JSON нашими координатами).
  // Розписка на координаті каже, ЩО поїхало, і не каже, з якими ПОЛЯМИ — а
  // саме за поля вендор відхилив сертифікацію 05.09. Невдалий виклик — теж
  // рядок. Без ПІБ і без секретів, тож ретенція 90 днів кроном GDPR.
  database.exec(`
    CREATE TABLE IF NOT EXISTS cm_sends (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      connection_id   TEXT NOT NULL REFERENCES cm_connections(id) ON DELETE CASCADE,
      lane            TEXT NOT NULL CHECK (lane IN ('availability', 'rate')),
      sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
      task_id         TEXT,
      request_body    TEXT NOT NULL,
      response_status INTEGER,
      error           TEXT,
      rows_count      INTEGER NOT NULL DEFAULT 0,
      summary         TEXT
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_sends_org ON cm_sends(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_sends_connection ON cm_sends(connection_id, sent_at)');

  // Сирі вхідні події. Вебхук кладе рядок і відповідає 200 — жодного запиту
  // до менеджера каналів і жодної доменної роботи в ньому: повільна
  // відповідь стає причиною повторної доставки, а та — ще однієї повільної.
  database.exec(`
    CREATE TABLE IF NOT EXISTS cm_events (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      connection_id   TEXT NOT NULL REFERENCES cm_connections(id) ON DELETE CASCADE,
      event_type      TEXT NOT NULL,
      payload         TEXT NOT NULL,
      received_at     TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at    TEXT
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_events_org ON cm_events(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_events_unprocessed ON cm_events(connection_id) WHERE processed_at IS NULL');

  // Ц7: зсув точки збуту на зʼєднанні. І в CREATE, і тут — інакше новий
  // клієнт отримає базу без колонки, яку читає батчер (AGENTS §4).
  try {
    const cmCols = (database.prepare('PRAGMA table_info(cm_connections)').all() as any[]).map((c: any) => c.name);
    if (!cmCols.includes('pricing_modifier_percent')) {
      database.exec('ALTER TABLE cm_connections ADD COLUMN pricing_modifier_percent REAL NOT NULL DEFAULT 0');
      console.log('[DB] Added pricing_modifier_percent to cm_connections');
    }
    // П5: мітка завершеного повного синку. У CREATE є від 0052; база, створена
    // до того, її не має — і без цієї варти читалась би як «колонки немає».
    if (!cmCols.includes('catalog_synced_at')) {
      database.exec('ALTER TABLE cm_connections ADD COLUMN catalog_synced_at TEXT');
      console.log('[DB] Added catalog_synced_at to cm_connections');
    }
    if (!cmCols.includes('last_full_sync_at')) {
      database.exec('ALTER TABLE cm_connections ADD COLUMN last_full_sync_at TEXT');
      console.log('[DB] Added last_full_sync_at to cm_connections');
    }
  } catch (e: any) {
    console.error('[DB] cm_connections pricing_modifier_percent:', e.message);
  }

  console.log('[DB] cm_connections + cm_inbound_bookings + cm_mappings + cm_outbox + cm_events ready');

  // --- Migration: gift_card_templates ---
  //
  // Шаблони ваучерів, які готель пропонує до видачі. Раніше це була константа
  // `GIFT_CARD_TEMPLATES` у коді модуля — шість шаблонів із цінами й
  // продуктами ОДНОГО кемпінгу, які бачив кожен готель на сервері.
  //
  // Порожня таблиця — нормальний і правильний стан нового клієнта: свої
  // пропозиції він заводить сам. Нічого не сіється (див. міграцію 0047: там
  // шість рядків дістаються лише тим організаціям, які вже видавали ваучери
  // за цими шаблонами — за даними, не за назвою готелю).
  database.exec(`
    CREATE TABLE IF NOT EXISTS gift_card_templates (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      template_key    TEXT NOT NULL,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      type            TEXT NOT NULL DEFAULT 'open_date',
      value_type      TEXT NOT NULL DEFAULT 'fixed_czk',
      face_value      REAL NOT NULL DEFAULT 0,
      currency        TEXT NOT NULL,
      config_json     TEXT NOT NULL DEFAULT '{}',
      emoji           TEXT NOT NULL DEFAULT '🎁',
      badge           TEXT NOT NULL DEFAULT '',
      validity_months INTEGER NOT NULL DEFAULT 12,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (organization_id, template_key)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_gift_card_templates_org ON gift_card_templates(organization_id)');

  // --- Migration: gift_card_bundles (bundle/package gift_cards) ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS gift_card_bundles (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      site_id         TEXT NOT NULL,
      name            TEXT NOT NULL,
      description     TEXT,
      price           REAL NOT NULL DEFAULT 0,
      currency        TEXT NOT NULL DEFAULT 'CZK',
      nights_included INTEGER NOT NULL DEFAULT 0,
      listing_type    TEXT,
      included_services TEXT NOT NULL DEFAULT '[]',
      validity_months INTEGER NOT NULL DEFAULT 12,
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_vb_site ON gift_card_bundles(site_id)');

  // --- Migration: add bundle_id to gift_cards ---
  try {
    database.exec(`ALTER TABLE gift_cards ADD COLUMN bundle_id TEXT REFERENCES gift_card_bundles(id) ON DELETE SET NULL`);
  } catch { /* already exists */ }

  // --- Migration: add allowed_days to gift_card_bundles ---
  try {
    database.exec(`ALTER TABLE gift_card_bundles ADD COLUMN allowed_days TEXT`);
  } catch { /* already exists */ }

  // --- Migration: add allowed_promo_codes to gift_card_bundles ---
  try {
    database.exec(`ALTER TABLE gift_card_bundles ADD COLUMN allowed_promo_codes TEXT`);
  } catch { /* already exists */ }

  // --- Migration: add price_override and thank_you_url to site_listings ---
  try {
    database.exec(`ALTER TABLE site_listings ADD COLUMN price_override REAL`);
  } catch { /* already exists */ }
  try {
    database.exec(`ALTER TABLE site_listings ADD COLUMN thank_you_url TEXT`);
  } catch { /* already exists */ }

  // --- Migration: add coupon_code, redemption_limit, current_uses to gift_card_bundles ---
  try { database.exec(`ALTER TABLE gift_card_bundles ADD COLUMN coupon_code TEXT`); } catch { /* already exists */ }
  try { database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vb_coupon_code ON gift_card_bundles(coupon_code) WHERE coupon_code IS NOT NULL`); } catch { }
  try { database.exec(`ALTER TABLE gift_card_bundles ADD COLUMN redemption_limit INTEGER DEFAULT 1`); } catch { /* already exists */ }
  try { database.exec(`ALTER TABLE gift_card_bundles ADD COLUMN current_uses INTEGER DEFAULT 0`); } catch { /* already exists */ }
  try { database.exec(`ALTER TABLE gift_card_bundles ADD COLUMN applied_listings TEXT`); } catch { /* already exists */ }

  console.log('[DB] gift_card_bundles ready');

  // ═══════════════════════════════════════════════════════════════════
  // Sub-Bookings: multi-group booking architecture.
  //
  // Adds parent_id to reservations for parent↔child linking (child
  // reservation = same dates/guest, different unit, auto-mirrors
  // status/payment from parent). reservation_sub_bookings holds per-
  // group metadata (label, adults, subtotal). reservation_line_items
  // provides optional price breakdown per sub-booking.
  //
  // `reservation_groups` і колонки `group_id` тут більше немає: групи
  // видалено 2026-08-27 (міграція 0039), sub-bookings лишились єдиним
  // способом сказати «одна бронь — кілька номерів».
  // ═══════════════════════════════════════════════════════════════════

  // --- Migration: add parent_id to reservations ---
  try {
    const resCols = database.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
    if (!resCols.some((c: any) => c.name === 'parent_id')) {
      database.exec("ALTER TABLE reservations ADD COLUMN parent_id TEXT REFERENCES reservations(id) ON DELETE CASCADE");
      database.exec("CREATE INDEX IF NOT EXISTS idx_reservations_parent ON reservations(parent_id)");
      console.log('[DB] Sub-Bookings: added parent_id column to reservations');
    }
  } catch (e: any) { console.log('[DB] Sub-Bookings parent_id migration:', e.message); }

  // --- Migration: create reservation_sub_bookings table ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS reservation_sub_bookings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      child_reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
      label TEXT NOT NULL DEFAULT '',
      adults INTEGER NOT NULL DEFAULT 1,
      children INTEGER NOT NULL DEFAULT 0,
      infants INTEGER NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_sub_bookings_res ON reservation_sub_bookings(reservation_id)');

  // --- Migration: create reservation_line_items table ---
  //
  // Ключ на рядок групи — БЕЗ `ON DELETE CASCADE`, і це рішення власника
  // (В10, реєстр К18): канал володіє тим, що ЗАБРОНЮВАЛИ, готель — тим, що
  // НАРАХУВАЛИ і що вписала людина. Ці рядки — розбивка кімнати між
  // платниками, набрана рецепцією; ревізія з боку OTA не має права стерти їх
  // мовчки, знявши рядок групи.
  //
  // Заборона стоїть у БАЗІ, а не в писачі, навмисно. `releaseGroupRoom` уже
  // не чіпає рядка з позиціями — але це поведінка одного місця, а наступний
  // `DELETE`, написаний деінде, знову стирав би каскадом і не дізнався про
  // це. Тепер він відмовляє.
  database.exec(`
    CREATE TABLE IF NOT EXISTS reservation_line_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      sub_booking_id TEXT NOT NULL REFERENCES reservation_sub_bookings(id),
      description TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      category TEXT DEFAULT 'other',
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_line_items_sub ON reservation_line_items(sub_booking_id)');

  // І для БАЗИ, ЯКА ВЖЕ Є: у SQLite зовнішній ключ живе в тексті CREATE, тож
  // зняти каскад можна лише перебудовою (AGENTS §4 — індекси зняти й
  // повернути, лічильники звірити). Без цього кроку новий клієнт мав би
  // заборону, а мігрований — каскад, і сцена була б зелена рівно там, де її
  // ніхто не перевіряє.
  try {
    const liSql = (database.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='reservation_line_items'",
    ).get() as { sql?: string } | undefined)?.sql ?? '';
    if (/sub_booking_id[^,]*ON DELETE CASCADE/i.test(liSql)) {
      console.log('[DB] reservation_line_items: каскад на рядок групи → заборона (К18) — перебудова зі збереженням індексів');
      const before = (database.prepare('SELECT COUNT(*) AS n FROM reservation_line_items').get() as { n: number }).n;
      const indexSql = (database.prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='reservation_line_items' AND sql IS NOT NULL",
      ).all() as { sql: string }[]).map((r) => r.sql);
      const live = (database.prepare('PRAGMA table_info(reservation_line_items)').all() as { name: string }[])
        .map((c) => c.name);
      const carried = ['id', 'sub_booking_id', 'description', 'quantity', 'unit_price', 'total',
        'category', 'sort_order'].filter((c) => live.includes(c));
      database.exec('PRAGMA foreign_keys = OFF');
      try {
        database.exec('BEGIN');
        database.exec(`
          CREATE TABLE reservation_line_items_new (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            sub_booking_id TEXT NOT NULL REFERENCES reservation_sub_bookings(id),
            description TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1,
            unit_price REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            category TEXT DEFAULT 'other',
            sort_order INTEGER NOT NULL DEFAULT 0
          )
        `);
        database.exec(`INSERT INTO reservation_line_items_new (${carried.join(', ')}) SELECT ${carried.join(', ')} FROM reservation_line_items`);
        database.exec('DROP TABLE reservation_line_items');
        database.exec('ALTER TABLE reservation_line_items_new RENAME TO reservation_line_items');
        for (const ix of indexSql) database.exec(ix);
        database.exec('COMMIT');
      } catch (e) {
        database.exec('ROLLBACK');
        throw e;
      } finally {
        // Прагму повертаємо ЗАВЖДИ: без цього застосунок пішов би далі з
        // `foreign_keys = 0` і обслуговував запити без жодного ключа.
        database.exec('PRAGMA foreign_keys = ON');
      }
      const after = (database.prepare('SELECT COUNT(*) AS n FROM reservation_line_items').get() as { n: number }).n;
      if (after !== before) throw new Error(`reservation_line_items rebuild lost rows: ${before} -> ${after}`);
      const restored = (database.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name='reservation_line_items' AND sql IS NOT NULL",
      ).get() as { n: number }).n;
      if (restored !== indexSql.length) {
        throw new Error(`reservation_line_items rebuild lost indexes: ${indexSql.length} -> ${restored}`);
      }
      console.log(`[DB] reservation_line_items: заборона на місці (${after} рядків, ${restored} індексів)`);
    }
  } catch (e) {
    console.error('[DB] reservation_line_items cascade → restrict:', (e as Error).message);
  }

  // --- Migration: add sub_booking_id to reservation_guests ---
  try {
    const rgCols2 = database.prepare("PRAGMA table_info(reservation_guests)").all() as { name: string }[];
    if (!rgCols2.some((c: any) => c.name === 'sub_booking_id')) {
      database.exec("ALTER TABLE reservation_guests ADD COLUMN sub_booking_id TEXT REFERENCES reservation_sub_bookings(id)");
      console.log('[DB] Sub-Bookings: added sub_booking_id to reservation_guests');
    }
  } catch (e: any) { console.log('[DB] Sub-Bookings sub_booking_id migration:', e.message); }

  // ═══════════════════════════════════════════════════════════════════
  // Operations audit (W4 from finance UX upgrade).
  //
  // Adds `created_by_user_id` + `updated_by_user_id` to `fin_operations`
  // so the operator sees who recorded / last edited each row (e.g.
  // Андрій checking in a guest with cash payment vs. Олег reconciling
  // a bank statement). NULL on legacy rows; backfill is intentionally
  // skipped because we don't know who created them.
  //
  // `fin_operation_audit` stores the full change history. Each insert /
  // update / delete / op_type conversion writes one row with full
  // before/after JSON snapshots (chose `full` over `diff` for easier
  // debugging — disk is cheap, payments need bulletproof audit trail).
  //
  // No FK on operation_id deliberately: audit must survive op deletion
  // so we keep history even after the original row is removed.
  // ═══════════════════════════════════════════════════════════════════
  try {
    const finOpCols = database.prepare("PRAGMA table_info(fin_operations)").all() as { name: string }[];
    if (!finOpCols.some((c: any) => c.name === 'created_by_user_id')) {
      database.exec("ALTER TABLE fin_operations ADD COLUMN created_by_user_id TEXT");
      database.exec("CREATE INDEX IF NOT EXISTS idx_fin_operations_created_by ON fin_operations(created_by_user_id)");
      console.log('[DB] Audit: added created_by_user_id to fin_operations');
    }
    if (!finOpCols.some((c: any) => c.name === 'updated_by_user_id')) {
      database.exec("ALTER TABLE fin_operations ADD COLUMN updated_by_user_id TEXT");
      console.log('[DB] Audit: added updated_by_user_id to fin_operations');
    }
  } catch (e: any) { console.log('[DB] Audit fin_operations columns:', e.message); }

  database.exec(`
    CREATE TABLE IF NOT EXISTS fin_operation_audit (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      operation_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'convert')),
      user_id TEXT,
      user_name TEXT,
      before_json TEXT,
      after_json TEXT,
      performed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_fin_operation_audit_op ON fin_operation_audit(operation_id, performed_at DESC)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_fin_operation_audit_user ON fin_operation_audit(user_id, performed_at DESC)');

  // --- Migration: create task management tables ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS task_projects (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES task_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#4f6ef7',
      icon TEXT DEFAULT '📁',
      property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES task_projects(id) ON DELETE SET NULL,
      parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
      due_date TEXT,
      due_time TEXT,
      assignee_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date)');

  database.exec(`
    CREATE TABLE IF NOT EXISTS task_tags (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6c7086',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS task_tag_links (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, tag_id)
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      content_type TEXT,
      created_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id)');

  // --- Migration: enhance booking_activity_log with user tracking + before/after snapshots ---
  try {
    database.exec("ALTER TABLE booking_activity_log ADD COLUMN user_id TEXT");
  } catch { /* column already exists */ }
  try {
    database.exec("ALTER TABLE booking_activity_log ADD COLUMN user_name TEXT");
  } catch { /* column already exists */ }
  try {
    database.exec("ALTER TABLE booking_activity_log ADD COLUMN before_json TEXT");
  } catch { /* column already exists */ }
  try {
    database.exec("ALTER TABLE booking_activity_log ADD COLUMN after_json TEXT");
  } catch { /* column already exists */ }
  try {
    database.exec("ALTER TABLE booking_activity_log ADD COLUMN booking_label TEXT");
  } catch { /* column already exists */ }

  // --- Migration: recreate booking_activity_log WITHOUT foreign key CASCADE ---
  try {
    // Check if the table still has the CASCADE FK by looking at the SQL
    const tableInfo = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='booking_activity_log'").get() as any;
    if (tableInfo?.sql?.includes('ON DELETE CASCADE')) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS booking_activity_log_new (
          id TEXT PRIMARY KEY,
          reservation_id TEXT,
          action TEXT NOT NULL,
          details TEXT,
          user_id TEXT,
          user_name TEXT,
          before_json TEXT,
          after_json TEXT,
          booking_label TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO booking_activity_log_new SELECT id, reservation_id, action, details,
          CASE WHEN typeof(user_id)='text' THEN user_id ELSE NULL END,
          CASE WHEN typeof(user_name)='text' THEN user_name ELSE NULL END,
          CASE WHEN typeof(before_json)='text' THEN before_json ELSE NULL END,
          CASE WHEN typeof(after_json)='text' THEN after_json ELSE NULL END,
          CASE WHEN typeof(booking_label)='text' THEN booking_label ELSE NULL END,
          created_at
        FROM booking_activity_log;
        DROP TABLE booking_activity_log;
        ALTER TABLE booking_activity_log_new RENAME TO booking_activity_log;
      `);
    }
  } catch (e: any) { console.error('[migration] booking_activity_log FK removal (non-fatal):', e?.message); }

  // ═══ Evidenční kniha (Guest Registry) columns ═══
  try { database.exec("ALTER TABLE reservation_guests ADD COLUMN visa_number TEXT"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE reservation_guests ADD COLUMN purpose_of_stay TEXT"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE reservation_guests ADD COLUMN is_foreigner INTEGER DEFAULT 0"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE reservation_guests ADD COLUMN fee_amount REAL DEFAULT 0"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE reservation_guests ADD COLUMN fee_exempt INTEGER DEFAULT 0"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE reservation_guests ADD COLUMN fee_exempt_reason TEXT"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE reservation_guests ADD COLUMN police_reported INTEGER DEFAULT 0"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE reservation_guests ADD COLUMN police_reported_at TEXT"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE reservation_guests ADD COLUMN police_report_ref TEXT"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE reservation_guests ADD COLUMN is_hidden INTEGER DEFAULT 0"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE guest_registrations ADD COLUMN consent_given INTEGER DEFAULT 0"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE guest_registrations ADD COLUMN consent_at TEXT"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE guest_registrations ADD COLUMN consent_ip TEXT"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE guest_registrations ADD COLUMN purpose_of_stay TEXT"); } catch { /* already exists */ }
  try { database.exec("ALTER TABLE guest_registrations ADD COLUMN visa_number TEXT"); } catch { /* already exists */ }

  // --- Migration: add new columns to reservations for Analytics ---
  try {
    const resCols = database.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
    const colNames = resCols.map((c: any) => c.name);
    if (!colNames.includes('utm_source')) {
      database.exec("ALTER TABLE reservations ADD COLUMN utm_source TEXT");
    }
    if (!colNames.includes('utm_medium')) {
      database.exec("ALTER TABLE reservations ADD COLUMN utm_medium TEXT");
    }
    if (!colNames.includes('utm_campaign')) {
      database.exec("ALTER TABLE reservations ADD COLUMN utm_campaign TEXT");
    }
    if (!colNames.includes('utm_content')) {
      database.exec("ALTER TABLE reservations ADD COLUMN utm_content TEXT");
    }
    if (!colNames.includes('utm_term')) {
      database.exec("ALTER TABLE reservations ADD COLUMN utm_term TEXT");
    }
    if (!colNames.includes('ga_client_id')) {
      database.exec("ALTER TABLE reservations ADD COLUMN ga_client_id TEXT");
    }
    if (!colNames.includes('booking_lang')) {
      database.exec("ALTER TABLE reservations ADD COLUMN booking_lang TEXT");
    }
    if (!colNames.includes('country_code')) {
      database.exec("ALTER TABLE reservations ADD COLUMN country_code TEXT");
    }
    if (!colNames.includes('widget_session_id')) {
      database.exec("ALTER TABLE reservations ADD COLUMN widget_session_id TEXT");
    }
    console.log('[DB] Added Analytics columns to reservations table');
  } catch (e: any) {
    console.log('[DB] reservations analytics columns migration note:', e.message);
  }

  // --- Migration: create widget_events table for tracking ---
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS widget_events (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        site_id TEXT NOT NULL REFERENCES booking_sites(id) ON DELETE CASCADE,
        session_id TEXT,
        event_type TEXT NOT NULL,
        step INTEGER,
        page TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        lang TEXT,
        reservation_id TEXT,
        created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_we_site ON widget_events(site_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_we_type ON widget_events(event_type)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_we_date ON widget_events(created_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_we_session ON widget_events(session_id)');
    console.log('[DB] Created widget_events table and indexes');
  } catch (e: any) {
    console.log('[DB] widget_events migration note:', e.message);
  }

  // --- Migration: add country to widget_events ---
  try {
    const weCols = database.prepare("PRAGMA table_info(widget_events)").all() as { name: string }[];
    if (!weCols.some((c: any) => c.name === 'country')) {
      database.exec("ALTER TABLE widget_events ADD COLUMN country TEXT");
      console.log('[DB] Added country to widget_events');
    }
  } catch (e: any) {
    console.log('[DB] country migration note:', e.message);
  }

  // --- Migration: expand categories table with visibility flags and new types ---
  try {
    const catCols = database.prepare("PRAGMA table_info(categories)").all() as { name: string }[];
    const hasShowInTasks = catCols.some(c => c.name === 'show_in_tasks');
    if (!hasShowInTasks) {
      console.log('[DB] Migrating categories: expanding types + adding visibility flags...');
      database.exec('PRAGMA foreign_keys = OFF');
      database.exec(`
        CREATE TABLE categories_new (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('glamping', 'resort', 'camping', 'facility', 'area', 'zone')),
          description TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          icon TEXT,
          color TEXT,
          show_in_tasks INTEGER NOT NULL DEFAULT 1,
          show_in_finance INTEGER NOT NULL DEFAULT 0,
          show_in_booking INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      database.exec(`
        INSERT INTO categories_new (id, property_id, name, type, description, sort_order, icon, color, created_at)
        SELECT id, property_id, name, type, description, sort_order, icon, color, created_at FROM categories
      `);
      // Mark existing accommodation categories as visible everywhere
      database.exec(`UPDATE categories_new SET show_in_tasks = 1, show_in_finance = 1, show_in_booking = 1`);
      database.exec('DROP TABLE categories');
      database.exec('ALTER TABLE categories_new RENAME TO categories');
      database.exec('PRAGMA foreign_keys = ON');

      // Тут стояв засів «Ресторан / Сауна / Купель / Територія» для
      // `properties LIMIT 1` — обʼєкти ПЕРШОГО клієнта, вписані кожній базі,
      // що мігрувала (свіжа база його пропускала: властивостей ще немає).
      // Прибрано 2026-08-28 разом із рештою спадку: що в готелю є —
      // каже його файл у hotels/, не код (інваріант 20).
      console.log('[DB] Categories migration complete: expanded types + visibility flags');
    }
  } catch (e: any) {
    console.log('[DB] categories expansion note:', e.message);
  }

  // --- Migration: finance_user_access — per-user finance access control ---
  database.exec(`
    CREATE TABLE IF NOT EXISTS finance_user_access (
      user_id          TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      is_enabled       INTEGER NOT NULL DEFAULT 0,
      period_mode      TEXT NOT NULL DEFAULT 'month' CHECK (period_mode IN ('all', 'month')),
      allowed_tabs     TEXT NOT NULL DEFAULT '["operations"]',
      allowed_accounts TEXT NOT NULL DEFAULT '[]',
      can_export       INTEGER NOT NULL DEFAULT 0,
      read_only        INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now'))
    )
  `);
  console.log('[DB] finance_user_access table ready');

  // --- Migration: drop foreign keys pointing at a table that no longer exists
  // The fin_operations migration dropped `expenses`, but accruals.paid_expense_id
  // and receipts.expense_id still reference it. With foreign_keys ON, SQLite
  // rejects every write to those tables with "no such table: main.expenses" — so
  // Accruals and Receipts from Email are not buggy, they are unusable. SQLite
  // cannot drop a foreign key, so the tables are rebuilt without it.
  try {
    for (const [table, deadCol] of [['accruals', 'paid_expense_id'], ['receipts', 'expense_id']] as const) {
      const row = database.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('table', table) as
        | { sql: string }
        | undefined;
      if (!row?.sql || !/REFERENCES\s+expenses\b/i.test(row.sql)) continue;

      // The column and its data stay; only the reference is removed.
      const rebuilt = row.sql.replace(
        new RegExp(`(${deadCol}\\s+TEXT)\\s+REFERENCES\\s+expenses\\s*\\([^)]*\\)(\\s+ON DELETE [A-Z ]+)?`, 'i'),
        '$1',
      );
      const cols = (database.prepare(`PRAGMA table_info(${table})`).all() as any[])
        .map((c: any) => `"${c.name}"`)
        .join(', ');

      // Індекси знімаються ДО підміни й повертаються після. `DROP TABLE`
      // зносить їх разом із таблицею, і мовчки: жодної помилки, просто
      // таблиця без індексів. Тут це коштувало трьох індексів `accruals` у
      // кожного нового клієнта — зокрема по `organization_id`. У сусідній
      // перебудові `reservations` те саме зняло УНІКАЛЬНИЙ індекс на
      // гостьовий токен, тобто вже не швидкість, а два гості на одному
      // посиланні.
      const indexes = (database.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
      ).all(table) as { sql: string }[]).map((r) => r.sql);

      database.exec('PRAGMA foreign_keys = OFF');
      database.exec('BEGIN');
      database.exec(rebuilt.replace(new RegExp(`CREATE TABLE ${table}\\b`, 'i'), `CREATE TABLE ${table}__rebuilt`));
      database.exec(`INSERT INTO ${table}__rebuilt (${cols}) SELECT ${cols} FROM ${table}`);
      database.exec(`DROP TABLE ${table}`);
      database.exec(`ALTER TABLE ${table}__rebuilt RENAME TO ${table}`);
      for (const ix of indexes) {
        database.exec(ix.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, (m) => `${m}IF NOT EXISTS `));
      }
      database.exec('COMMIT');
      database.exec('PRAGMA foreign_keys = ON');

      // Довести, а не сподіватися: мовчазна втрата індексу — рівно те, що ця
      // перебудова робила раніше.
      const restored = (database.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
      ).get(table) as { n: number }).n;
      if (restored < indexes.length) {
        throw new Error(`${table} rebuild lost indexes: ${indexes.length} -> ${restored}`);
      }
      console.log(`[DB] ${table}: removed dead foreign key to dropped table "expenses" (${restored} index(es) kept)`);
    }
  } catch (e: any) {
    try { database.exec('ROLLBACK'); } catch { /* not inside a transaction */ }
    database.exec('PRAGMA foreign_keys = ON');
    console.error('[DB] dead foreign key migration:', e.message);
  }

  // --- Migration: legal and banking identity on the organization -----------
  // Invoices, the booking wizard footer, the terms and the privacy policy all
  // carried one company's identity as literals — including its tax number and
  // its IBAN. Another tenant's invoice would have shown that bank account, and
  // guests would have paid the wrong company. These belong to the tenant.
  try {
    const orgCols = (database.prepare('PRAGMA table_info(organizations)').all() as any[]).map((c: any) => c.name);
    const add = (col: string, decl: string) => {
      if (!orgCols.includes(col)) database.exec(`ALTER TABLE organizations ADD COLUMN ${col} ${decl}`);
    };
    // Блок 6: «розширені ціни» — перемикач ГОТЕЛЮ, не браузера.
    //
    // Вимкнений за замовчуванням: екран цін показує «Ціну» і «Мін. ночей», а
    // вихідні, матриця, CTA/CTD і максимум ховаються за перемикачем. Привід —
    // 07.09.2026: власник, автор системи, не зміг поставити ціну 333, бо на
    // дні лежала невидима йому ціна вихідних. Для готелю на 1–15 номерів
    // повний екран непрохідний, а стан «я вже розібрався» належить готелю, а
    // не конкретному браузеру: інакше другий адміністратор бачить інший екран.
    add('pricing_advanced', 'INTEGER NOT NULL DEFAULT 0');
    add('legal_name', 'TEXT');
    add('registration_no', 'TEXT');   // IČO
    add('vat_no', 'TEXT');            // DIČ
    add('is_vat_payer', 'INTEGER NOT NULL DEFAULT 0');
    add('legal_address', 'TEXT');
    add('bank_name', 'TEXT');
    add('bank_account', 'TEXT');
    add('iban', 'TEXT');
    add('swift', 'TEXT');
    add('invoice_email', 'TEXT');
    add('website', 'TEXT');
    // Sending a guest's identity document to OpenAI is a transfer outside the
    // EU and has to be the organization's decision, so it defaults to off.
    // Local MRZ reading still runs either way.
    add('ocr_cloud_fallback', 'INTEGER NOT NULL DEFAULT 0');
    // Ц30 (0070): вікові вилки дітей. І в CREATE, і тут.
    add('child_age_bands', "TEXT NOT NULL DEFAULT '[]'");
    if (orgCols.length < 18) console.log('[DB] organizations: legal & banking columns ready');
  } catch (e: any) {
    console.log('[DB] organization legal columns migration note:', e.message);
  }

  // --- Migration: language belongs to the customer, not to the source code ---
  // Ukrainian used to be written into the JSX, into the guest portal's default
  // and into the translation prompt ("Translate the following Ukrainian texts
  // to …"). A German hotel typing German names would have had them translated
  // *from Ukrainian*. The base language is now the organization's, and one
  // person may override it for themselves.
  try {
    const orgCols = (database.prepare('PRAGMA table_info(organizations)').all() as any[]).map((c: any) => c.name);
    if (!orgCols.includes('language')) {
      // Existing installations are Ukrainian — that is what their data is in.
      database.exec("ALTER TABLE organizations ADD COLUMN language TEXT NOT NULL DEFAULT 'uk'");
      console.log('[DB] organizations: base language column added');
    }
    const userCols = (database.prepare('PRAGMA table_info(app_users)').all() as any[]).map((c: any) => c.name);
    if (!userCols.includes('language')) {
      // Nullable: NULL means "follow the hotel", which is the sane default and
      // keeps following it when the hotel changes.
      database.exec('ALTER TABLE app_users ADD COLUMN language TEXT');
      console.log('[DB] app_users: personal language column added');
    }
  } catch (e: any) {
    console.log('[DB] language columns migration note:', e.message);
  }

  // --- Migration: the finance wrapper is gone ---
  // Bank inboxes, statement import, the import wizard, email-forwarded
  // receipts, reconciliation, clearing, accruals and the finance calendar were
  // cut so what is left is the part every hotel needs: the money ledger,
  // invoices, accounts and reports. Preserved at `finance-wrapper-before-removal`
  // and on branch `archive/finance-wrapper`.
  //
  // Not everything here goes. bank_transactions, fin_channel_receivables and
  // accruals still have live readers in the operations audit and the balance
  // sheet, so only the tables nothing reads are dropped — and bank_statements
  // stays with them, because bank_transactions has a foreign key to it and a
  // key pointing at a dropped table makes SQLite refuse every statement that
  // touches the row. Only the *import* is gone; an operation can still be
  // linked to a bank transaction.
  try {
    const wrapperTables = ['fin_bank_inboxes', 'fin_receipt_inboxes',
      'fin_pending_receipts', 'import_formats', 'import_entity_mappings', 'import_runs',
      'fin_channel_receivables_pr21', 'receipts'];
    let dropped = 0;
    for (const t of wrapperTables) {
      const exists = database.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', t);
      if (!exists) continue;
      database.exec(`DROP TABLE IF EXISTS "${t}"`);
      dropped++;
    }
    if (dropped) console.log(`[DB] finance wrapper: dropped ${dropped} tables`);
  } catch (e: any) {
    console.error('[DB] finance wrapper table removal:', e.message);
  }

  // --- Migration: the investor module is gone ---
  // Same reasoning as the CRM: a very individual, half-built feature that made
  // the product harder to explain and the codebase harder to move. Preserved
  // at the tag `investors-before-removal` and on branch `archive/investors`.
  try {
    const invTables = (database.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
       AND (name LIKE 'investor%' OR name IN ('forecast_scenarios', 'property_monthly_metrics',
            'property_monthly_reports', 'property_work_stages'))`,
    ).all() as any[]).map((r: any) => r.name);
    for (const t of invTables) database.exec(`DROP TABLE IF EXISTS "${t}"`);
    if (invTables.length) console.log(`[DB] investors: dropped ${invTables.length} tables`);
  } catch (e: any) {
    console.error('[DB] investor table removal:', e.message);
  }

  // --- Migration: the CRM is gone ---
  // It was half-built and shaped around one hotel's way of working, so it was
  // cut to get the core of the PMS right first. The code lives on the
  // `archive/crm` branch and at the `crm-before-removal` tag; when a new CRM is
  // designed, that is where the experience is — not in tables nobody writes to.
  //
  // Dropped rather than left standing: an unused table is one the Postgres
  // migration still has to carry and the isolation audit still has to classify.
  try {
    const crmTables = (database.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
       AND (name LIKE 'crm_%' OR name IN ('incoming_leads', 'site_capture_scripts', 'whatsapp_templates'))`,
    ).all() as any[]).map((r: any) => r.name);
    for (const t of crmTables) database.exec(`DROP TABLE IF EXISTS "${t}"`);
    if (crmTables.length) console.log(`[DB] CRM: dropped ${crmTables.length} tables`);

    // site_incoming_leads survives — the site analytics tab counts form
    // submissions — but it pointed at site_capture_scripts, which has just
    // gone. A foreign key to a table that does not exist makes SQLite refuse
    // to prepare any statement touching the row, including a DELETE on
    // properties three joins away. That is exactly how accruals and receipts
    // were unusable before, so: rebuild without the dead column.
    const silSql = (database.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'site_incoming_leads') as { sql: string } | undefined)?.sql || '';
    if (/REFERENCES\s+site_capture_scripts/i.test(silSql)) {
      database.exec('ALTER TABLE site_incoming_leads RENAME TO site_incoming_leads_old');
      database.exec(`
        CREATE TABLE site_incoming_leads (
          id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          site_id     TEXT NOT NULL REFERENCES booking_sites(id) ON DELETE CASCADE,
          full_name   TEXT,
          email       TEXT,
          phone       TEXT,
          message     TEXT,
          status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      // Only the columns Postgres also has: the old table on a live database
      // has no source_url, so naming it here made this rebuild throw and be
      // swallowed by the catch below — leaving the dead foreign key in place,
      // which is the whole thing this block exists to remove.
      database.exec(`
        INSERT INTO site_incoming_leads
          (id, site_id, full_name, email, phone, message, status, created_at)
        SELECT id, site_id, full_name, email, phone, message, status, created_at
        FROM site_incoming_leads_old
      `);
      database.exec('DROP TABLE site_incoming_leads_old');
      console.log('[DB] site_incoming_leads: dead foreign key removed');
    }
  } catch (e: any) {
    console.error('[DB] CRM table removal:', e.message);
  }

  // --- Migration: the last tables with no path to an organization ---
  // Everything else in the schema reaches an organization either directly or
  // through a foreign key. These did not, by any route, which means every
  // customer shared the rows: one hotel's public price list, another's booking
  // drafts, a third's gift-card bundles, all in the same table with nothing to
  // tell them apart. organization_id is added directly rather than by declaring
  // a foreign key, because SQLite cannot add one without rebuilding the table
  // and because a direct column is what Postgres row-level security will key on
  // later.
  //
  // Backfill: from the row's natural parent where it has one, otherwise from
  // the sole organization. On a server that already has more than one, rows
  // that cannot be attributed are left NULL and counted — guessing would file
  // one hotel's data under another.
  try {
    const orgs = database.prepare('SELECT id FROM organizations').all() as any[];
    const soleOrg = orgs.length === 1 ? orgs[0].id : null;

    /** Where a row's organization can be read from, when it can. */
    const BACKFILL: Record<string, string | null> = {
      availability_blocks:
        'UPDATE availability_blocks SET organization_id = (SELECT p.organization_id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = availability_blocks.unit_id) WHERE organization_id IS NULL',
      fin_operation_audit:
        'UPDATE fin_operation_audit SET organization_id = (SELECT o.organization_id FROM fin_operations o WHERE o.id = fin_operation_audit.operation_id) WHERE organization_id IS NULL',
      gift_card_bundles:
        'UPDATE gift_card_bundles SET organization_id = (SELECT p.organization_id FROM booking_sites s JOIN properties p ON p.id = s.property_id WHERE s.id = gift_card_bundles.site_id) WHERE organization_id IS NULL',
      gift_card_automation_rules:
        'UPDATE gift_card_automation_rules SET organization_id = (SELECT p.organization_id FROM booking_sites s JOIN properties p ON p.id = s.property_id WHERE s.id = gift_card_automation_rules.site_id) WHERE organization_id IS NULL',
      // A webhook for a payment we could not match has no reservation and so no
      // owner; those rows stay NULL on purpose.
      // The rebuild that gave this table user_id/before_json/after_json also
      // dropped its `FOREIGN KEY (reservation_id) REFERENCES reservations(id)`,
      // so it lost its only path to an organization — and rows now outlive the
      // booking they describe. The column below restores the path; the missing
      // foreign key is handled in the rebuild that follows.
      booking_activity_log:
        'UPDATE booking_activity_log SET organization_id = (SELECT p.organization_id FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.id = booking_activity_log.reservation_id) WHERE organization_id IS NULL AND reservation_id IS NOT NULL',
      booking_drafts: null,
      widget_price_list: null,
      widget_handshakes: null,
    };

    // Created here rather than left to the handler that lazily CREATE ... IF
    // NOT EXISTS it, so the first shape on disk is the scoped one.
    database.exec(`
      CREATE TABLE IF NOT EXISTS widget_handshakes (
        token TEXT PRIMARY KEY,
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        site_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
      )
    `);

    let stranded = 0;
    for (const [table, backfill] of Object.entries(BACKFILL)) {
      const cols = (database.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c: any) => c.name);
      if (cols.length === 0) continue; // table not in this database
      if (!cols.includes('organization_id')) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`);
      }
      if (backfill) database.exec(backfill);
      if (soleOrg) {
        database.prepare(`UPDATE ${table} SET organization_id = ? WHERE organization_id IS NULL`).run(soleOrg);
      }
      database.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_org ON ${table}(organization_id)`);
      const left = (database.prepare(
        `SELECT COUNT(*) c FROM ${table} WHERE organization_id IS NULL`,
      ).get() as any).c;
      // `payment_webhook_log` тут більше не називається — таблиці немає
      // (міграція 0043). `booking_activity_log` лишається: у нього справді
      // бувають рядки без орендаря, і це не помилка.
      if (left && table !== 'booking_activity_log') {
        stranded += left;
        console.error(`[DB] ${table}: ${left} rows have no organization`);
      }
    }
    // Standalone invoices — ones not tied to a reservation — and credit notes.
    // Four routes write and read these columns and no migration ever created
    // them, so /api/invoices/custom, /api/invoices/export,
    // /api/accounting/invoices/list and /api/accounting/reconciliation all
    // answered 500 on every call. The custom-invoice route even carries the
    // comment "requires migration that makes reservation_id nullable"; this is
    // that migration.
    const invColsNow = (database.prepare('PRAGMA table_info(invoices)').all() as any[]);
    const invNames = invColsNow.map((c: any) => c.name);
    const reservationRequired = invColsNow.some((c: any) => c.name === 'reservation_id' && c.notnull);
    if (reservationRequired) {
      database.exec('ALTER TABLE invoices RENAME TO invoices_pre_custom');
      database.exec(`
        CREATE TABLE invoices (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          reservation_id TEXT REFERENCES reservations(id) ON DELETE CASCADE,
          invoice_number TEXT NOT NULL,
          issued_at TEXT NOT NULL DEFAULT (datetime('now')),
          due_date TEXT,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'CZK',
          status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled', 'storno', 'corrected')),
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          series TEXT DEFAULT 'HOUSE',
          period TEXT,
          locked INTEGER NOT NULL DEFAULT 0,
          confirmed INTEGER NOT NULL DEFAULT 0,
          confirmation_source TEXT,
          is_custom INTEGER NOT NULL DEFAULT 0,
          is_credit_note INTEGER NOT NULL DEFAULT 0,
          fin_operation_id TEXT REFERENCES fin_operations(id) ON DELETE SET NULL,
          custom_buyer_name TEXT,
          custom_buyer_ico TEXT,
          custom_buyer_dic TEXT,
          custom_buyer_address TEXT,
          custom_buyer_city TEXT,
          custom_buyer_country TEXT,
          custom_description TEXT,
          custom_email TEXT,
          UNIQUE (organization_id, invoice_number)
        )
      `);
      const carry = invNames.filter((c: string) => c !== 'rowid');
      database.exec(`INSERT INTO invoices (${carry.join(', ')}) SELECT ${carry.join(', ')} FROM invoices_pre_custom`);
      database.exec('DROP TABLE invoices_pre_custom');
      database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_reservation ON invoices(reservation_id)');
      database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(organization_id, invoice_number)');
      database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_issued ON invoices(issued_at)');
      console.log('[DB] invoices: standalone invoices and credit notes are possible now');
    }

    // Per-room door code and entry photo. The rooms list, the room editor and
    // the guest page all read and write these, but no migration ever created
    // the columns — so `GET /api/units` answered 500 on every call, and with it
    // the rooms screen and everything that lists a room.
    for (const [col, decl] of [['lock_code', 'TEXT'], ['entry_photo_url', 'TEXT']] as const) {
      const cols = (database.prepare('PRAGMA table_info(units)').all() as any[]).map((c: any) => c.name);
      if (!cols.includes(col)) database.exec(`ALTER TABLE units ADD COLUMN ${col} ${decl}`);
    }

    // Restore the foreign key the earlier rebuild dropped, so an activity-log
    // row cannot outlive the booking it describes.
    const balSql = (database.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'booking_activity_log') as { sql: string } | undefined)?.sql || '';
    if (balSql && !/REFERENCES\s+reservations/i.test(balSql)) {
      const cols = (database.prepare('PRAGMA table_info(booking_activity_log)').all() as any[]).map((c: any) => c.name);
      database.exec('DELETE FROM booking_activity_log WHERE reservation_id IS NULL OR reservation_id NOT IN (SELECT id FROM reservations)');
      database.exec('ALTER TABLE booking_activity_log RENAME TO booking_activity_log_orphan');
      database.exec(`
        CREATE TABLE booking_activity_log (
          id TEXT PRIMARY KEY,
          organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
          reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          details TEXT,
          user_id TEXT,
          user_name TEXT,
          before_json TEXT,
          after_json TEXT,
          booking_label TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      const carried = cols.filter((c: string) => c !== 'organization_id');
      database.exec(`INSERT INTO booking_activity_log (${carried.join(', ')}) SELECT ${carried.join(', ')} FROM booking_activity_log_orphan`);
      database.exec('DROP TABLE booking_activity_log_orphan');
      database.exec('CREATE INDEX IF NOT EXISTS idx_booking_activity_log_org ON booking_activity_log(organization_id)');
      console.log('[DB] booking_activity_log: foreign key to reservations restored');
    }

    if (!stranded) console.log('[DB] every table now reaches an organization');
  } catch (e: any) {
    console.error('[DB] organization_id backfill migration:', e.message);
  }

  // --- Migration: uniqueness is per organization, not per server ---
  // A promo code, a price-list item code and a gift-card code are all values a
  // person types in. Two hotels both want SUMMER25, and with a server-wide
  // UNIQUE the second one to try is simply refused — the first customer to
  // choose a code takes it away from everyone else. SQLite cannot drop a
  // constraint, so each of these tables is rebuilt with the organization added
  // to the key.
  try {
    /** Re-key a UNIQUE so it starts with organization_id. */
    const rescope = (table: string, cols: string[]) => {
      const row = database.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
        .get('table', table) as { sql: string } | undefined;
      if (!row) return;
      const tableCols = (database.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c: any) => c.name);
      if (!tableCols.includes('organization_id')) return; // scoped some other way
      if (new RegExp(`UNIQUE\\s*\\(\\s*organization_id`, 'i').test(row.sql)) return; // already done

      let ddl = row.sql;
      for (const col of cols) {
        // Inline form: `code TEXT UNIQUE NOT NULL`
        ddl = ddl.replace(new RegExp(`(^|[\\s,(])(${col}\\s+[A-Z]+[^,\\n]*?)\\bUNIQUE\\b`, 'i'), '$1$2');
      }
      // Table-level form: `UNIQUE (scope, scope_id, month)`
      ddl = ddl.replace(new RegExp(`,?\\s*UNIQUE\\s*\\([^)]*\\b${cols[0]}\\b[^)]*\\)`, 'i'), '');
      const close = ddl.lastIndexOf(')');
      ddl = `${ddl.slice(0, close)}, UNIQUE (organization_id, ${cols.join(', ')})${ddl.slice(close)}`;

      const indexes = (database.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
      ).all(table) as any[]).map((r: any) => r.sql);

      database.exec(`ALTER TABLE ${table} RENAME TO ${table}_old`);
      database.exec(ddl);
      const carried = tableCols.join(', ');
      database.exec(`INSERT INTO ${table} (${carried}) SELECT ${carried} FROM ${table}_old`);
      database.exec(`DROP TABLE ${table}_old`);
      for (const ix of indexes) {
        try { database.exec(ix); } catch { /* renamed away with the old table */ }
      }
      console.log(`[DB] ${table}: UNIQUE re-keyed to (organization_id, ${cols.join(', ')})`);
    };

    // coupons and gift_cards reach an organization only through a site or a
    // property, which is not something a UNIQUE can key on.
    for (const [table, backfill] of [
      ['coupons', 'UPDATE coupons SET organization_id = (SELECT p.organization_id FROM booking_sites s JOIN properties p ON p.id = s.property_id WHERE s.id = coupons.site_id) WHERE organization_id IS NULL AND site_id IS NOT NULL'],
      ['gift_cards', 'UPDATE gift_cards SET organization_id = (SELECT p.organization_id FROM properties p WHERE p.id = gift_cards.property_id) WHERE organization_id IS NULL'],
    ] as const) {
      const cols = (database.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c: any) => c.name);
      if (cols.length === 0 || cols.includes('organization_id')) continue;
      database.exec(`ALTER TABLE ${table} ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`);
      database.exec(backfill);
      const orgs = database.prepare('SELECT id FROM organizations').all() as any[];
      if (orgs.length === 1) {
        database.prepare(`UPDATE ${table} SET organization_id = ? WHERE organization_id IS NULL`).run(orgs[0].id);
      }
      database.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_org ON ${table}(organization_id)`);
    }

    // The widget's cash-confirmation PIN belonged to four named people from the
    // original hotel and lived in the source. It is a staff credential, so it
    // belongs to the staff row that already carries the organization and the
    // cash account to route the payment to.
    try {
      const userCols = (database.prepare('PRAGMA table_info(app_users)').all() as any[]).map((c: any) => c.name);
      if (!userCols.includes('payment_pin_hash')) {
        database.exec('ALTER TABLE app_users ADD COLUMN payment_pin_hash TEXT');
      }
    } catch (e: any) {
      console.error('[DB] app_users.payment_pin_hash:', e.message);
    }

    rescope('coupons', ['code']);
    rescope('gift_cards', ['code']);
    rescope('widget_price_list', ['item_code']);
    // Left global on purpose: ical_channels.export_token and
    // booking_drafts.session_id are random values used as the whole lookup key
    // from a public URL. Server-wide uniqueness is what makes that lookup
    // unambiguous; adding the organization would weaken it, not scope it.
  } catch (e: any) {
    console.error('[DB] per-organization uniqueness migration:', e.message);
  }

  // --- Migration: the city tax rate is the property's, not the code's ---
  //
  // The registry computed the fee as literal `nights * 20` — one country's
  // rate from one year, applied to every hotel. Existing properties get 20 so
  // nothing changes for them; a new property starts at 0 until its owner sets
  // the real local rate in Settings.
  try {
    const propCols = (database.prepare('PRAGMA table_info(properties)').all() as any[])
      .map((c: any) => c.name);
    if (!propCols.includes('city_tax_per_night')) {
      database.exec("ALTER TABLE properties ADD COLUMN city_tax_per_night REAL NOT NULL DEFAULT 0");
      database.exec('UPDATE properties SET city_tax_per_night = 20');
    }
  } catch (e: any) {
    console.error('[DB] city_tax_per_night migration:', e.message);
  }

  // --- Migration: reservations.unit_id may be NULL (CP3) ---
  //
  // Бронь із каналу приходить на ТИП номера, без кімнати. Postgres це вміє
  // одним `DROP NOT NULL` (міграція 0051); SQLite послабити обмеження не
  // вміє взагалі — лише перестворенням таблиці.
  //
  // Схема НЕ пишеться руками. `CREATE` береться з живої бази і в ньому
  // знімається рівно одне `NOT NULL`: `reservations` за рік обросла
  // десятками колонок від міграцій, і хардкоджений список їх би втратив —
  // рівно те, чим небезпечна перебудова поруч (гілка `CHECK (source IN`
  // вище несе список із 20 колонок і сьогодні знищила б решту).
  try {
    const createSql = (database.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='reservations'",
    ).get() as { sql?: string } | undefined)?.sql;

    if (createSql && /\bunit_id\s+TEXT\s+NOT\s+NULL/i.test(createSql)) {
      const cols = (database.prepare('PRAGMA table_info(reservations)').all() as any[])
        .map((c: any) => c.name);
      const before = (database.prepare('SELECT COUNT(*) AS n FROM reservations').get() as { n: number }).n;

      // Індекси знімаються ЗАЗДАЛЕГІДЬ і відтворюються після підміни.
      //
      // У SQLite знесення таблиці забирає з собою всі її індекси. Перший
      // варіант цієї міграції відтворював рівно один — і мовчки втратив
      // решту шість, включно з УНІКАЛЬНИМ `idx_reservations_guest_token`.
      // Гостьове посилання без унікальності — це два гості на один токен.
      //
      // Зловив це не тест, а `scripts/pg-schema.mjs`: він читає живу SQLite,
      // і індекси просто зникли з diff-у Postgres-схеми. Тому список
      // береться з бази, а не пишеться руками — рукописний розійдеться з
      // наступною міграцією, яка додасть індекс.
      const indexes = (database.prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='reservations' AND sql IS NOT NULL",
      ).all() as { sql: string }[]).map((r) => r.sql);

      const newSql = createSql
        .replace(/CREATE\s+TABLE\s+"?reservations"?/i, 'CREATE TABLE reservations__unitnull')
        .replace(/(\bunit_id\s+TEXT\s+)NOT\s+NULL\s+/i, '$1');

      // Ключі вимикаються на час підміни: інакше знесення старої таблиці
      // забрало б із собою рядки всіх, хто на неї каскадно посилається.
      database.exec('PRAGMA foreign_keys = OFF');
      database.exec(newSql);
      database.exec(
        `INSERT INTO reservations__unitnull (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM reservations`,
      );
      database.exec('DROP TABLE reservations');
      database.exec('ALTER TABLE reservations__unitnull RENAME TO reservations');
      database.exec('PRAGMA foreign_keys = ON');

      // Перебудова, яка загубила броні, гірша за обмеження, яке вона знімала.
      const after = (database.prepare('SELECT COUNT(*) AS n FROM reservations').get() as { n: number }).n;
      if (after !== before) {
        throw new Error(`reservations rebuild lost rows: ${before} -> ${after}`);
      }

      for (const idx of indexes) {
        database.exec(idx.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, (m) => `${m}IF NOT EXISTS `));
      }
      database.exec('CREATE INDEX IF NOT EXISTS idx_reservations_unit_type ON reservations(unit_type_id)');

      // Індекс не відтворився — краще впасти тут, ніж віддати базу без
      // унікальності гостьового токена й дізнатись про це від двох гостей.
      const restored = (database.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name='reservations' AND sql IS NOT NULL",
      ).get() as { n: number }).n;
      if (restored < indexes.length) {
        throw new Error(`reservations rebuild lost indexes: ${indexes.length} -> ${restored}`);
      }
      console.log(`[DB] reservations.unit_id is nullable now (${restored} indexes intact) — a booking may arrive without a room`);
    }

    // Частковий індекс під непризначені броні. ПОЗА блоком перебудови, бо
    // потрібен він і тим базам, де колонка вже nullable і перебудова не
    // вмикається.
    //
    // Стояв був ЛИШЕ в міграції 0051 — тобто мігроване середовище його мало,
    // а новий клієнт ні. Спіймав `check-schema-drift` на справжньому
    // Postgres; `check-fresh-schema` цього не бачить за означенням: він
    // звіряє SQLite із SQLite, а там його бракувало однаково з обох боків.
    // Те саме правило, що для колонок (AGENTS §4), тільки для індексів.
    database.exec(
      'CREATE INDEX IF NOT EXISTS idx_reservations_unassigned ON reservations(property_id, check_in) WHERE unit_id IS NULL',
    );
  } catch (e: any) {
    console.error('[DB] reservations.unit_id nullable migration:', e.message);
  }

  // --- Migration: a fee says who it applies to and whose money it is ---
  //
  // Two questions the multiplier could not answer, and both cost money when
  // guessed. `applies_to` is the exemption the header of fees.ts promised
  // instead of silently reinterpreting the word "person"; `collected_for`
  // separates the hotel's own revenue from money it collects for a public
  // body and passes on.
  //
  // Both defaults are the conservative direction. `all` keeps the arithmetic
  // every existing row already has. `property` treats an unmarked row as the
  // hotel's own service — so a levy someone forgot to mark shows up WITH tax
  // (visible over-collection) rather than without it (a silent tax offence).
  try {
    const feeCols = (database.prepare('PRAGMA table_info(fees_taxes)').all() as any[])
      .map((c: any) => c.name);
    if (!feeCols.includes('applies_to')) {
      database.exec("ALTER TABLE fees_taxes ADD COLUMN applies_to TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'adults'))");
    }
    if (!feeCols.includes('collected_for')) {
      database.exec("ALTER TABLE fees_taxes ADD COLUMN collected_for TEXT NOT NULL DEFAULT 'property' CHECK (collected_for IN ('property', 'authority'))");
    }
  } catch (e: any) {
    console.error('[DB] fees_taxes applies_to/collected_for migration:', e.message);
  }

  // --- Migration: categories.type is the hotel's own word ---
  //
  // The live table carried CHECK (type IN ('glamping','resort','camping',
  // 'facility','area','zone')) — the first customer's six words, enforced by
  // the DATABASE. The calendar learned to render any type, but a hotel that
  // tried to CREATE one got a constraint error. SQLite cannot drop a CHECK,
  // so the table is rebuilt once, without it.
  try {
    const catSql = (database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'categories'"
    ).get() as { sql: string } | undefined)?.sql || '';
    if (catSql.includes("type IN ('glamping'")) {
      database.pragma('foreign_keys = OFF');
      try {
        database.exec(`
          CREATE TABLE categories_free (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            description TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            icon TEXT,
            color TEXT,
            show_in_tasks INTEGER NOT NULL DEFAULT 1,
            show_in_finance INTEGER NOT NULL DEFAULT 0,
            show_in_booking INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO categories_free (id, property_id, name, type, description, sort_order,
                                       icon, color, show_in_tasks, show_in_finance, show_in_booking, created_at)
            SELECT id, property_id, name, type, description, sort_order,
                   icon, color, show_in_tasks, show_in_finance, show_in_booking, created_at
            FROM categories;
          DROP TABLE categories;
          ALTER TABLE categories_free RENAME TO categories;
        `);
        console.log('[DB] categories: type CHECK removed');
      } finally {
        database.pragma('foreign_keys = ON');
      }
    }
  } catch (e: any) {
    console.error('[DB] categories type CHECK migration:', e.message);
  }

  // --- Migration: Hostex columns on reservations ---
  //
  // These were added by ensureHostexColumns() inside the SYNC — so a database
  // only got them once a Hostex sync actually ran. On a hotel without Hostex
  // the columns never appeared, and every query naming them (the calendar's
  // booking list does) died with "no such column". Schema must not depend on
  // an integration having fired; the sync's own ensure stays as a no-op.
  try {
    const resCols2 = (database.prepare('PRAGMA table_info(reservations)').all() as any[])
      .map((c: any) => c.name);
    const hostexCols: [string, string][] = [
      // Лишились дві з пʼяти, і лишились НАВМИСНО: їх читають екрани.
      // `hostex_reservation_code` — код броні в каналі, за яким її ще можна
      // звірити з листуванням; `hostex_channel_type` — єдине місце, що
      // каже «ця бронь прийшла з Airbnb», бо `source` у таких рядків
      // «direct». Це історія, а не інтеграція: міст видалений, нових
      // рядків не буде, старі лишаються читабельними — так само, як рядки
      // `fin_operations` з `source='teya'`.
      ['hostex_reservation_code', 'TEXT'],
      ['hostex_channel_type', 'TEXT'],
      // `hostex_stay_code`, `hostex_channel_id`, `hostex_listing_id`
      // прибрані міграцією 0043: їх не читав і не писав НІХТО — вони
      // існували лише в цьому списку.
      ['total_rate_eur', 'REAL'],
      ['commission_eur', 'REAL'],
      ['net_rate_eur', 'REAL'],
      ['channel_remarks', 'TEXT'],
      ['is_prepaid', 'INTEGER DEFAULT 0'],
      ['is_multi_room', 'INTEGER DEFAULT 0'],
      ['multi_room_marker', 'TEXT'],
    ];
    for (const [name, type] of hostexCols) {
      if (!resCols2.includes(name)) database.exec(`ALTER TABLE reservations ADD COLUMN ${name} ${type}`);
    }
    // The index belongs with the columns. It used to be created by the sync
    // itself, on every run — which works on SQLite and cannot work on Postgres,
    // where CREATE INDEX requires owning the table and the application's role
    // deliberately owns nothing. It only ever existed in databases where a sync
    // had run, so a fresh install had the columns and not the index.
    database.exec('CREATE INDEX IF NOT EXISTS idx_reservations_hostex_code ON reservations(hostex_reservation_code)');
  } catch (e: any) {
    console.error('[DB] hostex columns migration:', e.message);
  }

  // --- Migration: tables nothing reads ---
  //
  // Seven empty tables, each the remains of something that was replaced or
  // cut. audit_log lost to booking_activity_log; early_bookings and
  // payments_new are migration scaffolding that never carried a row;
  // email_processed, fin_statement_uploads and bank_statements went with the
  // bank/statement/email-receipt block.
  //
  // bank_transactions goes with them: nothing can write to it since the
  // statement import was removed, so its three readers only ever reported
  // zeros. It has to be dropped BEFORE bank_statements — SQLite refuses to
  // prepare any statement touching a table whose foreign key points at
  // something that no longer exists, and that failure reaches queries three
  // joins away.
  try {
    for (const t of [
      'bank_transactions', 'bank_statements', 'fin_statement_uploads',
      'email_processed', 'audit_log', 'early_bookings', 'payments_new',
    ]) {
      const row = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
      ).get(t) as { name: string } | undefined;
      if (!row) continue;
      const n = (database.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
      if (n > 0) {
        // Somebody's data. Leave it and say so rather than delete it quietly.
        console.warn(`[DB] ${t} has ${n} rows — not dropping`);
        continue;
      }
      database.exec(`DROP TABLE ${t}`);
    }
  } catch (e: any) {
    console.error('[DB] dead table cleanup:', e.message);
  }

  // --- Migration: columns nothing reads ---
  //
  // Found by scripts/audit-dead-data.mjs. Each is the remains of something
  // cut or never finished: OTA statement reconciliation, a deposit-session
  // payment flow, the previous business's camping fields.
  //
  // A column is dropped only when every row in it is empty — NULL, 0 or ''.
  // A column carrying information is kept and reported, because this runs
  // against the customer's database as well as an empty demo one, and a
  // migration must not be the thing that loses their data.
  //
  // The two indexes go first: SQLite refuses to drop an indexed column.
  try {
    for (const ix of ['idx_reservations_deposit_session', 'idx_recv_payoutid', 'idx_business_units_units_count']) {
      database.exec(`DROP INDEX IF EXISTS ${ix}`);
    }

    const DEAD_COLUMNS: Record<string, string[]> = {
      reservations: [
        'camping_vehicle_type', 'camping_tent_type', 'camping_electricity',
        'camping_pets', 'camping_notes',
        'deposit_session_id', 'deposit_session_url', 'deposit_session_expires_at',
        'group_lead_id',
      ],
      fin_channel_receivables: [
        'expected_commission', 'actual_gross', 'actual_commission', 'actual_net',
        'statement_payout_id', 'statement_payout_date', 'paid_operation_id',
      ],
      accruals: ['paid_expense_id'],
      booking_drafts: ['teya_session_id'],
      additional_services: ['options_schema'],
      categories: ['show_in_investor'],
      guest_registrations: ['doc_photo_url'],
      property_photos: ['photo_type'],
      site_incoming_leads: ['source_url', 'raw_data'],
      fin_auto_rule_matches: ['matched_at'],
      business_units: ['units_count'],
    };

    for (const [table, columns] of Object.entries(DEAD_COLUMNS)) {
      const exists = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { name: string } | undefined;
      if (!exists) continue;

      const present = (database.prepare(`PRAGMA table_info(${table})`).all() as any[])
        .map((c: any) => c.name);

      for (const col of columns) {
        if (!present.includes(col)) continue;
        const kept = (database.prepare(
          `SELECT COUNT(*) c FROM ${table}
           WHERE ${col} IS NOT NULL AND TRIM(CAST(${col} AS TEXT)) NOT IN ('', '0')`
        ).get() as { c: number }).c;
        // A denormalized counter is not information — it is derivable and
        // nothing reads it, so it is dropped whatever it holds.
        const derived = table === 'business_units' && col === 'units_count';
        if (kept > 0 && !derived) {
          console.warn(`[DB] ${table}.${col}: ${kept} rows carry a value — column kept`);
          continue;
        }
        try {
          database.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
        } catch (e: any) {
          console.warn(`[DB] ${table}.${col} not dropped: ${e.message}`);
        }
      }
    }
  } catch (e: any) {
    console.error('[DB] dead column cleanup:', e.message);
  }

  // --- Migration: the feature registry ---
  // Which integrations an organization actually bought. One row per switched-on
  // feature; absence of a row means OFF. The menu and the routes both ask
  // core/features.ts, so "a German hotel has no Teya" is one missing row, not
  // an edit to the menu and every route.
  try {
    const had = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organization_features'")
      .get();
    database.exec(`
      CREATE TABLE IF NOT EXISTS organization_features (
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        feature TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (organization_id, feature)
      )
    `);
    if (!had) {
      // Existing organizations were using everything — seed it all ON so this
      // migration changes nothing for them. New organizations start with no
      // rows, i.e. every integration OFF until someone turns it on.
      const seed = database.prepare(
        'INSERT OR IGNORE INTO organization_features (organization_id, feature) SELECT id, ? FROM organizations'
      );
      for (const f of ['widget']) seed.run(f);
    }

    // ── Розкол `widget` на `booking_engine` + `site_builder`, 31.08.2026 ──
    //
    // Рядок сильніший за дефолт (див. hasFeature), тому просто перейменувати
    // ключ не можна: готель із явним рядком `widget` лишився б із НУЛЕМ
    // рядків на обидва нові ключі й поїхав би на дефолти. Для того, хто
    // `widget` КУПИВ, це означало б тихо втратити конструктор сайту
    // (`site_builder` за замовчуванням OFF) — тобто ми забрали б оплачене й
    // ніде цього не показали.
    //
    // Тому кожен наявний рядок копіюється в ОБИДВА ключі зі своїм значенням,
    // і лише потім старий видаляється. `enabled = 0` копіюється так само:
    // хто вимкнув віджет свідомо, не має отримати його назад через новий
    // дефолт `booking_engine: ON`.
    {
      database.prepare(`
        INSERT OR IGNORE INTO organization_features (organization_id, feature, enabled, updated_at)
        SELECT organization_id, 'booking_engine', enabled, datetime('now')
          FROM organization_features WHERE feature = 'widget'
      `).run();
    }
    database.prepare("DELETE FROM organization_features WHERE feature = 'widget'").run();

    // ── `events` ON → OFF, 31.08.2026 ────────────────────────────────────
    //
    // Дефолт змінюється, і без цього рядка кожен уже наявний готель мовчки
    // втратив би розділ «Зали» — рівно те, від чого застерігає коментар про
    // дві родини ключів у core/features.ts. Тому явний `enabled = 1` тим,
    // хто працює зараз; нові організації отримають OFF за дефолтом.
    //
    // ОДИН раз, а не на кожному старті (Блок 0.6 B3): міграції тут біжать
    // при кожному запуску, і `INSERT OR IGNORE … FROM organizations` без
    // маркера дописував рядок кожній організації, створеній після
    // попереднього старту — тобто новий готель у SQLite отримував платний
    // модуль після першого ж рестарту. Маркер — самі дані: ключ, якого ще
    // немає в жодного орендаря, сіється всім наявним; ключ, який уже має хоч
    // один рядок, уже сіявся — нові організації лишаються на дефолті.
    // На Postgres те саме робить міграція (0045, 0065) — один раз за журналом.
    const seededOnce = (feature: string): void => {
      const seeded = database
        .prepare('SELECT 1 FROM organization_features WHERE feature = ? LIMIT 1')
        .get(feature);
      if (seeded) return;
      database.prepare(`
        INSERT OR IGNORE INTO organization_features (organization_id, feature, enabled, updated_at)
        SELECT id, ?, 1, datetime('now') FROM organizations
      `).run(feature);
    };
    seededOnce('events');

    // ── П15, 05.09.2026 (0065): tasks/reports/day_sheets → OFF, нові ────
    // guest_page і sites — OFF. Наявні організації отримують явний
    // `enabled = 1` на всі пʼять: бачать усе, що бачили; нові — за дефолтом.
    for (const f of ['tasks', 'reports', 'day_sheets', 'guest_page', 'sites']) seededOnce(f);
  } catch (e: any) {
    console.error('[DB] organization_features migration:', e.message);
  }

  // --- Migration: how THIS hotel's invoice looks and behaves ---
  //
  // Фактура в кожного готеля своя, і досі це були константи в коді:
  // `INVOICE_DUE_DAYS = 14` і `BUYER_NAME_THRESHOLD_CZK = 9900`. Друге гірше
  // за перше: 9900 — межа чеського «спрощеного податкового документа», тобто
  // норма ОДНІЄЇ юрисдикції, застосована до всіх; ще й у кронах, тож
  // німецький готель порівнював суму в євро з числом у кронах.
  //
  // Один рядок на готель. Порожній рядок = дефолти, тому таблиця може бути
  // порожньою й нічого не ламається.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS organization_invoicing (
        organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
        due_days INTEGER NOT NULL DEFAULT 14,
        buyer_name_threshold REAL,
        logo_url TEXT,
        accent_color TEXT,
        footer_note TEXT,
        show_payment_qr INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  } catch (e: any) {
    console.error('[DB] organization_invoicing migration:', e.message);
  }

  // --- Migration: the currencies a hotel shows amounts in ---
  //
  // ОСНОВНА валюта живе в organizations.default_currency і не дублюється тут:
  // одне значення в двох місцях розходиться, і потім ніхто не знає, котре
  // чинне. Ця таблиця — лише про ДРУГОРЯДНІ: 1–3 валюти, у яких готель
  // показує суми гостю чи партнеру.
  //
  // Курсу тут теж немає, і це навмисно. Курс — у finance_exchange_rates, тій
  // самій таблиці для ручного й автоматичного: ручний просто пишеться туди
  // рядком із датою. Два джерела курсу дали б два різні числа на одному
  // екрані — рівно те, чим колись були чотири цикли по днях у ціноутворенні.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS organization_currencies (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        rate_source TEXT NOT NULL DEFAULT 'manual',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(organization_id, code)
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_org_currencies_org ON organization_currencies(organization_id)');
  } catch (e: any) {
    console.error('[DB] organization_currencies migration:', e.message);
  }

  // --- Migration: create fin_folios and fin_folio_items ---
  //
  // A folio is the running bill of a stay; an invoice is a frozen snapshot of
  // part of it. Keeping them apart is what makes five different things
  // possible at once, and each one is a real request from the pilot:
  //
  //   - charges added during the stay (bar, garage, breakfast) without
  //     "redoing the bill";
  //   - an invoice issued mid-stay, because the guest pays on arrival;
  //   - two payers on one booking — the company takes the nights, the guest
  //     takes the bar. That is a daily occurrence there, and it is why a
  //     booking may have SEVERAL folios;
  //   - one monthly invoice to a company covering folios from many bookings;
  //   - corrections that do not destroy anything: an invoice is never edited
  //     or deleted, only reversed.
  //
  // The payer is a SNAPSHOT, not a foreign key to a live directory. A company
  // that changes its address next year must not change the invoice it was sent
  // last year.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_folios (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        reservation_id  TEXT REFERENCES reservations(id) ON DELETE SET NULL,
        payer_kind      TEXT NOT NULL DEFAULT 'guest' CHECK (payer_kind IN ('guest','company')),
        guest_id        TEXT,
        payer_name      TEXT,
        payer_address   TEXT,
        payer_vat_no    TEXT,
        payer_debtor_no TEXT,
        -- Платник НАЗВАНИЙ, а не знятий текстом (Д57): фоліо фірми збирає
        -- рядки кількох перебувань, і payer_name для порівняння не годиться.
        company_id      TEXT REFERENCES companies(id) ON DELETE SET NULL,
        property_id     TEXT,
        status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
        label           TEXT,
        currency        TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Jurisdiction for a folio with no reservation (halls, walk-in sales) —
    // migration 0024. The ALTER upgrades databases born before the column;
    // it must run HERE, after the table exists: on a fresh boot an earlier
    // guarded ALTER saw no table, skipped, and CI's production-fresh SQLite
    // shipped folios without the column while every long-lived dev DB had it.
    const folioCols = (database.prepare('PRAGMA table_info(fin_folios)').all() as any[]).map((c: any) => c.name);
    if (!folioCols.includes('property_id')) {
      database.exec('ALTER TABLE fin_folios ADD COLUMN property_id TEXT');
      console.log('[DB] fin_folios: added property_id (jurisdiction for reservation-less folios)');
    }
    // Which money this bill counts — migration 0031. Same ALTER-after-CREATE
    // rule as above. Nullable: rows born before it resolve at read time from
    // the reservation, then the organization, and never from a literal.
    if (!folioCols.includes('currency')) {
      database.exec('ALTER TABLE fin_folios ADD COLUMN currency TEXT');
      console.log('[DB] fin_folios: added currency (an invoice must not invent EUR)');
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folios_res ON fin_folios(reservation_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folios_org ON fin_folios(organization_id, status)');

    // service_date, not created_at, decides the VAT rate and which day-report a
    // charge belongs to. It is the Leistungsdatum a German invoice must print.
    //
    // Prices are GROSS: that is how a hotel quotes, how a channel sends, and
    // how the guest reads the bill. Net is derived — see invoice-vat.ts.
    //
    // vat_rate is a NUMBER on the row, not a link to the rate table. The rate
    // in force is chosen once, when the charge is made, and then frozen: a rate
    // change next year must not restate a document from this one.
    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_folio_items (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id   TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        folio_id          TEXT REFERENCES fin_folios(id) ON DELETE CASCADE,
        reservation_id    TEXT REFERENCES reservations(id) ON DELETE SET NULL,
        service_date      TEXT NOT NULL,
        kind              TEXT NOT NULL CHECK (kind IN ('lodging','service','fee','city_tax','manual')),
        description       TEXT NOT NULL,
        guest_name        TEXT,
        unit_code         TEXT,
        quantity          REAL NOT NULL DEFAULT 1,
        unit_price_gross  REAL NOT NULL DEFAULT 0,
        total_gross       REAL NOT NULL DEFAULT 0,
        vat_rate          REAL NOT NULL DEFAULT 0,
        service_order_id  TEXT,
        source            TEXT NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('nightly','ota_split','manual','restaurant','import','service')),
        voided_by_item_id TEXT,
        -- Від чого ця знижка (0142, Д62). Факт, не текст опису: сторно
        -- батьківського рядка інакше лишає знижку, яка вказує в нікуди.
        discount_of_item_id TEXT REFERENCES fin_folio_items(id) ON DELETE CASCADE,
        invoice_id        TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_items_folio ON fin_folio_items(folio_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_items_discount_of ON fin_folio_items(discount_of_item_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_items_date ON fin_folio_items(organization_id, service_date)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_items_invoice ON fin_folio_items(invoice_id)');
    // Same story as idx_event_bookings_day: this one was written only in the
    // ALTER branch that adds service_order_id, which never runs on a database
    // whose CREATE already has the column.
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_items_order ON fin_folio_items(service_order_id)');

    // Довідник способів оплати (0141, Д61) — СПЕРШУ, бо платіжка нижче має
    // на нього зовнішній ключ, а SQLite розбирає `REFERENCES` при створенні.
    //
    // Клас (`kind`) — ті самі чотири слова, що в CHECK платіжки: довідник
    // стоїть НАД класом, а не замість нього. `name IS NULL` означає
    // «стандартна назва класу»: засів не вигадує слів жодною мовою.
    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_payment_methods (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        code              TEXT NOT NULL,
        name              TEXT,
        kind              TEXT NOT NULL,
        ledger_account    TEXT,
        settles_to_debtor INTEGER NOT NULL DEFAULT 0,
        is_active         INTEGER NOT NULL DEFAULT 1,
        position          INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (organization_id, code),
        CHECK (kind IN ('cash','card_terminal','transfer','voucher'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_payment_methods_org ON fin_payment_methods(organization_id, position)');

    // How a folio was paid — first-class, because KassenSichV asks the
    // DOCUMENT whether it needs a TSE signature (cash / card at the desk:
    // yes; transfer: no). Migration 0026, TSE spec §6.4 Block A. Created
    // HERE, after fin_folios exists — the events module already paid for an
    // ALTER that ran before its CREATE.
    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_folio_payments (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id     TEXT REFERENCES properties(id) ON DELETE SET NULL,
        folio_id        TEXT NOT NULL REFERENCES fin_folios(id) ON DELETE CASCADE,
        invoice_id      TEXT REFERENCES invoices(id) ON DELETE SET NULL,
        amount          REAL NOT NULL,
        method          TEXT NOT NULL,
        paid_at         TEXT NOT NULL DEFAULT (datetime('now')),
        received_by     TEXT,
        source          TEXT,
        origin          TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        tse_status      TEXT,
        tse_serial      TEXT,
        tse_tx_number   TEXT,
        tse_signature_counter TEXT,
        tse_signature   TEXT,
        tse_start_time  TEXT,
        tse_end_time    TEXT,
        tse_qr_payload  TEXT,
        tse_client_id   TEXT,
        tse_process_type TEXT,
        tse_process_data TEXT,
        method_id       TEXT REFERENCES fin_payment_methods(id) ON DELETE RESTRICT,
        CHECK (method IN ('cash','card_terminal','transfer','voucher'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_payments_folio ON fin_folio_payments(folio_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_payments_method ON fin_folio_payments(method_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_payments_org ON fin_folio_payments(organization_id, paid_at)');
    // Databases whose CREATE predates the TSE columns catch up here — the
    // guarded ALTER stands AFTER the CREATE on purpose (lesson of 086ec1d).
    {
      const payCols = (database.prepare('PRAGMA table_info(fin_folio_payments)').all() as any[]).map((c: any) => c.name);
      // 0405: `source`/`origin` — оплата, перенесена з попередньої системи (З34).
      for (const col of ['tse_status', 'tse_serial', 'tse_tx_number', 'tse_signature_counter',
        'tse_signature', 'tse_start_time', 'tse_end_time', 'tse_qr_payload',
        'tse_client_id', 'tse_process_type', 'tse_process_data', 'source', 'origin']) {
        if (!payCols.includes(col)) database.exec(`ALTER TABLE fin_folio_payments ADD COLUMN ${col} TEXT`);
      }
    }

    // Which TSE a property's till talks to (identifiers; secrets live in
    // channel_credentials) + the §6 recording-system serial. Migration 0027.
    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_fiscal_settings (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        tss_id          TEXT,
        tse_client_id   TEXT,
        recording_system_serial TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(property_id)
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_fiscal_settings_org ON fin_fiscal_settings(organization_id)');
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_fiscal_settings_row ON fin_fiscal_settings(property_id)');

    // The outage journal a Betriebsprüfung asks for: when the TSE was
    // unreachable, from when to when. Migration 0027.
    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_fiscal_outages (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id     TEXT REFERENCES properties(id) ON DELETE CASCADE,
        started_at      TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at        TEXT,
        note            TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_fiscal_outages_org ON fin_fiscal_outages(organization_id, started_at)');

    // The Kassenabschluss as a RECORD, one per property per day — DSFinV-K
    // is built around it. Not the day-sheets Tagesabschluss. Migration 0028.
    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_cash_closings (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        closing_date    TEXT NOT NULL,
        closing_number  INTEGER NOT NULL,
        cash_total      REAL NOT NULL DEFAULT 0,
        card_total      REAL NOT NULL DEFAULT 0,
        payments_count  INTEGER NOT NULL DEFAULT 0,
        signed_count    INTEGER NOT NULL DEFAULT 0,
        failed_count    INTEGER NOT NULL DEFAULT 0,
        first_payment_at TEXT,
        last_payment_at TEXT,
        closed_by       TEXT,
        notes           TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(property_id, closing_date)
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_cash_closings_org ON fin_cash_closings(organization_id, closing_date)');
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_cash_closings_row ON fin_cash_closings(property_id, closing_date)');
  } catch (e: any) {
    console.error('[DB] fin_folios migration:', e.message);
  }

  // --- Migration: the supplier's own way in (mirror of Postgres 0030) ---
  //
  // A person in app_users belongs to exactly one hotel. That is right for the
  // people who work in one and wrong for the one who sells the product: ten
  // customers meant ten accounts, each reachable only through the owner
  // password printed once at provisioning. platform_users lives OUTSIDE
  // tenancy — like organizations and sessions, it is what a request consults
  // before it knows the tenant — and a platform session steps into one
  // organization at a time. platform_audit is the opposite: it belongs to the
  // customer, so the customer can see who came in and when.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS platform_users (
        id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        email         TEXT NOT NULL UNIQUE,
        full_name     TEXT,
        password_hash TEXT NOT NULL,
        -- Рід входу (П21). Дефолт СЛАБШИЙ: рядок, створений без назви роду,
        -- дістає перелік — тобто нічого, поки членство не заведено, — а не
        -- ключі від сервера. Постачальник пишеться явно (інваріанти 8 і 13).
        kind          TEXT NOT NULL DEFAULT 'hotelier' CHECK (kind IN ('supplier', 'hotelier')),
        is_active     INTEGER NOT NULL DEFAULT 1,
        last_login    TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Перелік «у які рахунки ця людина може входити», і ким вона там є.
    //
    // `app_user_id` NOT NULL навмисно: без рядка `app_users` у людини немає ні
    // ролі, ні прав, ні імені для аудиту, і код мусив би щось підставити — а
    // саме те підставлене й було б вадою (рахунок бачив би «Підтримка ALiSiO»
    // замість власного власника). Членство без відповіді «ким саме» не існує.
    database.exec(`
      CREATE TABLE IF NOT EXISTS platform_memberships (
        id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        platform_user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
        organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        app_user_id      TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (platform_user_id, organization_id)
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_platform_memberships_user ON platform_memberships(platform_user_id)');
    database.exec(`
      CREATE TABLE IF NOT EXISTS platform_sessions (
        id                     TEXT PRIMARY KEY,
        platform_user_id       TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
        acting_organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
        expires_at             TEXT NOT NULL,
        created_at             TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_platform_sessions_user ON platform_sessions(platform_user_id)');
    database.exec(`
      CREATE TABLE IF NOT EXISTS platform_audit (
        id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        platform_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
        platform_email   TEXT NOT NULL,
        action           TEXT NOT NULL CHECK (action IN ('enter', 'leave')),
        ip               TEXT,
        at               TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_platform_audit_org ON platform_audit(organization_id, at)');

    // База, яка вже жила: колонка роду в CREATE вище — для нового клієнта,
    // ALTER тут — для наявної (AGENTS §4). Наявні рядки це наші власні записи
    // підтримки, і постачальниками вони називаються ЯВНО: те, що дає доступ до
    // всіх рахунків, пишеться руками, а не успадковується дефолтом.
    const puCols = (database.prepare('PRAGMA table_info(platform_users)').all() as any[]).map((c: any) => c.name);
    if (!puCols.includes('kind')) {
      database.exec("ALTER TABLE platform_users ADD COLUMN kind TEXT NOT NULL DEFAULT 'hotelier'");
      const n = database.prepare("UPDATE platform_users SET kind = 'supplier'").run().changes;
      console.log(`[DB] platform_users: рід входу; ${n} наявних записів названо постачальниками (П21)`);
    }
  } catch (e: any) {
    console.error('[DB] platform access migration:', e.message);
  }

  // --- Migration: invoices learn about reversal ---
  //
  // `CHECK (status IN ('issued','cancelled'))` and no link from a reversal to
  // what it reverses. Both come from a time when a wrong invoice was deleted.
  //
  // A German invoice is never deleted and never edited: it is reversed by a
  // second document that mirrors it, and the pair stays in the books forever
  // ── 0018: знижка на проживання ─────────────────────────────────────────
  //
  // Відсоток, а не готова сума: сума каже «скільки», відсоток каже «чому
  // менше». Тільки на проживання — сніданок гість купує за його ціною.
  try {
    const cols = (database.prepare('PRAGMA table_info(reservations)').all() as any[]).map((c: any) => c.name);
    if (cols.length > 0 && !cols.includes('lodging_discount_percent')) {
      // Іменований CHECK прямо в ADD COLUMN: міграція 0018 ставить його на
      // Postgres, а schema.sql генерується з ЦІЄЇ бази — без імені тут
      // check-schema-drift показує «міграція створює, а schema.sql — ні».
      database.exec(
        'ALTER TABLE reservations ADD COLUMN lodging_discount_percent REAL NOT NULL DEFAULT 0 ' +
        'CONSTRAINT reservations_lodging_discount_range ' +
        'CHECK (lodging_discount_percent >= 0 AND lodging_discount_percent <= 100)',
      );
    }
    if (cols.length > 0 && !cols.includes('lodging_discount_reason')) {
      database.exec('ALTER TABLE reservations ADD COLUMN lodging_discount_reason TEXT');
    }
    // Three states on purpose: NULL follows the channel rule, 1 carves the
    // breakfast out, 0 leaves the whole amount as lodging. See migration 0020.
    if (cols.length > 0 && !cols.includes('breakfast_included')) {
      database.exec('ALTER TABLE reservations ADD COLUMN breakfast_included INTEGER');
    }
  } catch { /* таблиці ще немає — створиться зі схемою */ }

  // (GoBD). That needs two statuses the CHECK refused — `storno` for the
  // mirror, `corrected` for the original it cancels — and a column saying
  // which document a reversal belongs to.
  try {
    const cols = (database.prepare('PRAGMA table_info(invoices)').all() as any[]).map((c: any) => c.name);
    if (cols.length > 0 && !cols.includes('corrects_invoice_id')) {
      database.exec('ALTER TABLE invoices ADD COLUMN corrects_invoice_id TEXT');
    }
    // Which payer the document belongs to — a stay can produce several. See
    // migration 0019.
    if (cols.length > 0 && !cols.includes('folio_id')) {
      database.exec('ALTER TABLE invoices ADD COLUMN folio_id TEXT');
    }
    if (cols.length > 0) {
      database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_folio ON invoices(folio_id)');
    }
    // The index lived only in the Postgres migration 0014. So every database
    // that was CREATED rather than migrated — every new customer, and every
    // developer's — had the column and not the index, and nothing said so.
    // scripts/check-schema-drift.mjs is what finally asked.
    if (cols.length > 0) {
      database.exec('CREATE INDEX IF NOT EXISTS idx_invoices_corrects ON invoices(corrects_invoice_id)');
    }
    // SQLite cannot widen a CHECK, so the table is rebuilt when it still
    // carries the two-value one. Data is copied column for column.
    const row = database.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'invoices') as { sql: string } | undefined;
    if (row?.sql && /CHECK\s*\(\s*status\s+IN\s*\(\s*'issued'\s*,\s*'cancelled'\s*\)\s*\)/i.test(row.sql)) {
      const rebuilt = row.sql.replace(
        /CHECK\s*\(\s*status\s+IN\s*\([^)]*\)\s*\)/i,
        "CHECK (status IN ('issued', 'cancelled', 'storno', 'corrected'))",
      );
      const names = (database.prepare('PRAGMA table_info(invoices)').all() as any[])
        .map((c: any) => `"${c.name}"`).join(', ');
      database.exec('PRAGMA foreign_keys = OFF');
      database.exec('BEGIN');
      database.exec(rebuilt.replace(/CREATE TABLE invoices\b/i, 'CREATE TABLE invoices__rebuilt'));
      database.exec(`INSERT INTO invoices__rebuilt (${names}) SELECT ${names} FROM invoices`);
      database.exec('DROP TABLE invoices');
      database.exec('ALTER TABLE invoices__rebuilt RENAME TO invoices');
      database.exec('COMMIT');
      database.exec('PRAGMA foreign_keys = ON');
      console.log('[DB] invoices: storno and corrected are valid statuses now');
    }
  } catch (e: any) {
    console.error('[DB] invoices storno migration:', e.message);
  }

  // --- Migration: create fin_invoice_lines and fin_invoice_tax_totals ---
  //
  // The frozen half. A folio item can still change; an invoice line never can.
  //
  // Deliberately a COPY, with no foreign key to the service, the rate table or
  // the price list it came from. A German invoice has to be reproducible for
  // ten years (GoBD), and by then the service may be renamed, the rate changed
  // and the room gone. Everything the document prints is on the row.
  //
  // fin_invoice_tax_totals is the MwSt-Übersicht block, one row per rate. It
  // stores the GROUP figures — see invoice-vat.ts for why those differ from the
  // sum of the lines by a cent, and why that is correct.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_invoice_lines (
        id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id  TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        invoice_id       TEXT NOT NULL,
        position         INTEGER NOT NULL DEFAULT 0,
        service_date     TEXT,
        description      TEXT NOT NULL,
        guest_name       TEXT,
        unit_code        TEXT,
        quantity         REAL NOT NULL DEFAULT 1,
        unit_price_gross REAL NOT NULL DEFAULT 0,
        total_gross      REAL NOT NULL DEFAULT 0,
        net_amount       REAL NOT NULL DEFAULT 0,
        tax_amount       REAL NOT NULL DEFAULT 0,
        vat_rate         REAL NOT NULL DEFAULT 0,
        source_item_id   TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_invoice_lines_invoice ON fin_invoice_lines(invoice_id, position)');

    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_invoice_tax_totals (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        invoice_id      TEXT NOT NULL,
        vat_rate        REAL NOT NULL,
        label           TEXT,
        gross_amount    REAL NOT NULL DEFAULT 0,
        net_amount      REAL NOT NULL DEFAULT 0,
        tax_amount      REAL NOT NULL DEFAULT 0
      )
    `);
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_invoice_tax_totals_rate ON fin_invoice_tax_totals(invoice_id, vat_rate)');
  } catch (e: any) {
    console.error('[DB] fin_invoice_lines migration:', e.message);
  }

  // --- Migration: create invoice_series ---
  //
  // Which runs of invoice numbers this organization keeps, and what each one
  // looks like.
  //
  // The five series and their prefixes lived in a constant in
  // finance/domain/invoice-numbering.ts: booking → BKG-, airbnb → AIR-,
  // teya → TEYA-, cash/house → no prefix. That is one hotel's arrangement with
  // its accountant, written into the product. The German pilot's numbers look
  // nothing like it.
  //
  // A row here overrides the built-in map for that organization; an
  // organization with no rows keeps behaving exactly as before, which is what
  // makes this safe to land while a customer is issuing invoices through it.
  //
  // `channel` is what maps a booking's source onto a series ('booking',
  // 'airbnb', 'house'…). Several channels may share one series — that is a
  // decision the hotel makes, not us.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS invoice_series (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        -- Будинок, або NULL = «на весь рахунок» (Д54). Дві бухгалтерії з однією
        -- наскрізною нумерацією — діра в книгах, тож серія належить будинку.
        property_id     TEXT REFERENCES properties(id) ON DELETE CASCADE,
        code            TEXT NOT NULL,
        channel         TEXT,
        prefix          TEXT NOT NULL DEFAULT '',
        number_format   TEXT NOT NULL DEFAULT '{prefix}{year}-{seq:3}',
        reset_yearly    INTEGER NOT NULL DEFAULT 1,
        is_default      INTEGER NOT NULL DEFAULT 0,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // One series per code per hotel. Two rows with the same code would mean two
    // counters answering to one name, i.e. duplicate invoice numbers.
    // Один код серії на БУДИНОК, не на рахунок (Д54). `UNIQUE (organization_id,
    // code)` не пускав двом будинкам мати кожен свою серію з тим самим кодом —
    // а дві бухгалтерії з однією наскрізною нумерацією це діра в книгах.
    // COALESCE, бо спільний рядок має `property_id IS NULL`, а `UNIQUE` не
    // дедуплікує NULL — той самий прийом, що `idx_channel_rate_rules_row`.
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_series_row
        ON invoice_series(organization_id, (COALESCE(property_id, '')), code)
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_invoice_series_channel ON invoice_series(organization_id, channel)');
  } catch (e: any) {
    console.error('[DB] invoice_series migration:', e.message);
  }

  // --- Migration: create fin_tax_rates ---
  //
  // What VAT this organization charges, and since when.
  //
  // The date matters as much as the number. German hospitality moved food to
  // 7% on 2026-01-01, so a breakfast served in December 2025 is 19% and the
  // same breakfast in January 2026 is 7% — on documents that may be issued in
  // the same week. So the rate is chosen by the date of SERVICE, and the rate
  // that was chosen is then written onto the charge as a number. This table is
  // only ever consulted to pick; it is never read back to re-derive an old
  // document. That is what makes an invoice from 2026 still print correctly in
  // 2036 after every rate in the country has changed.
  //
  // `code` is the closed part — standard / reduced / zero says what ROLE a rate
  // plays, and a service points at the role, not at a number. `rate` is the
  // open part, and it is per organization: Germany 19/7, Czechia 21/12, and
  // whatever the next country is. Nothing in the code knows those numbers.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_tax_rates (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        -- Будинок, або NULL = «на весь рахунок» (Д54). Тут нульове значення
        -- НЕ означає «мовчки бери спільне»: ставка чужої юрисдикції їде в
        -- документ держави, тож спільний набір застосовується лише до будинку
        -- країни рахунку, інакше — названа відмова (див. stay-charges.repo).
        property_id     TEXT REFERENCES properties(id) ON DELETE CASCADE,
        code            TEXT NOT NULL CHECK (code IN ('standard','reduced','zero')),
        rate            REAL NOT NULL,
        label           TEXT,
        valid_from      TEXT NOT NULL,
        valid_to        TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Lookups are always "this organization, this role, on this day".
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_tax_rates_lookup ON fin_tax_rates(organization_id, code, valid_from)');
  } catch (e: any) {
    console.error('[DB] fin_tax_rates migration:', e.message);
  }

  // --- Migration: additional_services stops naming one customer's categories
  //
  // `CHECK (available_for IN ('glamping','resort','camping','all'))` is a
  // dictionary of one hotel's business words, in the schema — exactly what
  // NAMING.md §9 forbids, and it bites: a German hotel, a hostel or a pension
  // cannot point a service at its own category, because the database refuses
  // any value outside those three. widget-services.handlers.ts already works
  // around it by reading only 'all'.
  //
  // The column stays and keeps its meaning ("this category type, or all"). Only
  // the closed list goes. SQLite cannot drop a CHECK, so the table is rebuilt
  // without it; data is copied column for column.
  try {
    const row = database.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'additional_services') as { sql: string } | undefined;
    if (row?.sql && /CHECK\s*\(\s*available_for/i.test(row.sql)) {
      // Two levels of parentheses: CHECK ( available_for IN ( … ) ). A pattern
      // that stops at the first ')' cuts the statement in half and leaves the
      // outer one dangling — which is what the first attempt did.
      const rebuilt = row.sql.replace(
        /,?\s*CHECK\s*\(\s*available_for\s+IN\s*\([^)]*\)\s*\)/i,
        '',
      );
      const cols = (database.prepare('PRAGMA table_info(additional_services)').all() as any[])
        .map((c: any) => `"${c.name}"`).join(', ');
      database.exec('PRAGMA foreign_keys = OFF');
      database.exec('BEGIN');
      database.exec(rebuilt.replace(/CREATE TABLE additional_services\b/i, 'CREATE TABLE additional_services__rebuilt'));
      database.exec(`INSERT INTO additional_services__rebuilt (${cols}) SELECT ${cols} FROM additional_services`);
      database.exec('DROP TABLE additional_services');
      database.exec('ALTER TABLE additional_services__rebuilt RENAME TO additional_services');
      database.exec('COMMIT');
      database.exec('PRAGMA foreign_keys = ON');
      console.log('[DB] additional_services: available_for no longer limited to one hotel\'s categories');
    }
  } catch (e: any) {
    console.error('[DB] additional_services available_for migration:', e.message);
  }

  // --- Migration: create partner_reports table ---
  //
  // A finished report, addressed by a link and nothing else.
  //
  // The document lives in this column, not on disk: the server is rebuilt from
  // the image on every deploy, and a file written beside the app disappears
  // with it. It is also why `pg_dump` is now the backup — a report is data.
  //
  // `token` is the credential, so it is UNIQUE and 64 hex characters (see
  // generateReportToken); the row-level policy matches on it and nothing else,
  // which is what lets a partner with no account read exactly this one row.
  // `revoked_at` exists so a leaked link can be killed without deleting the
  // report — the URL stops working, the numbers stay.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS partner_reports (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id     TEXT REFERENCES properties(id) ON DELETE SET NULL,
        token           TEXT NOT NULL UNIQUE,
        slug            TEXT,
        title           TEXT NOT NULL,
        period          TEXT,
        html            TEXT NOT NULL,
        published_at    TEXT NOT NULL DEFAULT (datetime('now')),
        revoked_at      TEXT,
        views           INTEGER NOT NULL DEFAULT 0,
        last_viewed_at  TEXT
      )
    `);
    // No separate index on `token`: the column is UNIQUE, which is an index.
    // The name here is not `idx_partner_reports_org` on purpose — the Postgres
    // generator emits one under that name for every scoped table, and two
    // different definitions sharing a name is how one of them silently loses.
    database.exec('CREATE INDEX IF NOT EXISTS idx_partner_reports_period ON partner_reports(organization_id, period)');
  } catch (e: any) {
    console.error('[DB] partner_reports migration:', e.message);
  }

  // --- Migration: create price_occupancy and price_los_tiers ---
  //
  // The price matrix: what a night costs at a given occupancy, and what staying
  // longer takes off it.
  //
  // `price_calendar` has `base_price` and `weekend_price` and nothing else. For
  // the German market that is not a gap but a blocker: the same double room is
  // sold to one person at one price and to two at another, and both are the
  // same category, the same room, the same bed. DIRS21 sends prices per
  // occupancy. A model where "EZ" is a separate category would make the hotel
  // keep two room lists for one set of rooms, and availability would be wrong
  // on the first booking.
  //
  //   OCCUPANCY CHANGES THE PRICE, NEVER THE CATEGORY.
  //
  // `unit_type_id` NULL means "any type in this property" — a house-wide price
  // that a type-specific row overrides. `valid_from`/`valid_to` NULL means
  // open-ended, which is how a season is entered: as a narrower row laid over
  // the standing price, without editing it. Which row wins is decided in
  // pricing/domain/occupancy-price.ts, and it is decided the same way here and
  // in the widget.
  //
  // `property_id` is on the row rather than left to be derived through the unit
  // type, because a house-wide row has no unit type to derive it from — and an
  // organization with two hotels must not price one of them from the other.
  //
  // This table does NOT replace price_calendar. That one carries the per-day
  // restrictions a channel manager sets (min_stay, closed, CTA/CTD) and the
  // rates PriceLabs writes; this one carries what the owner types in. Merging
  // them would mean an automatic sync overwriting the owner's rate card.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS price_occupancy (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id     TEXT REFERENCES properties(id) ON DELETE CASCADE,
        unit_type_id    TEXT REFERENCES unit_types(id) ON DELETE CASCADE,
        persons         INTEGER NOT NULL,
        price_gross     REAL NOT NULL DEFAULT 0,
        valid_from      TEXT,
        valid_to        TEXT,
        label           TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // Two rows for the same type, occupancy and window are two answers to one
    // question, and the one that wins would depend on insertion order. COALESCE
    // rather than the bare columns because three of them are nullable, and a
    // UNIQUE index does not constrain NULLs — the duplicate this is meant to
    // stop is precisely the house-wide, open-ended one.
    //
    // The two date sentinels say what an open end means, and they are dates
    // rather than '' because Postgres types these columns DATE: COALESCE of a
    // date and an empty string does not typecheck there, and the index would
    // have failed on the server while passing here.
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_price_occupancy_row
        ON price_occupancy(organization_id, property_id, (COALESCE(unit_type_id, '')),
                           persons, (COALESCE(valid_from, '0001-01-01')), (COALESCE(valid_to, '9999-12-31')))
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_price_occupancy_lookup ON price_occupancy(organization_id, property_id, unit_type_id, persons)');

    database.exec(`
      CREATE TABLE IF NOT EXISTS price_los_tiers (
        id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id  TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id      TEXT REFERENCES properties(id) ON DELETE CASCADE,
        unit_type_id     TEXT REFERENCES unit_types(id) ON DELETE CASCADE,
        min_nights       INTEGER NOT NULL,
        adjustment_gross REAL NOT NULL DEFAULT 0,
        persons          INTEGER,
        label            TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // `persons` NULL means the tier applies at any occupancy — the pilot's
    // "−10 € from three nights on a double, −5 € alone" is two rows, and a
    // hotel that gives the same discount regardless of occupancy writes one.
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_price_los_tiers_row
        ON price_los_tiers(organization_id, property_id, (COALESCE(unit_type_id, '')),
                           min_nights, (COALESCE(persons, -1)))
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_price_los_tiers_lookup ON price_los_tiers(organization_id, property_id, unit_type_id)');
  } catch (e: any) {
    console.error('[DB] price_occupancy migration:', e.message);
  }

  // --- Migration: create channel_rate_rules ---
  //
  // What a channel's number means, and what we send it.
  //
  // Booking.com and its kin send one figure — "91,05 € for this stay". A German
  // invoice cannot print that: it has to say how much was accommodation, how
  // much was breakfast food and how much was breakfast drinks, because those
  // carry different VAT. Reception at the pilot does that arithmetic by hand for
  // every channel booking; it is the most repeated calculation of their day and
  // the one most likely to be wrong, because the split depends on how many
  // people slept there.
  //
  // A row here says, for one channel: whether its price includes breakfast,
  // what breakfast costs per person per night split into food and drink, which
  // tax ROLE each part carries, and what markup goes on top of the rate card
  // when prices are pushed to that channel.
  //
  // `channel` NULL is the default — the arrangement that applies to any channel
  // without a row of its own. That is how a hotel with one policy writes one
  // row instead of six.
  //
  // Tax roles, not percentages: 'standard' / 'reduced' / 'zero' point at
  // fin_tax_rates, which holds the numbers and the dates they changed. A rate
  // written here as 7 would still say 7 in 2031.
  //
  // Nothing here is a number this code knows. A hotel whose rates never include
  // breakfast has no rows and nothing changes for it.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS channel_rate_rules (
        id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        property_id            TEXT REFERENCES properties(id) ON DELETE CASCADE,
        channel                TEXT,
        includes_breakfast     INTEGER NOT NULL DEFAULT 0,
        breakfast_food_price   REAL NOT NULL DEFAULT 0,
        breakfast_drinks_price REAL NOT NULL DEFAULT 0,
        lodging_tax_code       TEXT NOT NULL DEFAULT 'reduced',
        food_tax_code          TEXT NOT NULL DEFAULT 'reduced',
        drinks_tax_code        TEXT NOT NULL DEFAULT 'standard',
        markup_percent         REAL NOT NULL DEFAULT 0,
        created_at             TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    // One rule per channel per property. Two rules for one channel would mean
    // the same booking splits differently depending on which row was read
    // first. COALESCE because the default row — the one with no channel — is
    // exactly the one a plain UNIQUE would not constrain.
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_rate_rules_row
        ON channel_rate_rules(organization_id, property_id, (COALESCE(channel, '')))
    `);
  } catch (e: any) {
    console.error('[DB] channel_rate_rules migration:', e.message);
  }

  // --- Migration: a service says what VAT it carries ---
  //
  // A hotel sells breakfast, a parking space and an extra bed. On a German
  // invoice those are three different rates — food reduced, parking standard,
  // an extra bed reduced — and until now `additional_services` had nowhere to
  // say which. A service reaching a folio would land there without VAT, and an
  // invoice with a line at no rate is not a document a tax office accepts.
  //
  // The ROLE, not the number: 'standard' / 'reduced' / 'zero' point at
  // fin_tax_rates, which holds the percentages and the dates they changed.
  //
  // Nullable, with no default. A default of 'standard' would silently charge
  // 19% on a breakfast nobody got round to configuring — a wrong tax return
  // that looks like a working system. NULL means "not said", and a service
  // with NULL is refused when it reaches a folio, by name.
  try {
    const cols = (database.prepare('PRAGMA table_info(additional_services)').all() as any[])
      .map((c: any) => c.name);
    if (!cols.includes('vat_code')) {
      database.exec('ALTER TABLE additional_services ADD COLUMN vat_code TEXT');
      console.log('[DB] additional_services: added vat_code');
    }
  } catch (e: any) {
    console.error('[DB] additional_services vat_code migration:', e.message);
  }

  // --- Migration: which VAT a hall carries is the hall's own answer ---
  //
  // It used to be the literal 'standard' in two places in code, so every
  // hotel's hall was 19% and no file could say otherwise. Which rate hall
  // rent carries is a question of what is being sold and where — one hotel's
  // Steuerberater reads it as accommodation, another's as room hire — so it
  // belongs to the hall, next to its prices. DEFAULT 'standard' keeps every
  // existing hall exactly where it was.
  try {
    const cols = (database.prepare('PRAGMA table_info(event_spaces)').all() as any[])
      .map((c: any) => c.name);
    if (!cols.includes('vat_code')) {
      database.exec("ALTER TABLE event_spaces ADD COLUMN vat_code TEXT NOT NULL DEFAULT 'standard'");
      console.log('[DB] event_spaces: added vat_code');
    }
  } catch (e: any) {
    console.error('[DB] event_spaces vat_code migration:', e.message);
  }

  // --- Migration: a folio charge remembers which service order it came from ---
  //
  // Not decoration: it is what makes posting twice add nothing. Without it the
  // only way to ask "is this order already on the bill" is to match on
  // description and amount, and two saunas on the same day are indistinguishable
  // that way.
  try {
    const cols = (database.prepare('PRAGMA table_info(fin_folio_items)').all() as any[])
      .map((c: any) => c.name);
    if (!cols.includes('service_order_id')) {
      database.exec('ALTER TABLE fin_folio_items ADD COLUMN service_order_id TEXT');
      database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_items_order ON fin_folio_items(service_order_id)');
      console.log('[DB] fin_folio_items: added service_order_id');
    }
  } catch (e: any) {
    console.error('[DB] fin_folio_items service_order_id migration:', e.message);
  }

  // --- Migration: a folio charge may come from a service order ---
  //
  // `source` said where a charge came from and had five answers, none of them
  // "the guest ordered this". Reusing 'manual' would work and would make
  // "which charges came from service orders" unanswerable — the question
  // reception asks when a bill looks wrong.
  //
  // SQLite cannot widen a CHECK, so the table is rebuilt. Same shape as the
  // fin_invoices.status rebuild above.
  try {
    const row = database.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', 'fin_folio_items') as { sql: string } | undefined;
    // The SOURCE constraint specifically, not "does the DDL mention 'service'
    // anywhere". It does: `kind` has allowed 'service' since the table was
    // created, so a whole-DDL test reports the work already done and skips it —
    // silently, which is how this nearly shipped.
    const sourceCheck = row?.sql?.match(/CHECK\s*\(\s*source\s+IN\s*\([^)]*\)\s*\)/i)?.[0];
    if (sourceCheck && !sourceCheck.includes("'service'")) {
      const rebuilt = (row as { sql: string }).sql.replace(
        sourceCheck,
        "CHECK (source IN ('nightly','ota_split','manual','restaurant','import','service'))",
      );
      const cols = (database.prepare('PRAGMA table_info(fin_folio_items)').all() as any[])
        .map((c: any) => `"${c.name}"`).join(', ');
      database.exec('PRAGMA foreign_keys = OFF');
      database.exec('BEGIN');
      database.exec(rebuilt.replace(/CREATE TABLE fin_folio_items\b/i, 'CREATE TABLE fin_folio_items__rebuilt'));
      database.exec(`INSERT INTO fin_folio_items__rebuilt (${cols}) SELECT ${cols} FROM fin_folio_items`);
      database.exec('DROP TABLE fin_folio_items');
      database.exec('ALTER TABLE fin_folio_items__rebuilt RENAME TO fin_folio_items');
      database.exec('COMMIT');
      database.exec('PRAGMA foreign_keys = ON');
      console.log('[DB] fin_folio_items: source may now be a service order');
    }
  } catch (e: any) {
    console.error('[DB] fin_folio_items source migration:', e.message);
  }

  // --- Migration: скільки токенів моделі витратив цей готель ---
  //
  // OpenAI кличеться з двох місць — розпізнавання документа гостя
  // (`guests/domain/ai/ocr-document.ts`) і машинний переклад контенту
  // (`core/i18n/translate.ts`), — і обидва йдуть ключем СЕРВЕРА, спільним на
  // всіх клієнтів. Тобто рахунок від OpenAI приходить один, а витрачають його
  // різні готелі, і досі не існувало способу сказати, хто скільки.
  //
  // Один рядок = один виклик моделі. Не лічильник, а журнал: підсумок за
  // місяць виводиться з рядків, а лічильник, який лише збільшується, не вміє
  // відповісти «за що саме» і не переживає перерахунку.
  //
  // `organization_id` NOT NULL навмисно. Рядок без орендаря — це витрата, яку
  // не виставити нікому, тобто рівно те, що ця таблиця мусить прибрати.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS ai_usage (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        -- Що саме робили: 'ocr_document', 'translate_content'. Рядок, а не
        -- enum: наступна функція з моделлю не має вимагати міграції.
        feature TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        -- Сума двох, збережена окремо: OpenAI віддає її сам, і для
        -- нерозділених відповідей вона єдине, що є.
        total_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_org ON ai_usage(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_month ON ai_usage(organization_id, created_at)');
  } catch (e) {
    console.error('[DB] ai_usage migration:', (e as Error).message);
  }

  // ─── Блок 4 «День готелю» — міграції 0090–0099 (docs/tasks/README.md) ───
  //
  // Паралельна сесія дописує СЮДИ, в кінець блоку; сесія 1 — вище. При
  // rebase конфлікт вирішується збереженням обох у порядку номерів.

  // --- 0091: перевірка балансу при виселенні — налаштування обʼєкта ---
  //
  // `none | warning | blocking`, дефолт `warning`: виселення з боргом
  // проходить, але відповідь несе прапорець; `blocking` — 422 з назвою
  // причини. І в CREATE, і тут (AGENTS §4): база, народжена до колонки,
  // інакше лишилась би без неї, і виселення з боргом читалось би як
  // «політики немає» — тобто `none`, найслабше з трьох.
  try {
    const propCols = (database.prepare('PRAGMA table_info(properties)').all() as any[]).map((c: any) => c.name);
    if (!propCols.includes('checkout_balance_policy')) {
      database.exec("ALTER TABLE properties ADD COLUMN checkout_balance_policy TEXT NOT NULL DEFAULT 'warning'");
      console.log('[DB] Added checkout_balance_policy to properties');
    }
    if (!propCols.includes('property_type')) {
      // Без DEFAULT: див. коментар у CREATE. Наявні обʼєкти лишаються
      // порожніми і мусять назватись — це видно на екрані, а не вгадується.
      database.exec('ALTER TABLE properties ADD COLUMN property_type TEXT');
      console.log('[DB] Added property_type to properties');
    }
  } catch (e: any) {
    console.error('[DB] properties checkout_balance_policy:', e.message);
  }

  // --- 0090: вкладення до броні ---
  //
  // Файл лежить у `data/uploads/<org>/reservations/…` (те саме сховище, що
  // `api/file-upload`); рядок каже, до якої броні він належить і хто його
  // поклав. `organization_id` явно (інваріант 12) — і в рядку, і в шляху
  // файла, бо саме шлях перевіряє `GET /api/uploads`. Ретенція — разом із
  // бронню (ON DELETE CASCADE); GDPR-цикл знеособлення цю таблицю не чіпає.
  // `kind` — вільний рядок (`document`, `photo`, `other`): словник вкладень
  // не має вимагати міграції.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS reservation_files (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        reservation_id  TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
        kind            TEXT NOT NULL DEFAULT 'other',
        path            TEXT NOT NULL,
        original_name   TEXT NOT NULL,
        mime_type       TEXT,
        size_bytes      INTEGER NOT NULL DEFAULT 0,
        uploaded_by     TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_reservation_files_org ON reservation_files(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_reservation_files_reservation ON reservation_files(reservation_id, created_at)');
  } catch (e: any) {
    console.error('[DB] reservation_files migration:', e.message);
  }

  // --- 0092: історія прибирання ---
  //
  // `units.cleaning_status` міняли мовчки: PATCH номера, чекліст зміни,
  // тепер — виселення. Хто, коли і з якого стану — не лишалось ніде.
  // Рядок = одна зміна стану одного номера; `source` каже, звідки прийшла
  // (`manual` — борд/чекліст, `checkout` — автоматика виселення).
  // `organization_id` явно (інваріант 12); `changed_by` — FK на app_users:
  // невідомий автор — це відмова, а не порожній рядок.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS unit_cleaning_log (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        unit_id         TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        from_status     TEXT NOT NULL,
        to_status       TEXT NOT NULL,
        source          TEXT NOT NULL DEFAULT 'manual',
        changed_by      TEXT REFERENCES app_users(id) ON DELETE SET NULL,
        changed_at      TEXT NOT NULL DEFAULT (datetime('now')),
        note            TEXT
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_unit_cleaning_log_org ON unit_cleaning_log(organization_id, changed_at)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_unit_cleaning_log_unit ON unit_cleaning_log(unit_id, changed_at)');
  } catch (e: any) {
    console.error('[DB] unit_cleaning_log migration:', e.message);
  }

  // --- 0093: компанії-платники ---
  //
  // Досі компанія на броні була семи вільними полями `invoice_company_*`,
  // які набирались руками на кожну бронь заново. Тепер — рядок довідника;
  // вибір платника на картці ставить `reservations.company_id` І переписує
  // ті сім полів з довідника (знімок: документ читає його, а не живий рядок).
  // `business_id` унікальний у межах організації (інваріант 3), порожній не
  // бʼється (часткевий індекс). `archived_at` замість видалення: компанія з
  // бронями лишається в історії, але випадає зі списку вибору.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        business_id     TEXT,
        vat_id          TEXT,
        registry_no     TEXT,
        address_street  TEXT,
        address_city    TEXT,
        address_zip     TEXT,
        address_country TEXT,
        bank_name       TEXT,
        iban            TEXT,
        bic             TEXT,
        email           TEXT,
        phone           TEXT,
        notes           TEXT,
        -- Номер дебітора видає ГОТЕЛЬ, не держава (Д56): business_id це
        -- реєстраційний номер фірми, і підміняти ним номер у книзі дебіторів
        -- означало лишати без номера кожну фірму без реєстрації.
        debtor_no          INTEGER,
        payment_terms_days INTEGER,
        archived_at     TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_companies_org ON companies(organization_id, name)');
    // Унікальність НА ОРГАНІЗАЦІЮ, і предикат обовʼязковий: без нього наявні
    // фірми без номера зіштовхнулись би одна з одною на NULL.
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_debtor_no
        ON companies(organization_id, debtor_no) WHERE debtor_no IS NOT NULL
    `);
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_org_business_id ON companies(organization_id, business_id) WHERE business_id IS NOT NULL');
    const resCols93 = (database.prepare('PRAGMA table_info(reservations)').all() as any[]).map((c: any) => c.name);
    if (!resCols93.includes('company_id')) {
      database.exec('ALTER TABLE reservations ADD COLUMN company_id TEXT REFERENCES companies(id) ON DELETE SET NULL');
      console.log('[DB] Added company_id to reservations');
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_reservations_company ON reservations(company_id)');
  } catch (e: any) {
    console.error('[DB] companies migration:', e.message);
  }

  // --- 0200: тариф, який бачить лише своя фірма (INC-205) ---
  //
  // Звʼязок «фірма → тариф», якого не було ніде: `price_rules` умов «для
  // компанії» не мають, `rate_plans` про компанії не знає.
  //
  // ТАБЛИЦЯ, а не колонка на `rate_plans`, і причина виміряна на базі Ґрайца
  // (MAPPING §125–129): `PREISCODE 3 Firmenpreise` — ОДИН прайс-код на ВСІХ
  // корпоративних гостей, а 8 і 10 — по одному на конкретну фірму. Колонка
  // виражає лише другий випадок; перший довелося б розмножити по разу на
  // кожну з 12 фірм готелю. Повне обґрунтування — у самій міграції 0200 і в
  // К22.
  //
  // `organization_id` на рядку (інваріант 2), бо `rate_plans` свого не має —
  // вона тенантна через `property_id → properties`, і політика без цієї
  // колонки ходила б двома джойнами. UNIQUE з організацією (інваріант 3).
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS company_rate_plans (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        rate_plan_id    TEXT NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        -- Усередині CREATE, а не окремим унікальним індексом: генератор
        -- Postgres-схеми з окремого індексу робить І табличний UNIQUE, І
        -- індекс — два обмеження на ту саму пару під двома іменами. Той
        -- самий клас, про який AGENTS §4 попереджає на констрейнтах.
        UNIQUE(organization_id, company_id, rate_plan_id)
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_company_rate_plans_org ON company_rate_plans(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_company_rate_plans_plan ON company_rate_plans(rate_plan_id)');
  } catch (e: any) {
    console.error('[DB] company_rate_plans migration:', e.message);
  }

  // --- 0094: payment_status приймає 'partial' ---
  //
  // Колонка мала CHECK на чотири значення, а ДВА писачі роками ставили пʼяте:
  // `finance/api/operations.handlers.ts` (перерахунок після кожної операції з
  // бронню — «гроші прийшли, але не всі») і `app/api/payments/route.ts`
  // (`type: deposit|partial`). Обидва впирались у CHECK, і депозит лягав у
  // фінанси, а бронь лишалась «не оплачено» — з помилкою у відповіді, після
  // якої оператор має всі підстави провести оплату вдруге. Планер уже читав
  // це значення (`calendar/page.tsx:559`) і не міг побачити його ніколи.
  //
  // Розширити CHECK у SQLite можна лише перебудовою таблиці, а `reservations`
  // має 67 колонок, накопичених ALTER-ами. Тому новий CREATE не переписується
  // руками — він БЕРЕТЬСЯ з бази і в ньому міняється рівно один CHECK: так
  // жодна колонка, дефолт чи зовнішній ключ не загубиться від перенабору.
  // Далі — домашній візерунок перебудови (`cm_mappings` вище, `accruals`):
  // `PRAGMA foreign_keys = OFF` → `BEGIN` → … → `COMMIT` → `PRAGMA ON`, а в
  // `catch` — `ROLLBACK` І ОБОВʼЯЗКОВО повернення прагми. Перша версія цього
  // блоку транзакції не мала, і обрив на `INSERT` лишав `reservations_new`:
  // застосунок після цього стартував, доходив до `migrations complete` — і
  // обслуговував запити з `foreign_keys = 0`, бо прагму нікому було повернути.
  // Кожен наступний старт повторював те саме, бо міграція вже не завершувалась.
  // Індекси відтворюються через `IF NOT EXISTS` — з тієї ж причини.
  //
  // Канонічний набір індексів `reservations` — один список, бо гілці
  // відновлення нема звідки взяти те, що загинуло разом зі знятою таблицею.
  // Він мусить збігатися з тим, що дає свіжа база; тримає це сцена
  // `db-boot.check.ts` (`afterLost.idx >= fresh.idx`) — не око.
  // `idx_reservations_unassigned` ЧАСТКОВИЙ: предикат `WHERE unit_id IS NULL`
  // не косметика, індекс без нього — інше обмеження.
  const RESERVATION_INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_reservations_property ON reservations(property_id)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_unit ON reservations(unit_id)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_guest ON reservations(guest_id)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_dates ON reservations(check_in, check_out)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_org ON reservations(organization_id)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_external_uid ON reservations(external_uid)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_unit_type ON reservations(unit_type_id)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_parent ON reservations(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_hostex_code ON reservations(hostex_reservation_code)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_company ON reservations(company_id)',
    'CREATE INDEX IF NOT EXISTS idx_reservations_unassigned ON reservations(property_id, check_in) WHERE unit_id IS NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_guest_token ON reservations(guest_page_token)',
  ];
  try {
    // Прибирання за обірваною перебудовою ПЕРШИМ, і воно розрізняє два стани.
    // `reservations_new` сам по собі — це або чернетка (оригінал ще на місці,
    // її можна викидати), або ЄДИНА копія даних (обрив стався між `DROP` і
    // `RENAME`). Сліпий `DROP TABLE IF EXISTS` знищив би другий випадок.
    const hasTable = (name: string) => Boolean(database.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    if (hasTable('reservations_new')) {
      if (hasTable('reservations')) {
        database.exec('DROP TABLE reservations_new');
        console.log('[DB] reservations_new: чернетку обірваної перебудови прибрано');
      } else {
        // Перейменувати — це врятувати РЯДКИ. Індекси гинуть разом зі знятим
        // оригіналом, а після перейменування CHECK уже широкий, тож гілка
        // перебудови нижче (де вони й відтворюються) не виконається НІКОЛИ.
        // Перша версія на цьому й спинялась: 20 броней на місці,
        // `integrity_check ok`, `foreign_keys = 1` — і жодного іменованого
        // індексу. Серед утрачених `idx_reservations_guest_token`, УНІКАЛЬНИЙ:
        // без нього двом бронях можна поставити один гостьовий токен, і про це
        // не скаже жодна помилка. Це не швидкість, це обмеження.
        database.exec('ALTER TABLE reservations_new RENAME TO reservations');
        for (const ix of RESERVATION_INDEXES) database.exec(ix);
        const back = (database.prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name='reservations' AND sql IS NOT NULL",
        ).get() as { n: number }).n;
        console.log(`[DB] reservations: відновлено з reservations_new після обірваної перебудови (${back} індексів повернуто)`);
      }
    }

    const resSql = (database.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='reservations'",
    ).get() as { sql?: string } | undefined)?.sql ?? '';
    const narrow = /CHECK \(payment_status IN \([^)]*\)\)/.exec(resSql);
    // Мовчання не можна плутати з «уже полагоджено»: якщо CHECK на цю колонку
    // не знайшовся зовсім, це не «нічого робити не треба», це «я не впізнав
    // схему». Скажи це вголос — інакше наступний читач лога впевнений, що
    // міграція відпрацювала.
    if (!narrow) {
      console.warn('[DB] 0094: CHECK на payment_status не знайдено в схемі reservations — перебудову НЕ виконано');
    } else if (!narrow[0].includes("'partial'")) {
      console.log('[DB] reservations: payment_status CHECK → + partial (0094) — перебудова зі збереженням індексів');
      const before = (database.prepare('SELECT COUNT(*) AS n FROM reservations').get() as { n: number }).n;
      const indexSql = (database.prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='reservations' AND sql IS NOT NULL",
      ).all() as { sql: string }[]).map((r) => r.sql);
      const cols = (database.prepare('PRAGMA table_info(reservations)').all() as { name: string }[]).map((c) => c.name);
      const createNew = resSql
        .replace(narrow[0], "CHECK (payment_status IN ('unpaid', 'payment_requested', 'partial', 'prepaid', 'paid'))")
        .replace(/^CREATE TABLE\s+"?reservations"?/i, 'CREATE TABLE reservations_new');
      if (createNew === resSql) throw new Error('не вдалося перейменувати таблицю в CREATE — перебудову скасовано');

      // Прагма — ПОЗА транзакцією: усередині SQLite її мовчки ігнорує.
      database.exec('PRAGMA foreign_keys = OFF');
      database.exec('BEGIN');
      database.exec(createNew);
      const list = cols.map((c) => `"${c}"`).join(', ');
      database.exec(`INSERT INTO reservations_new (${list}) SELECT ${list} FROM reservations`);
      database.exec('DROP TABLE reservations');
      database.exec('ALTER TABLE reservations_new RENAME TO reservations');
      for (const ix of indexSql) {
        database.exec(ix.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, (m) => `${m}IF NOT EXISTS `));
      }
      // Звірка — ВСЕРЕДИНІ транзакції: інакше вона доповідає про втрату вже
      // після того, як підміна зафіксована, і рятувати нічого.
      const after = (database.prepare('SELECT COUNT(*) AS n FROM reservations').get() as { n: number }).n;
      if (after !== before) throw new Error(`reservations rebuild lost rows: ${before} -> ${after}`);
      const restored = (database.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND tbl_name='reservations' AND sql IS NOT NULL",
      ).get() as { n: number }).n;
      if (restored < indexSql.length) throw new Error(`reservations rebuild lost indexes: ${indexSql.length} -> ${restored}`);
      database.exec('COMMIT');
      database.exec('PRAGMA foreign_keys = ON');
      console.log(`[DB] reservations rebuilt with payment_status 'partial' allowed (${after} rows, ${restored} indexes carried)`);
    }
  } catch (e: any) {
    try { database.exec('ROLLBACK'); } catch { /* поза транзакцією */ }
    database.exec('PRAGMA foreign_keys = ON');
    console.error('[DB] payment_status partial migration:', e.message);
  }

  // ── Блок 5a, 0110: вид, мережа і пароль на НОМЕРІ ───────────────────────
  //
  // Дописано і сюди, і в `CREATE TABLE units` вище: міграції тут пишуться як
  // «оновити з попереднього стану», тож колонка лише в ALTER є в мігрованій
  // базі й відсутня в нового клієнта, а колонка лише в CREATE — навпаки.
  try {
    for (const [col, decl] of [['view', 'TEXT'], ['wifi_network', 'TEXT'], ['wifi_password', 'TEXT']] as const) {
      const cols = (database.prepare('PRAGMA table_info(units)').all() as any[]).map((c: any) => c.name);
      if (!cols.includes(col)) database.exec(`ALTER TABLE units ADD COLUMN ${col} ${decl}`);
    }
  } catch (e) {
    console.error('[DB] units view/wifi migration:', (e as Error).message);
  }

  // ── Блок 5a, 0111: зручності — довідник організації і два призначення ───
  //
  // Дзеркало Postgres-міграції для SQLite розробки. `scope` тут теж із CHECK:
  // без нього матриця призначення пропонує повісити ліфт на тип номера.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS amenity_categories (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(organization_id, code)
      )
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS amenities (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES amenity_categories(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT,
        scope TEXT NOT NULL DEFAULT 'both' CHECK (scope IN ('property', 'unit_type', 'both')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(organization_id, code)
      )
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS property_amenities (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        amenity_id TEXT NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(property_id, amenity_id)
      )
    `);
    database.exec(`
      CREATE TABLE IF NOT EXISTS unit_type_amenities (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        unit_type_id TEXT NOT NULL REFERENCES unit_types(id) ON DELETE CASCADE,
        amenity_id TEXT NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(unit_type_id, amenity_id)
      )
    `);
    for (const [name, spec] of [
      ['idx_amenity_categories_org', 'amenity_categories(organization_id)'],
      ['idx_amenities_org', 'amenities(organization_id)'],
      ['idx_amenities_category', 'amenities(category_id)'],
      ['idx_property_amenities_org', 'property_amenities(organization_id)'],
      ['idx_property_amenities_property', 'property_amenities(property_id)'],
      ['idx_unit_type_amenities_org', 'unit_type_amenities(organization_id)'],
      ['idx_unit_type_amenities_type', 'unit_type_amenities(unit_type_id)'],
    ] as const) {
      database.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${spec}`);
    }
    console.log('[DB] amenities catalogue and assignments ready');
  } catch (e) {
    console.error('[DB] amenities migration:', (e as Error).message);
  }

  // --- 0096: операція знає рядок, який вона поклала в книгу гостя (Р10.6) ---
  //
  // Реверс мусив знати, ЩО саме він знімає. Доти він знімав із фоліо будь-який
  // дохід із `reservation_id` — а `source` не розрізняє: місток теж передає
  // `'manual'`. Бухгалтер заводив у Фінансах помилкові 1200 по броні (у фоліо
  // вони, за Д21, не лягали), видаляв їх — і реверс забирав 1200 з ГРОШЕЙ
  // ГОСТЯ. Пара була асиметрична: створення у фоліо не додає, видалення знімає.
  //
  // Порожня колонка означає «ця операція у книзі гостя нічого не клала», і це
  // стан переважної більшості рядків — усі ручні проводки обліку.
  try {
    const cols = database.prepare("PRAGMA table_info(fin_operations)").all() as { name: string }[];
    if (!cols.some((c) => c.name === 'folio_payment_id')) {
      database.exec('ALTER TABLE fin_operations ADD COLUMN folio_payment_id TEXT');
      console.log('[DB] 0096: fin_operations.folio_payment_id ready');
    }
  } catch (e: any) {
    console.error('[DB] 0096 folio_payment_id:', e.message);
  }

  // --- 0097: СХЕМА довідників. Даних міграція не сіє (INC-028) ---
  //
  // Довідник сіявся один раз на всю базу — `SELECT id FROM organizations
  // LIMIT 1`, проти інваріанта 1, — і з ЛІТЕРАЛЬНИМИ первинними ключами
  // (`ec_accommodation`, `bu_shared`, …), тож другий комплект неможливий за
  // означенням PK. Гірше: міграції котяться, коли `organizations` ще порожня,
  // тож `if (orgRow)` не спрацьовував ВЗАГАЛІ, і на чистій базі довідника не
  // діставалось нікому.
  //
  // Тепер стала величина — `code`, унікальний У МЕЖАХ ОРГАНІЗАЦІЇ
  // (інваріант 3); ідентифікатор випадковий і належить готелю. Міграція
  // робить рівно дві речі, обидві про СХЕМУ:
  //   1. заводить колонку `code`;
  //   2. підписує кодами історичні літеральні рядки — вони лишаються на
  //      місці разом з усіма посиланнями на них.
  //
  // Чого вона НЕ робить і більше не робитиме: не сіє даних. Тут стояв ще й
  // крок 3, який досівав довідник кожній організації, — і це було
  // неправильно за родом: міграція виконується до того, як орендар існує, і
  // «для кожної організації» в ній це вже не міграція, а сівач, що вдає
  // міграцію. Рішення контролера 08.09: засів живе ТІЛЬКИ в
  // `provisionOrganization`.
  //
  // Наслідок названо прямо: організація, заведена ДО переїзду засіву, лишиться
  // без довідника, і перша ж готівкова оплата відмовить — НАЗВАНО, з дією
  // (`payment-bridge.requireCategory`). Разова дія адміністратора —
  // `scripts/seed-chart-of-accounts.mjs`; наявних баз міграція не чіпає.
  try {
    for (const [table, prefix, seed] of [
      ['expense_categories', 'ec_', CHART_OF_ACCOUNTS_SEED],
      ['business_units', 'bu_', BUSINESS_UNITS_SEED],
    ] as const) {
      const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.some((c) => c.name === 'code')) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN code TEXT`);
      }
      const setCode = database.prepare(`UPDATE ${table} SET code = ? WHERE id = ? AND code IS NULL`);
      for (const row of seed) setCode.run(row.code, `${prefix}${row.code}`);
      database.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_org_code ON ${table}(organization_id, code) WHERE code IS NOT NULL`);
    }

    // Осі довідника — ЗА КОДОМ, і саме тут, після того як коди проставлено
    // (Р12.4). Це те, що раніше робили три рядки з літеральними ключами
    // `ec_variable` / `ec_investors` / `ec_transfer` вище: відколи ключ
    // випадковий, вони не влучали ні в що.
    //
    // Стаття без `op_type` і `classifier` не падає й не помиляється видимо:
    // P&L бере `COALESCE(classifier,'other')` і кладе оренду з зарплатою в
    // «Інше», нижче EBITDA, а форма витрати питає `?op_type=expense` і
    // отримує порожній список. Тому підписуємо ЛИШЕ порожнє — вісь, яку
    // готель змінив під себе, лишається його.
    //
    // Це SQLite, тобто девелоперські бази. Готель на Postgres отримує осі
    // при заведенні (`provisionOrganization`), а вже заведеному їх ставить
    // `scripts/seed-chart-of-accounts.mjs` — разовою дією адміністратора.
    const setAxes = database.prepare(`
      UPDATE expense_categories
         SET op_type    = COALESCE(NULLIF(op_type, ''), ?),
             classifier = COALESCE(NULLIF(classifier, ''), ?)
       WHERE code = ?
         AND (op_type IS NULL OR op_type = '' OR classifier IS NULL OR classifier = '')`);
    let axed = 0;
    for (const a of CHART_OF_ACCOUNTS_SEED) {
      axed += setAxes.run(a.opType, a.classifier, a.code).changes;
    }
    if (axed > 0) console.log(`[DB] 0097: axes (op_type/classifier) written by code for ${axed} catalogue rows`);
  } catch (e: any) {
    console.error('[DB] 0097 catalogue code column:', e.message);
  }

  // --- 0120: осі, які легасі-бекфіл поставив НЕПОРОЖНІМИ й неправильними ---
  //
  // 0097 підписував осі там, де порожньо, — і тому не чіпав саме ті бази, яким
  // гірше за всіх (Р13.6). Одноразовий бекфіл вище (блок «Finmap PR #2») до
  // цієї правки ставив `Revenue → classifier 'other'` і не мав `Financing` у
  // жодному `WHEN`, тож `investors` діставав `other/other`. Обидва значення
  // непорожні: другий бекфіл, який лікує порожнє, після них не спрацьовував
  // уже ніколи, а `seed-chart-of-accounts.mjs --list` показував «без осей: 0».
  // Тобто перевірка доповідала про безпеку, дивлячись не туди.
  //
  // Міра тут — РОЗБІЖНІСТЬ із правилом, не порожнеча. Спершу за `code`
  // (`CHART_OF_ACCOUNTS`), і лише рядки БЕЗ коду — за `std_group`: два рядки
  // плану навмисно відхиляються від своєї групи (`variable` — COGS, але
  // «Змінні»; `investors` — Financing, але надходження), і лікування самою
  // групою зламало б обидва. Те саме правило й тим самим порядком —
  // `src/modules/finance/data/axis-repair.ts` (гейт `axis-repair.check`) і
  // міграція Postgres 0120.
  //
  // Групи, якої немає в мапі, не чіпаємо: вгадана вісь це гроші в чужому
  // рядку звіту. Такі статті називає читач П&L (інваріант 13).
  try {
    const byCode = database.prepare(
      `UPDATE expense_categories SET op_type = ?, classifier = ?
        WHERE code = ? AND (COALESCE(op_type, '') != ? OR COALESCE(classifier, '') != ?)`);
    let fixed = 0;
    for (const a of CHART_OF_ACCOUNTS_SEED) {
      fixed += byCode.run(a.opType, a.classifier, a.code, a.opType, a.classifier).changes;
    }
    const codes = CHART_OF_ACCOUNTS_SEED.map(() => '?').join(',');
    const byGroup = database.prepare(
      `UPDATE expense_categories SET op_type = ?, classifier = ?
        WHERE std_group = ?
          AND (code IS NULL OR code NOT IN (${codes}))
          AND (COALESCE(op_type, '') != ? OR COALESCE(classifier, '') != ?)`);
    const chartCodes = CHART_OF_ACCOUNTS_SEED.map((a) => a.code);
    for (const [group, axis] of Object.entries(AXIS_BY_STD_GROUP_SEED)) {
      fixed += byGroup.run(
        axis.opType, axis.classifier, group, ...chartCodes, axis.opType, axis.classifier).changes;
    }
    if (fixed > 0) console.log(`[DB] 0120: axes corrected on ${fixed} catalogue rows (wrong, not just empty)`);
  } catch (e: any) {
    console.error('[DB] 0120 axis repair:', e.message);
  }

  // --- 0121: відмова, яку видно готелю, а не лише логу контейнера ---
  //
  // Обидві колонки додаються І в CREATE вище, І тут (AGENTS §4): міграції
  // написані як «оновити з попереднього стану», тож ALTER легко опиняється
  // вище за CREATE тієї самої таблиці — на порожній базі це тихо падає, і
  // новий клієнт лишається без колонки, яку код читає.
  for (const [table, column, ddl] of [
    ['fin_recurring_templates', 'failed_runs', 'INTEGER NOT NULL DEFAULT 0'],
    ['fin_recurring_templates', 'last_error', 'TEXT'],
    ['fin_recurring_templates', 'last_error_at', 'TEXT'],
    ['fin_auto_rules', 'broken_fields', 'TEXT'],
  ] as const) {
    try {
      const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.some((c) => c.name === column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
        console.log(`[DB] 0121: ${table}.${column} added`);
      }
    } catch (e: any) {
      console.error(`[DB] 0121 ${table}.${column}:`, e.message);
    }
  }

  // --- 0098 (ключі довідників з орендарем) — НЕ ЗРОБЛЕНО, і ось чому ---
  //
  // План був: складений зовнішній ключ
  // `(organization_id, category_id) REFERENCES expense_categories(organization_id, id)`
  // замість одноколонкового. Він і є тим, що робить клас INC-025 неможливим,
  // а не лише невживаним: одноколонковий ключ пропускає операцію одного
  // готелю на рядок довідника ІНШОГО (RI-тригери виконуються з вимкненою row
  // security, тож ключ бачить рядок, а політика при читанні його ховає).
  //
  // Написано, перебудовано, доведено червоністю на порожній базі — і
  // ВІДКОЧЕНО, бо `scripts/pg-schema.mjs` складених ключів не вміє. Він
  // розкладає їх на два одноколонкові й видає, зокрема,
  // `FOREIGN KEY (organization_id) REFERENCES business_units(organization_id)`
  // — констрейнт, який означає не те й якого в базі бути не має. Схема
  // Postgres генерується з цієї SQLite (інваріант 10), тож поки генератор не
  // навчиться, складений ключ у `db/postgres/schema.sql` не потрапить —
  // а неправильний констрейнт там гірший за відсутній.
  //
  // Що вже тримає межу без нього: жоден шлях коду більше не вміє скласти
  // посилання на чужий рядок — ідентифікатори випадкові й потенантні,
  // літералів у коді немає (0097 і `chart-of-accounts.check`). Ключ — це
  // друга лінія, і вона робиться разом із правкою генератора.

  // --- 0095: статус оплати броні перераховується З ФОЛІО (В3) ---
  //
  // Дві книги вже розійшлися в чинних базах: слово в `reservations` ставили
  // троє — картка фоліо, фінансовий модуль зі своєї суми і маркер оплати з
  // типу натиснутої кнопки. Тепер книга одна, і спадок треба привести до неї.
  //
  // Міграція нічого не вигадує, але вона НЕ тотожна `statusFromFolio` і не
  // мусить бути: вона одноразова і навмисно ОБЕРЕЖНІША. Тут: є нарахування
  // проживання і борг нуль — `paid`; є проживання, гроші є, але не всі —
  // `partial`; усе інше — слово лишається як стояло. Чого тут НЕМАЄ і що є в
  // домені: «нараховано, а грошей у книзі БУЛО і не стало» → `unpaid`. Це
  // відповідь про подію (зустрічний рядок зняв платіж), а не про залишок, і
  // застосовувати її оптом до спадку означало б перевести в «не оплачено»
  // броні, яких ніхто не чіпав. Тотожність тут раніше була заявлена — і після
  // Р8.7 перестала бути правдою (Р10.10).
  //
  // І кожну бронь, де було інакше, міграція називає в лозі поіменно:
  // розбіжність — це те, що хтось має побачити, а не те, що тихо зникає під
  // `UPDATE`.
  //
  // `is_prepaid` не чіпається: канал зібрав гроші з гостя, і часткова виплата
  // на рахунок готелю не робить бронь «частково оплаченою» для рецепції.
  try {
    const rows = database.prepare(`
      SELECT r.id, r.payment_status,
        (SELECT COALESCE(SUM(i.total_gross), 0) FROM fin_folio_items i
            JOIN fin_folios f ON f.id = i.folio_id
           WHERE f.reservation_id = r.id AND i.voided_by_item_id IS NULL) AS charged,
        (SELECT COALESCE(SUM(p.amount), 0) FROM fin_folio_payments p
            JOIN fin_folios f ON f.id = p.folio_id
           WHERE f.reservation_id = r.id) AS paid,
        (SELECT COUNT(*) FROM fin_folio_items i
            JOIN fin_folios f ON f.id = i.folio_id
           WHERE f.reservation_id = r.id AND i.voided_by_item_id IS NULL AND i.kind = 'lodging') AS lodging
        FROM reservations r
       WHERE COALESCE(r.is_prepaid, 0) <> 1
    `).all() as { id: string; payment_status: string; charged: number; paid: number; lodging: number }[];

    const upd = database.prepare('UPDATE reservations SET payment_status = ? WHERE id = ?');
    const diverged: string[] = [];
    for (const r of rows) {
      const charged = Number(r.charged) || 0;
      const paid = Number(r.paid) || 0;
      if (!(charged > 0) || Number(r.lodging) === 0) continue;   // фоліо мовчить
      // Порівняння з допуском у півкопійки, а не `Math.round(x*100)/100`:
      // остання форма заборонена інваріантом 9 і бреше саме на копійках
      // (1.005 * 100 = 100.49999999999999). `money()` сюди не імпортується —
      // db.ts живе до модулів.
      const word = (charged - paid) <= 0.005
        ? 'paid'
        : (paid > 0 ? 'partial' : null);
      if (!word || word === r.payment_status) continue;
      diverged.push(`${r.id}: ${r.payment_status} → ${word}`);
      upd.run(word, r.id);
    }
    if (diverged.length) {
      console.log(`[DB] 0095: статус оплати перераховано з фоліо для ${diverged.length} брон(і/ей) — книги розходились:`);
      for (const line of diverged) console.log(`[DB]   ${line}`);
    }
  } catch (e: any) {
    console.error('[DB] 0095 payment status from folio:', e.message);
  }

  // --- Колонки, які зносить чужа перебудова, дописуються ОСТАННІМИ ---
  //
  // `fin_operation_id` додається через ALTER на рядок ~2490, а перебудови
  // `accruals` (зняття мертвого ключа) і `capex_items` відтворюють таблицю з
  // ЇЇ CREATE — тобто пізніше і без цієї колонки. На порожній базі вона
  // зникала тут-таки: мігрований клієнт її мав, а НОВИЙ — ні.
  //
  // Побачив це не гейт, а генератор схеми, коли її вперше зібрали з
  // по-справжньому свіжої бази: `check-fresh-schema` звіряє SQLite із SQLite,
  // і там колонки бракує з обох боків — рівно та сліпота, про яку AGENTS §4
  // каже про індекси. Тому дописуємо в кінці, коли всі перебудови позаду;
  // перевірка ідемпотентна, на мігрованій базі це no-op.
  for (const tbl of ['capex_items', 'accruals', 'invoices']) {
    try {
      const cols = database.prepare(`PRAGMA table_info(${tbl})`).all() as { name: string }[];
      if (cols.length > 0 && !cols.some((c) => c.name === 'fin_operation_id')) {
        database.exec(`ALTER TABLE ${tbl} ADD COLUMN fin_operation_id TEXT REFERENCES fin_operations(id)`);
        console.log(`[DB] ${tbl}: fin_operation_id повернуто після перебудов`);
      }
    } catch { /* таблиці може не бути */ }
  }

  // Міграція 0100 живе ОКРЕМОЮ функцією, а не тілом тут, і це не стиль.
  //
  // Вона стояла впритул до хвоста `runMigrations`, куди дописують ще дві
  // сесії, і перше зведення гілок уже поклало її ВСЕРЕДИНУ чужого циклу
  // (`79fc031e`): тоді дужка не зійшлася і `tsc` це побачив. Наступного
  // разу могла б зійтися — і блок мовчки виконувався б по разу на кожну
  // ітерацію чужого списку.
  //
  // Окрема функція знімає саме цю можливість: злиття, яке занесе виклик не
  // туди, лишить визначення на місці, а виклик у чужому циклі впаде на
  // `tsc` або дасть видимий повтор у лозі — замість тиші.
  migrateOtaMirror(database);

  // --- Migration: ключ походження на грошах і документах (INC-307) ---
  //
  // Пара до 0303. Колонки додаються ALTER-ом, бо ці таблиці створюються в
  // різних місцях схеми, а індекси — після них.
  try {
    for (const t of ['companies', 'invoices', 'fin_invoice_lines', 'fin_invoice_tax_totals',
      'fin_folio_items', 'fin_folio_payments']) {
      const cols = database.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
      if (cols.length > 0 && !cols.some((c) => c.name === 'external_ref')) {
        database.exec(`ALTER TABLE ${t} ADD COLUMN external_ref TEXT`);
        console.log(`[DB] ${t}: external_ref (INC-307)`);
      }
      database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_external_ref
        ON ${t} (organization_id, external_ref) WHERE external_ref IS NOT NULL`);
    }
  } catch (e: any) {
    console.log('[DB] money external_ref migration note:', e.message);
  }

  // --- Migration: «різні люди» і хто злив (INC-304) ---
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS guest_not_duplicates (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        guest_low_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
        guest_high_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
        decided_by TEXT,
        decided_at TEXT NOT NULL DEFAULT (datetime('now')),
        note TEXT,
        CHECK (guest_low_id < guest_high_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_not_duplicates_pair
        ON guest_not_duplicates (organization_id, guest_low_id, guest_high_id);
      CREATE INDEX IF NOT EXISTS idx_guest_not_duplicates_org
        ON guest_not_duplicates (organization_id);
    `);
    const gc = database.prepare('PRAGMA table_info(guests)').all() as { name: string }[];
    for (const col of ['merged_at', 'merged_by']) {
      if (gc.length > 0 && !gc.some((c) => c.name === col)) {
        database.exec(`ALTER TABLE guests ADD COLUMN ${col} TEXT`);
        console.log(`[DB] guests: ${col} (INC-304)`);
      }
    }
  } catch (e: any) {
    console.log('[DB] not-duplicates migration note:', e.message);
  }

  // --- Migration: ключ походження імпорту (INC-301) ---
  //
  // Пара до CREATE вище (AGENTS §4). Індекси — ПІСЛЯ колонок.
  try {
    for (const t of ['guests', 'reservations']) {
      const cols = database.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
      if (cols.length > 0 && !cols.some((c) => c.name === 'external_ref')) {
        database.exec(`ALTER TABLE ${t} ADD COLUMN external_ref TEXT`);
        console.log(`[DB] ${t}: external_ref (INC-301)`);
      }
    }
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_external_ref
        ON guests (organization_id, external_ref) WHERE external_ref IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_external_ref
        ON reservations (organization_id, external_ref) WHERE external_ref IS NOT NULL;
    `);
  } catch (e: any) {
    console.log('[DB] external_ref migration note:', e.message);
  }

  // 0400 — так само окремою функцією, з тієї самої причини.
  migrateApps(database);

  // --- Migration: згоди на особі і слід злиття (INC-300) ---
  //
  // Пара до CREATE вище: «додаєш колонку — додай її і в CREATE, і в ALTER»
  // (AGENTS §4). Таблиці — `IF NOT EXISTS`, колонка — з переглядом PRAGMA:
  // на мігрованій базі це no-op, на свіжій усе вже створене вище.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS consent_texts (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        consent_kind TEXT NOT NULL,
        version TEXT NOT NULL,
        locale TEXT NOT NULL,
        body TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_texts_org_kind_version
        ON consent_texts (organization_id, consent_kind, version, locale);
      CREATE INDEX IF NOT EXISTS idx_consent_texts_org ON consent_texts (organization_id);
      CREATE TABLE IF NOT EXISTS guest_consents (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
        consent_kind TEXT NOT NULL,
        version TEXT NOT NULL,
        source TEXT NOT NULL,
        given_at TEXT NOT NULL DEFAULT (datetime('now')),
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_guest_consents_org ON guest_consents (organization_id);
      CREATE INDEX IF NOT EXISTS idx_guest_consents_guest
        ON guest_consents (organization_id, guest_id, consent_kind);
    `);
    const guestCols = database.prepare('PRAGMA table_info(guests)').all() as { name: string }[];
    if (guestCols.length > 0 && !guestCols.some((c) => c.name === 'merged_into')) {
      database.exec('ALTER TABLE guests ADD COLUMN merged_into TEXT REFERENCES guests(id) ON DELETE SET NULL');
      console.log('[DB] guests: merged_into (INC-300)');
    }
    // Частковий індекс — ПІСЛЯ колонки, і предикат тут не косметика: без нього
    // це інший індекс, і `check-schema-drift` каже, що новий клієнт заводиться
    // без того, що є в мігрованого (AGENTS §4).
    database.exec(`CREATE INDEX IF NOT EXISTS idx_guests_merged_into
      ON guests (organization_id) WHERE merged_into IS NULL`);
  } catch (e: any) {
    console.log('[DB] guest consents migration note:', e.message);
  }
  // 0403 — застосунок winhotel_import: знімки бази Winhotel.
  migrateWinhotelImport(database);

  // --- Migration: is_pool_unit на броні (INC-045) ---
  //
  // Пара до CREATE вище: «додаєш колонку — додай її і в CREATE, і в ALTER»
  // (AGENTS §4). У кінці, коли всі перебудови reservations позаду, — інакше
  // наступний DROP+RENAME зніс би її мовчки.
  //
  // Значення тут ніхто не підтримує: на SQLite обмеження немає, і колонка
  // існує рівно для того, щоб схема двох двигунів була однією схемою. На
  // Postgres її наповнює тригер із 0133.
  try {
    const cols = database.prepare('PRAGMA table_info(reservations)').all() as { name: string }[];
    if (cols.length > 0 && !cols.some((c) => c.name === 'is_pool_unit')) {
      database.exec('ALTER TABLE reservations ADD COLUMN is_pool_unit INTEGER NOT NULL DEFAULT 0');
      console.log('[DB] reservations: is_pool_unit (INC-045)');
    }
  } catch (e: any) {
    console.log('[DB] is_pool_unit migration note:', e.message);
  }

  // The last line of runMigrations, and the only reliable signal that the
  // schema has settled. scripts/check-fresh-schema.mjs waits for it: polling
  // the table count said "done" while ALTER TABLE ADD COLUMN was still going,
  // and the comparison then reported dozens of differences that were really
  // just a race with itself.
  // --- Міграція: вісь ОБʼЄКТА в конфігурації фінансів (INC-038, Д54) ---
  //
  // Власник (В11, 09.09.2026): «не можуть бути одні фінанси на 2 обʼєкти, бо в
  // них різна бухгалтерія і різні правила по ПДВ і всьому можуть бути; тому і
  // налаштовуватися це все має окремо».
  //
  // Форма — НУЛЬОВА колонка: `NULL` = «на весь рахунок», старшинство — будинок
  // перед рахунком (той самий взірець, що Д51, `channel_rate_rules`,
  // `invoices`). Обовʼязкова вимагала б вигадати будинок кожному наявному рядку
  // шести таблиць і зламала б готель з одним обʼєктом, який про обʼєкти не
  // думає; нульова лишає всі наявні рядки законними «спільними».
  //
  // Колонка стоїть І в CREATE вище, І тут (AGENTS §4): CREATE — для нового
  // клієнта, ALTER — для того, чия база вже існує. Блок наприкінці ланцюжка,
  // після всіх CREATE: `ALTER` над таблицею, якої ще немає, тихо падає.
  for (const tbl of [
    'fin_tax_rates', 'invoice_series', 'expense_categories',
    'finance_accounts', 'business_units', 'finance_counterparties',
  ]) {
    try {
      const cols = database.prepare(`PRAGMA table_info(${tbl})`).all() as { name: string }[];
      if (cols.length > 0 && !cols.some((c) => c.name === 'property_id')) {
        database.exec(`ALTER TABLE ${tbl} ADD COLUMN property_id TEXT REFERENCES properties(id)`);
        console.log(`[DB] ${tbl}: вісь обʼєкта (NULL = на весь рахунок)`);
      }
      // Індекс читання: «цей рахунок, цей будинок або спільне». Без нього
      // кожен список конфігурації сканує таблицю цілком.
      database.exec(
        `CREATE INDEX IF NOT EXISTS idx_${tbl}_property ON ${tbl}(organization_id, property_id)`);
    } catch (e: any) {
      console.error(`[DB] ${tbl} property axis:`, e.message);
    }
  }

  // Серії: старий унікальний індекс тримав «один код на РАХУНОК» і не давав
  // другому будинку завести свою серію з тим самим кодом. Знімаємо його ЯВНО —
  // `CREATE ... IF NOT EXISTS` нового індексу старого не прибирає, і два
  // обмеження жили б поруч, з яких старе суворіше.
  try {
    const seriesCols = database.prepare("PRAGMA table_info(invoice_series)").all() as { name: string }[];
    if (seriesCols.length > 0) {
      database.exec('DROP INDEX IF EXISTS idx_invoice_series_code');
      database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_series_row
          ON invoice_series(organization_id, (COALESCE(property_id, '')), code)
      `);
    }
  } catch (e: any) {
    console.error('[DB] invoice_series row index:', e.message);
  }

  // Лічильник номерів і замок місяця належать РЯДКОВІ СЕРІЇ, а не її коду.
  //
  // Це друга половина Д54, якої в самому рішенні немає — її не було видно зі
  // схеми конфігурації. Знявши «один код на рахунок», ми відкриваємо саме той
  // випадок, задля якого знімали: дві серії з кодом `FA` у двох будинках. А
  // `invoice_counters` і `invoice_periods` ключовані `(організація, серія,
  // рік/місяць)` — тобто обидві серії ділили б ОДИН прогін і ОДИН замок:
  // другий будинок продовжував би чужі номери, а закриття місяця в одному
  // заморожувало б документи іншого. Без жодної помилки в лозі.
  //
  // Перебудова, не `ALTER`: ключ у SQLite не міняється на місці. Рядки
  // переносяться з `property_id = NULL` — усе, що видано досі, видано на весь
  // рахунок, і саме таким має лишитись. Обмеження переїжджає з PRIMARY KEY на
  // УНІКАЛЬНИЙ ІНДЕКС по `COALESCE`: нульова колонка в ключі інакше не
  // працює — жоден із двох рушіїв не вважає NULL рівним NULL.
  //
  // Лічильник рядків звіряється (AGENTS §4): перебудова, яка мовчки загубила
  // рядки, віддає базу, у якій нумерація починається спочатку.
  for (const [tbl, keyCol, rest] of [
    ['invoice_counters', 'year', 'last_no INTEGER NOT NULL DEFAULT 0'],
    ['invoice_periods', 'month', "status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')), locked_at TEXT"],
  ] as const) {
    try {
      const cols = database.prepare(`PRAGMA table_info(${tbl})`).all() as { name: string }[];
      if (cols.length > 0 && !cols.some((c) => c.name === 'property_id')) {
        const before = (database.prepare(`SELECT COUNT(*) c FROM ${tbl}`).get() as { c: number }).c;
        const carried = cols.map((c) => c.name).filter((n) => n !== 'property_id');
        const keyType = tbl === 'invoice_counters' ? 'INTEGER' : 'TEXT';
        database.exec(`
          ALTER TABLE ${tbl} RENAME TO ${tbl}_old;
          CREATE TABLE ${tbl} (
            organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
            series TEXT NOT NULL,
            ${keyCol} ${keyType} NOT NULL,
            ${rest}
          );
          INSERT INTO ${tbl} (${carried.join(', ')})
            SELECT ${carried.join(', ')} FROM ${tbl}_old;
          DROP TABLE ${tbl}_old;
        `);
        const after = (database.prepare(`SELECT COUNT(*) c FROM ${tbl}`).get() as { c: number }).c;
        if (after !== before) {
          console.error(`[DB] ${tbl}: перебудова загубила рядки — було ${before}, стало ${after}`);
        }
        console.log(`[DB] ${tbl}: вісь обʼєкта, ${after} рядків перенесено як спільні`);
      }
      database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_${tbl}_row
          ON ${tbl}(organization_id, (COALESCE(property_id, '')), series, ${keyCol})
      `);
    } catch (e: any) {
      console.error(`[DB] ${tbl} property axis:`, e.message);
    }
  }

  // ── Хвиля Winhotel: номер дебітора і фоліо платника (Д56, Д57) ──────
  //
  // Колонки стоять І в CREATE вище, І тут (AGENTS §4): CREATE — для нового
  // клієнта, ALTER — для бази, яка вже живе. Старт лічильника 1, а не 10000:
  // діапазон 10000–12599 це діапазон ОДНОГО клієнта, і в коді його немає
  // (інваріант 20); готель, що переїжджає зі своєю книгою, ставить свій старт.
  try {
    const orgCols = (database.prepare('PRAGMA table_info(organizations)').all() as any[]).map((c: any) => c.name);
    if (!orgCols.includes('next_debtor_no')) {
      database.exec('ALTER TABLE organizations ADD COLUMN next_debtor_no INTEGER NOT NULL DEFAULT 1');
      console.log('[DB] organizations: лічильник номерів дебітора');
    }
    const coCols = (database.prepare('PRAGMA table_info(companies)').all() as any[]).map((c: any) => c.name);
    if (!coCols.includes('debtor_no')) {
      database.exec('ALTER TABLE companies ADD COLUMN debtor_no INTEGER');
      console.log('[DB] companies: номер дебітора (видає готель, не держава)');
    }
    if (!coCols.includes('payment_terms_days')) {
      database.exec('ALTER TABLE companies ADD COLUMN payment_terms_days INTEGER');
    }
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_debtor_no
        ON companies(organization_id, debtor_no) WHERE debtor_no IS NOT NULL
    `);
    const foCols = (database.prepare('PRAGMA table_info(fin_folios)').all() as any[]).map((c: any) => c.name);
    if (!foCols.includes('company_id')) {
      database.exec('ALTER TABLE fin_folios ADD COLUMN company_id TEXT REFERENCES companies(id) ON DELETE SET NULL');
      console.log('[DB] fin_folios: фоліо платника — знімок імені ним не порівняєш');
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folios_company ON fin_folios(organization_id, company_id)');
  } catch (e: any) {
    console.error('[DB] debtor/payer folio migration:', e.message);
  }

  // ── Довідник способів оплати (0141, Д61) ────────────────────────────────
  //
  // І в CREATE вище, і тут. Засів чотирьох стандартних рядків КОЖНІЙ
  // організації робить міграція, а не код при першому відкритті екрана:
  // інакше готель, який туди ще не заходив, дістав би платіж, що вказує в
  // нікуди. Назв засів не пише — `name IS NULL` означає «стандартна назва
  // класу», і мову вибирає екран, а не міграція.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS fin_payment_methods (
        id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        code              TEXT NOT NULL,
        name              TEXT,
        kind              TEXT NOT NULL,
        ledger_account    TEXT,
        settles_to_debtor INTEGER NOT NULL DEFAULT 0,
        is_active         INTEGER NOT NULL DEFAULT 1,
        position          INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (organization_id, code),
        CHECK (kind IN ('cash','card_terminal','transfer','voucher'))
      );
      CREATE INDEX IF NOT EXISTS idx_fin_payment_methods_org
        ON fin_payment_methods(organization_id, position);
    `);
    const payCols = (database.prepare('PRAGMA table_info(fin_folio_payments)').all() as any[]).map((c: any) => c.name);
    if (!payCols.includes('method_id')) {
      database.exec('ALTER TABLE fin_folio_payments ADD COLUMN method_id TEXT REFERENCES fin_payment_methods(id) ON DELETE RESTRICT');
      console.log('[DB] fin_folio_payments: спосіб оплати став рядком довідника');
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_payments_method ON fin_folio_payments(method_id)');
    // Засів і зворотне заповнення — питанням до ДАНИХ, не до імені обмеження.
    for (const [code, pos] of [['cash', 0], ['card_terminal', 1], ['transfer', 2], ['voucher', 3]] as const) {
      database.prepare(`
        INSERT INTO fin_payment_methods (id, organization_id, code, kind, position)
        SELECT lower(hex(randomblob(16))), o.id, ?, ?, ?
          FROM organizations o
         WHERE NOT EXISTS (SELECT 1 FROM fin_payment_methods m
                            WHERE m.organization_id = o.id AND m.code = ?)
      `).run(code, code, pos, code);
    }
    database.exec(`
      UPDATE fin_folio_payments
         SET method_id = (SELECT m.id FROM fin_payment_methods m
                           WHERE m.organization_id = fin_folio_payments.organization_id
                             AND m.code = fin_folio_payments.method)
       WHERE method_id IS NULL
    `);
  } catch (e: any) {
    console.error('[DB] payment methods migration:', e.message);
  }

  // ── Знижка знає, від чого вона (0142, Д62) ──────────────────────────────
  try {
    const itemCols = (database.prepare('PRAGMA table_info(fin_folio_items)').all() as any[]).map((c: any) => c.name);
    if (!itemCols.includes('discount_of_item_id')) {
      database.exec('ALTER TABLE fin_folio_items ADD COLUMN discount_of_item_id TEXT REFERENCES fin_folio_items(id) ON DELETE CASCADE');
      console.log('[DB] fin_folio_items: знижка знає, від чого вона');
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_fin_folio_items_discount_of ON fin_folio_items(discount_of_item_id)');
  } catch (e: any) {
    console.error('[DB] discount link migration:', e.message);
  }

  console.log('[DB] migrations complete');
  }

/**
 * Міграція 0400 — стан звʼязку застосунків і попит «хочу» (Блок «Застосунки»,
 * docs/tasks/2026-09-09-block-apps.md §3.3–3.4). Дзеркало
 * `db/postgres/migrations/0400-*.sql`; політики — лише на Postgres.
 *
 * `app_connections`: один рядок на (організація, обʼєкт-або-NULL, застосунок)
 * — статус, час останнього успіху, час і текст останньої помилки. Унікальність
 * по `COALESCE(property_id, '')`: два NULL в UNIQUE не рівні. `app_wishes`:
 * один рядок на (організація, застосунок).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateApps(database: any) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_connections (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        property_id     TEXT REFERENCES properties(id) ON DELETE CASCADE,
        app             TEXT NOT NULL,
        status          TEXT NOT NULL CHECK (status IN ('connected', 'degraded', 'error', 'disabled')),
        last_ok_at      TEXT,
        last_error_at   TEXT,
        last_error      TEXT,
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_app_connections_org ON app_connections(organization_id)');
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_app_connections_row ON app_connections(organization_id, COALESCE(property_id, ''), app)");
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_wishes (
        id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        app             TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(organization_id, app)
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_app_wishes_org ON app_wishes(organization_id)');
  } catch (e) {
    console.error('[DB] 0400 app_connections/app_wishes:', (e as Error).message);
  }

  // 0401: PIN і PUK адміністратора TSE на рядку обʼєкта — під seal(), ніколи
  // відкритим текстом (Блок «Застосунки» 3.8, З17). Лише ALTER: цей блок іде
  // ПІСЛЯ CREATE fin_fiscal_settings, тож і свіжа, і мігрована база дістають
  // колонку тут.
  try {
    const cols = (database.prepare('PRAGMA table_info(fin_fiscal_settings)').all() as { name: string }[]).map((c) => c.name);
    for (const col of ['tse_admin_pin', 'tse_admin_puk']) {
      if (!cols.includes(col)) {
        database.exec(`ALTER TABLE fin_fiscal_settings ADD COLUMN ${col} TEXT`);
        console.log(`[DB] 0401: fin_fiscal_settings.${col} added`);
      }
    }
    // 0402: недороблена TSS запамʼятовується (id + PUK з 0401), а не
    // створюється вдруге; замок на час походу до вендора.
    for (const col of ['tse_pending_tss_id', 'tse_connecting_at']) {
      if (!cols.includes(col)) {
        database.exec(`ALTER TABLE fin_fiscal_settings ADD COLUMN ${col} TEXT`);
        console.log(`[DB] 0402: fin_fiscal_settings.${col} added`);
      }
    }
  } catch (e) {
    console.error('[DB] 0401/0402 fin_fiscal_settings TSE columns:', (e as Error).message);
  }
}

/**
 * Міграція 0403 — знімки бази Winhotel (застосунок `winhotel_import`,
 * docs/tasks/2026-09-10-block-winhotel-import.md §2.2). Дзеркало
 * `db/postgres/migrations/0403-*.sql`: один рядок на прийнятий gbak-знімок —
 * коли знято, режим, sha256, розмір, стан і числа звірки. Файл лежить на
 * томі; тут — лише те, що про нього треба знати без файлу.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateWinhotelImport(database: any) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS winhotel_snapshots (
        id              TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        taken_at        TEXT,
        mode            TEXT NOT NULL CHECK (mode IN ('backup', 'gbak', 'copy', 'delta')),
        sha256          TEXT NOT NULL,
        size_bytes      INTEGER NOT NULL,
        status          TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'extracting', 'extracted', 'imported', 'failed')),
        error           TEXT,
        counts_json     TEXT,
        received_at     TEXT NOT NULL DEFAULT (datetime('now')),
        imported_at     TEXT,
        UNIQUE(organization_id, sha256)
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_winhotel_snapshots_org ON winhotel_snapshots(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_winhotel_snapshots_received ON winhotel_snapshots(organization_id, received_at)');
    // 0405: режим `delta`. SQLite не вміє змінити CHECK — таблиця перебудовується,
    // індекси знімаються до підміни й повертаються після (AGENTS §4).
    const ddl = String((database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'winhotel_snapshots'").get() as any)?.sql ?? '');
    if (ddl && !ddl.includes("'delta'")) {
      const indexes = (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'winhotel_snapshots' AND sql IS NOT NULL").all() as any[]).map((r) => String(r.sql));
      database.exec(`
        CREATE TABLE winhotel_snapshots_new (
          id              TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          taken_at        TEXT,
          mode            TEXT NOT NULL CHECK (mode IN ('backup', 'gbak', 'copy', 'delta')),
          sha256          TEXT NOT NULL,
          size_bytes      INTEGER NOT NULL,
          status          TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'extracting', 'extracted', 'imported', 'failed')),
          error           TEXT,
          counts_json     TEXT,
          received_at     TEXT NOT NULL DEFAULT (datetime('now')),
          imported_at     TEXT,
          UNIQUE(organization_id, sha256)
        )
      `);
      database.exec(`INSERT INTO winhotel_snapshots_new (id, organization_id, taken_at, mode, sha256, size_bytes, status, error, counts_json, received_at, imported_at)
                     SELECT id, organization_id, taken_at, mode, sha256, size_bytes, status, error, counts_json, received_at, imported_at FROM winhotel_snapshots`);
      database.exec('DROP TABLE winhotel_snapshots');
      database.exec('ALTER TABLE winhotel_snapshots_new RENAME TO winhotel_snapshots');
      for (const sqlText of indexes) database.exec(sqlText);
      const after = (database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'winhotel_snapshots' AND sql IS NOT NULL").get() as any).n;
      if (Number(after) !== indexes.length) console.error(`[DB] 0405 winhotel_snapshots: індексів було ${indexes.length}, стало ${after}`);
    }
  } catch (e) {
    console.error('[DB] 0403 winhotel_snapshots:', (e as Error).message);
  }
  // 0404: відповідність «рядок Winhotel → наш рядок» і те, чого ядро не
  // вміє (частина Б). Дзеркало db/postgres/migrations/0404-*.sql.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS winhotel_refs (
        id              TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        entity          TEXT NOT NULL,
        winhotel_lnr    INTEGER NOT NULL,
        our_id          TEXT NOT NULL,
        fingerprint     TEXT,
        source_taken_at TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(organization_id, entity, winhotel_lnr)
      )
    `);
    // 0405: час знімка, що писав рядок, — старіший знімок не перепише новіше (дельта).
    {
      const refCols = (database.prepare('PRAGMA table_info(winhotel_refs)').all() as any[]).map((c: any) => c.name);
      if (!refCols.includes('source_taken_at')) database.exec('ALTER TABLE winhotel_refs ADD COLUMN source_taken_at TEXT');
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_winhotel_refs_org ON winhotel_refs(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_winhotel_refs_our ON winhotel_refs(organization_id, entity, our_id)');
    database.exec(`
      CREATE TABLE IF NOT EXISTS winhotel_staging (
        id              TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        snapshot_id     TEXT,
        entity          TEXT NOT NULL,
        winhotel_lnr    INTEGER NOT NULL,
        reason          TEXT NOT NULL,
        payload_json    TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(organization_id, entity, winhotel_lnr)
      )
    `);
    database.exec('CREATE INDEX IF NOT EXISTS idx_winhotel_staging_org ON winhotel_staging(organization_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_winhotel_staging_entity ON winhotel_staging(organization_id, entity, reason)');
  } catch (e) {
    console.error('[DB] 0404 winhotel_refs/winhotel_staging:', (e as Error).message);
  }
}

/**
 * Міграція 0100 — дзеркало рівня OTA. Винесена з `runMigrations` навмисно:
 * див. коментар у місці виклику.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateOtaMirror(database: any) {
// --- Migration 0100: рівень OTA — дзеркало каналів зʼєднання (К2) ---
//
// Знімок відповіді вендора, і нічого свого: жодного нашого прапорця, який
// можна змінити тільки в нас. Прохід перезаписує дзеркало ЦІЛКОМ, тож
// канал, якого немає у відповіді, зникає й тут — саме це відрізняє дзеркало
// від накопичувача, і саме через страх «наша копія протухне мовчки» §4.3 ТЗ
// цю таблицю колись прибрав. Тепер свіжість тримає механізм, а не обіцянка.
//
// `ota_code` без CHECK навмисно: перелік каналів належить вендору і росте,
// а закритий словник означав би, що готель із новим каналом бачить порожньо.
try {
  database.exec(`
    CREATE TABLE IF NOT EXISTS cm_channels (
      id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      connection_id     TEXT NOT NULL REFERENCES cm_connections(id) ON DELETE CASCADE,
      remote_channel_id TEXT NOT NULL,
      ota_code          TEXT NOT NULL DEFAULT '',
      title             TEXT NOT NULL DEFAULT '',
      is_active         INTEGER NOT NULL DEFAULT 0,
      settings_json     TEXT,
      mapped_json       TEXT,
      synced_at         TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(connection_id, remote_channel_id)
    )
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_channels_org ON cm_channels(organization_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cm_channels_connection ON cm_channels(connection_id)');

  // І ALTER-ом теж (AGENTS §4): колонка, дописана лише в CREATE, є в нового
  // клієнта й відсутня в мігрованого — тобто екран каналів працює на свіжій
  // базі й падає там, де вже щось було.
  const connCols = (database.prepare('PRAGMA table_info(cm_connections)').all() as any[]).map((c: any) => c.name);
  if (!connCols.includes('channels_synced_at')) {
    database.exec('ALTER TABLE cm_connections ADD COLUMN channels_synced_at TEXT');
    console.log('[DB] cm_connections: added channels_synced_at');
  }
} catch (e) {
  console.error('[DB] cm_channels migration:', (e as Error).message);
}
}

// Generate a cryptographically secure random token for guest pages
export function generateGuestToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * The address of a published report.
 *
 * Twice the length of a guest token, because the two are not guarded the same
 * way. A guest link is handed to one person for one stay; a report link goes
 * to partners and investors, is forwarded, and stays live for years. 32 bytes
 * makes guessing not merely impractical but pointless, and costs 32 characters
 * of URL.
 */
export function generateReportToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function seedData(database: any) {
  // Neutral demo tenant. This runs for any freshly created database, including
  // one belonging to a brand-new customer, so nothing here may reference a
  // specific real hotel, person or mailbox.
  const orgId = 'org_demo';
  const propId = 'prop_demo';
  const catRooms = 'cat_rooms';
  const catSuites = 'cat_suites';

  const day = (offset: number): string => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  database.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(orgId, 'Demo Hotel', 'demo');

  // Рід житла названо і тут — це ЧЕТВЕРТИЙ шлях, яким народжується обʼєкт, і
  // єдиний, що йшов повз варту (рецензія раунду 20, П3). Мовчазного «готель»
  // з нього не виходило — колонка лишалась NULL, — але твердження «рід житла
  // називають на КОЖНОМУ шляху» без цього рядка неповне, а демо-обʼєкт із
  // порожнім родом не змогла б відправити в канал жодна демонстрація.
  database
    .prepare('INSERT INTO properties (id, organization_id, name, slug, city, country, property_type) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(propId, orgId, 'Demo Hotel & Spa', 'demo-hotel', 'Praha', 'CZ', 'hotel');

  const insertCat = database.prepare(
    'INSERT INTO categories (id, property_id, name, type, sort_order, icon, color) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertCat.run(catRooms, propId, 'Rooms', 'resort', 1, '🏨', '#60a5fa');
  insertCat.run(catSuites, propId, 'Suites', 'resort', 2, '✨', '#a78bfa');

  const utStd = 'ut_standard';
  const utDlx = 'ut_deluxe';
  const utSuite = 'ut_suite';
  const insertUT = database.prepare(
    'INSERT INTO unit_types (id, property_id, category_id, name, code, max_adults, base_occupancy, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertUT.run(utStd, propId, catRooms, 'Standard Double', 'STD', 2, 2, 1);
  insertUT.run(utDlx, propId, catRooms, 'Deluxe Double', 'DLX', 3, 2, 2);
  insertUT.run(utSuite, propId, catSuites, 'Suite', 'SUITE', 4, 2, 3);

  const insertUnit = database.prepare(
    'INSERT INTO units (id, unit_type_id, property_id, category_id, name, code, beds, zone, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const units: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const id = `u_std${i}`;
    insertUnit.run(id, utStd, propId, catRooms, `10${i}`, `10${i}`, 2, null, i);
    units.push(id);
  }
  for (let i = 1; i <= 4; i++) {
    const id = `u_dlx${i}`;
    insertUnit.run(id, utDlx, propId, catRooms, `20${i}`, `20${i}`, 2, null, 10 + i);
    units.push(id);
  }
  for (let i = 1; i <= 2; i++) {
    const id = `u_suite${i}`;
    insertUnit.run(id, utSuite, propId, catSuites, `30${i}`, `30${i}`, 4, null, 20 + i);
    units.push(id);
  }

  database
    .prepare('INSERT INTO rate_plans (id, property_id, name, code, pricing_model, priority) VALUES (?, ?, ?, ?, ?, ?)')
    .run('rp_std', propId, 'Standard', 'STD', 'standard', 1);

  const insertFee = database.prepare(
    'INSERT INTO fees_taxes (id, property_id, name, type, amount) VALUES (?, ?, ?, ?, ?)'
  );
  insertFee.run('fee_clean', propId, 'Cleaning', 'per_stay', 500);
  insertFee.run('fee_tax', propId, 'City tax', 'per_person_per_night', 50);

  // Demo owner. Reachable only in development or with an explicit
  // SEED_ADMIN_PASSWORD — the caller above refuses to seed production
  // otherwise, so the literal below can never become a live credential.
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@demo.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'demo1234';
  database
    .prepare('INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)')
    .run('user_admin', orgId, adminEmail, 'Demo Owner', 'owner', bcrypt.hashSync(adminPassword, 10));
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`[Seed] Demo owner: ${adminEmail} / ${adminPassword} — change before exposing this instance.`);
  }

  const guestSeed: [string, string, string, string][] = [
    ['Jan', 'Novak', 'jan.novak@example.com', 'CZ'],
    ['Maria', 'Schmidt', 'maria.schmidt@example.com', 'DE'],
    ['Olena', 'Kovalchuk', 'olena.k@example.com', 'UA'],
    ['Peter', 'Brown', 'peter.brown@example.com', 'GB'],
    ['Anna', 'Dvorakova', 'anna.d@example.com', 'CZ'],
    ['Klaus', 'Weber', 'klaus.weber@example.com', 'DE'],
    ['Tomas', 'Horak', 'tomas.horak@example.com', 'CZ'],
    ['Iryna', 'Petrenko', 'iryna.p@example.com', 'UA'],
    ['Sofia', 'Rossi', 'sofia.rossi@example.com', 'IT'],
    ['Lukas', 'Fischer', 'lukas.fischer@example.com', 'AT'],
    ['Emma', 'Wilson', 'emma.wilson@example.com', 'GB'],
    ['Marek', 'Kowalski', 'marek.k@example.com', 'PL'],
    ['Julie', 'Martin', 'julie.martin@example.com', 'FR'],
    ['David', 'Cerny', 'david.cerny@example.com', 'CZ'],
    ['Nina', 'Larsen', 'nina.larsen@example.com', 'DK'],
  ];
  const insertGuest = database.prepare(
    'INSERT INTO guests (id, organization_id, first_name, last_name, email, country) VALUES (?, ?, ?, ?, ?, ?)'
  );
  guestSeed.forEach(([first, last, email, country], i) => {
    insertGuest.run(`g${String(i + 1).padStart(3, '0')}`, orgId, first, last, email, country);
  });

  // Reservations are placed relative to today so the calendar is populated
  // whenever the demo is seeded, rather than on a fixed historical date.
  // organization_id is named here too. The seed runs on a fresh database with
  // no request context, so the Postgres column DEFAULT has nothing to read —
  // and on SQLite there is no such DEFAULT at all.
  const insertRes = database.prepare(
    'INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, nights, adults, children, status, payment_status, source, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const plan: [number, number, number, number, number, string, string, string][] = [
    // [unitIdx, startOffset, nights, adults, children, status, paymentStatus, source]
    [0, -6, 3, 2, 0, 'checked_out', 'paid', 'direct'],
    [1, -4, 5, 2, 1, 'checked_in', 'paid', 'booking_com'],
    [2, -2, 4, 1, 0, 'checked_in', 'paid', 'direct'],
    [3, -1, 3, 2, 0, 'checked_in', 'prepaid', 'airbnb'],
    [4, 0, 2, 2, 0, 'confirmed', 'unpaid', 'phone'],
    [5, 0, 4, 3, 1, 'confirmed', 'paid', 'booking_com'],
    [6, 1, 3, 2, 0, 'confirmed', 'payment_requested', 'direct'],
    [7, 2, 6, 2, 2, 'confirmed', 'prepaid', 'booking_com'],
    [8, 3, 2, 1, 0, 'tentative', 'unpaid', 'other_ota'],
    [9, 4, 5, 4, 0, 'confirmed', 'paid', 'airbnb'],
    [10, 5, 3, 2, 1, 'confirmed', 'unpaid', 'direct'],
    [11, 7, 4, 2, 0, 'confirmed', 'prepaid', 'booking_com'],
    [0, 8, 3, 2, 0, 'confirmed', 'unpaid', 'phone'],
    [1, 10, 2, 2, 0, 'tentative', 'unpaid', 'whatsapp'],
    [2, 12, 7, 3, 1, 'confirmed', 'paid', 'direct'],
    [3, 14, 3, 2, 0, 'confirmed', 'prepaid', 'booking_com'],
    [4, 16, 4, 2, 2, 'confirmed', 'unpaid', 'airbnb'],
    [5, 19, 2, 1, 0, 'confirmed', 'unpaid', 'direct'],
    [6, 21, 5, 2, 0, 'confirmed', 'paid', 'booking_com'],
    [7, 25, 3, 2, 1, 'tentative', 'unpaid', 'phone'],
  ];
  const RATE: Record<string, number> = { u_std: 1800, u_dlx: 2600, u_suite: 4200 };
  plan.forEach(([unitIdx, start, nights, adults, children, status, paymentStatus, source], i) => {
    const unitId = units[unitIdx];
    const rate = RATE[unitId.replace(/\d+$/, '')] ?? 1800;
    insertRes.run(
      `r${String(i + 1).padStart(3, '0')}`,
      orgId,
      propId,
      unitId,
      `g${String((i % guestSeed.length) + 1).padStart(3, '0')}`,
      day(start),
      day(start + nights),
      nights,
      adults,
      children,
      status,
      paymentStatus,
      source,
      rate * nights
    );
  });

  // No payment rows are seeded: initSchema's `payments` table is dropped later
  // by the fin_operations migration, so anything written here would vanish.
}
