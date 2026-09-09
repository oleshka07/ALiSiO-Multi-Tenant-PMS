/* eslint-disable @typescript-eslint/no-explicit-any */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { FEATURES, setFeature, featureDefault, type FeatureKey } from './features.ts';
import { getSql } from './db/async.ts';
import { runWithOrganization } from './auth/tenant-context.ts';
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, isLanguage } from './i18n/languages.ts';
import { defaultBookingSources } from './booking-sources.ts';
import { CHART_OF_ACCOUNTS, BUSINESS_UNITS } from './chart-of-accounts.ts';
import { timezoneForCountry, isKnownTimezone } from './hotel-day.ts';
import { LODGING_KINDS, isLodgingKind } from './lodging-kinds.ts';

/**
 * Creating a customer.
 *
 * Everything else in this codebase was made multi-tenant — scoping, the
 * feature registry, row-level policies — while there remained exactly ONE way
 * to get a second organization into the database: write the INSERTs by hand.
 * So the isolation was only ever exercised against probe rows a test script
 * made up. This is the missing half: one function that provisions a real
 * tenant the same way every time, and can be called from a script today and a
 * signup form later.
 *
 * Imports here are relative WITH the .ts extension so the module loads both
 * under the bundler and under plain node — scripts/provision-org.mjs runs it
 * directly, and '@core/…' means nothing outside webpack.
 *
 * What a working organization needs, in one transaction:
 *   organization → owner (real password hash) → property → a category, so the
 *   calendar has something to group by → рядок на КОЖЕН ключ реєстру.
 *
 * Інтеграції стартують вимкненими НАВМИСНО. Новий клієнт не має ані шлюзу
 * оплати, ані токена каналу, ані сайту віджета; показувати йому пункти меню,
 * які відповідають 403, гірше, ніж не показувати їх узагалі.
 *
 * Модулі PMS стартують увімкненими — з тієї самої причини, з протилежного
 * боку. «Задачі», «Зали», «Аналітика», «Дашборди», «Аркуші дня» нічого не
 * вимагають від клієнта: вони працюють із першого дня, і готель, який їх не
 * потребує, вимикає сам. Хто де — сказано в `FEATURE_SPEC` (core/features.ts),
 * а не тут: список у двох місцях розійшовся б.
 */

export interface NewOrganization {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerName?: string;
  propertyName?: string;
  city?: string;
  country?: string;
  currency?: string;
  timezone?: string;
  /**
   * Рід житла, яким готель називається каналу продажу. ОБОВʼЯЗКОВИЙ.
   *
   * Рішення власника В1 (09.09.2026): «має бути чіткий вибір, один раз
   * обирається і закріплюється за готелем». Не дефолт: вендор каналу бере це
   * поле за ОСНОВУ РАХУНКУ — готельна група тарифікується за обʼєкт, оренда
   * за юніт, — тож підставлений `hotel` це чужий рахунок, виставлений
   * мовчки. Той самий розклад, що з валютою і поясом.
   */
  lodgingKind?: string;
  /**
   * The hotel's base language. Its staff get the interface in it, and it is
   * the language its people type content in — so it is also the source the
   * guest-facing translations are made from. Defaults to Ukrainian, which is
   * what the product itself is still written in.
   */
  language?: string;
  /** Features to switch on immediately. Everything else stays off. */
  enable?: FeatureKey[];
}

export interface ProvisionedOrganization {
  organizationId: string;
  propertyId: string;
  ownerId: string;
  language: string;
  /** Пояс, який реально ліг у базу. */
  timezone: string;
  /**
   * Звідки він узявся: `input` — назвав оператор, `country` — виведено з
   * країни. Повертається, щоб той, хто заводить готель, МІГ ПОКАЗАТИ висновок
   * на підтвердження, а не видати його за введене.
   */
  timezoneFrom: 'input' | 'country';
  /** Рід житла, який ліг на обʼєкт. Названий — іншого шляху немає (В1). */
  lodgingKind: string;
}

/**
 * The one seeded category, in the hotel's own language. It exists so the
 * calendar has a group to draw and the hotel renames it on day one — but
 * handing a German hotel a category called "Номери" is a poor first screen.
 */
const DEFAULT_CATEGORY_NAME: Record<string, string> = {
  uk: 'Номери',
  en: 'Rooms',
  de: 'Zimmer',
  cs: 'Pokoje',
  pl: 'Pokoje',
  nl: 'Kamers',
  fr: 'Chambres',
};

/**
 * Каса готелю — теж своєю мовою, і теж рівно одна.
 *
 * Без жодного рядка `finance_accounts` місток платежів шукає запасний рахунок
 * (`payment-bridge`), не знаходить нічого, і `createOperationInTx` відмовляє:
 * `income requires account_to_id`. Тобто СВІЖОЗАВЕДЕНИЙ готель не може
 * провести готівку взагалі — друга ланка INC-028.
 *
 * Одна каса, не набір: банк, термінал і клірингові рахунки заводить сам
 * готель під свої реквізити. Ця існує, щоб перша готівка на рецепції мала
 * куди лягти в перший же день.
 */
const DEFAULT_CASH_ACCOUNT_NAME: Record<string, string> = {
  uk: 'Каса',
  en: 'Cash',
  de: 'Kasse',
  cs: 'Pokladna',
  pl: 'Kasa',
  nl: 'Kas',
  fr: 'Caisse',
};

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

export async function provisionOrganization(input: NewOrganization): Promise<ProvisionedOrganization> {
  const sql = getSql();

  const name = input.name?.trim();
  const slug = input.slug?.trim().toLowerCase();
  const email = input.ownerEmail?.trim().toLowerCase();

  if (!name) throw new Error('name is required');
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error('slug must be 2–40 chars, lowercase letters, digits and dashes, not starting or ending with a dash');
  }
  if (!email || !email.includes('@')) throw new Error('a valid ownerEmail is required');
  if (!input.ownerPassword || input.ownerPassword.length < 12) {
    throw new Error('ownerPassword must be at least 12 characters');
  }

  // Rejected rather than quietly defaulted: a typo here means the hotel's
  // staff get the wrong interface and its content is translated from the
  // wrong source, and neither is obvious from the inside.
  const language = input.language?.trim().toLowerCase() || DEFAULT_LANGUAGE;
  if (!isLanguage(language)) {
    throw new Error(`language must be one of: ${LANGUAGE_CODES.join(', ')}`);
  }

  // Валюта — за тим самим правилом, і з тієї ж причини.
  //
  // Тут стояло `input.currency || 'CZK'`. Готель, заведений без --currency,
  // ставав чеським: суми, фактури, віджет і листи гостю — усе в кронах, і
  // ніде жодної помилки. Це основа, від якої рахує вся система; помилитись у
  // ній тихо гірше, ніж не створити готель.
  //
  // Три літери у верхньому регістрі (ISO 4217). Список не звіряємо: валют
  // близько 180, і закритий перелік тут означав би відмову справжньому
  // готелю через те, що ми не встигли за світом.
  const currency = input.currency?.trim().toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error('currency is required: three letters, ISO 4217 (CZK, EUR, UAH, …)');
  }

  // Часовий пояс — за тим самим правилом, і ціна помилки тут вища за валюту.
  //
  // Тут стояло `input.timezone || 'Europe/Prague'`. Пояс вирішує, де
  // проходить МЕЖА ДОБИ: списки приїздів і виїздів, нічний архів неявок,
  // «сьогодні» на кожному екрані — і, головне, дати, якими торгує канал.
  // Український готель із празьким поясом продає не ті дні, і жодної помилки
  // при цьому не видно: колонка заповнена, значення схоже на правду. Вендор
  // каналу тому й пише «Make sure you set … timezone when you create a
  // property».
  //
  // Два шляхи, і обидва явні: пояс називають, або його ВИВОДЯТЬ із країни —
  // і тоді той, хто заводить готель, показує висновок на підтвердження
  // (`timezoneFrom`). Третього — мовчазного — немає.
  let timezone = input.timezone?.trim();
  let timezoneFrom: 'input' | 'country' = 'input';
  if (!timezone) {
    timezone = timezoneForCountry(input.country) ?? undefined;
    timezoneFrom = 'country';
  }
  if (!timezone) {
    // Українською з тієї ж причини, що й рід житла нижче: цей текст друкує
    // оператору `provision-org.mjs`. Імʼя поля лишається — воно каже, ЩО
    // назвати.
    throw new Error(
      'Не вказано часовий пояс (timezone). Назвіть його прямо, або країну, у якої пояс ОДИН '
      + '(UA, CZ, PL, DE, …): країна з кількома поясами, як US чи ES, пояс не визначає');
  }
  // Рід житла — за тим самим правилом, і з тієї ж причини, що валюта й пояс.
  //
  // Рішення власника В1: вибір, а не дефолт. Вендор каналу бере це поле за
  // основу рахунку (готельна група — за обʼєкт, оренда — за юніт), тож
  // мовчазний `hotel` означає чужий тариф, виставлений готелю без його
  // відома, і помітить це не код, а виписка першого числа.
  //
  // Перелік — у ядрі (`lodging-kinds.ts`), не в модулі каналів: рід житла це
  // факт про сам обʼєкт, і форма обʼєкта питає його в готелю, який каналів
  // не купував.
  //
  // Мова відмови — продуктова, і саме тут це не косметика: `provision-org.mjs`
  // друкує `e.message` оператору дослівно (`:92`), тобто ЦЕ і є той екран, на
  // якому людина дізнається про В1. Коміт, що приводив відмови модуля до мови
  // продукту, ці дві проґавив (рецензія раунду 20, П3).
  //
  // Ім'я поля лишається в тексті навмисно, і лише тут: цю відмову читає той,
  // хто заводить готель командою або файлом, і йому потрібно знати, ЯКЕ поле
  // назвати. Відмови, які бачить портьє (`properties.repo`), назв колонок не
  // містять.
  const lodgingKind = input.lodgingKind?.trim();
  if (!lodgingKind) {
    throw new Error(
      'Не вказано рід житла (lodgingKind). Готель називає його сам — ми не вгадуємо: '
      + 'від цього залежить, за що менеджер каналів бере гроші, за обʼєкт чи за юніт. '
      + `Один із ${LODGING_KINDS.length}: ${LODGING_KINDS.join(' ')}`);
  }
  if (!isLodgingKind(lodgingKind)) {
    throw new Error(
      `Роду житла «${lodgingKind}» немає в переліку. `
      + `Один із ${LODGING_KINDS.length}: ${LODGING_KINDS.join(' ')}`);
  }

  // Вигаданий пояс не записується: `todayIn` з нього мовчки падає на UTC, і
  // готель отримує «сьогодні» за Гринвічем, не помітивши цього.
  if (!isKnownTimezone(timezone)) {
    throw new Error(
      `Часової зони «${timezone}» (timezone) не існує. `
      + 'Потрібна назва з бази IANA — наприклад Europe/Kyiv або Europe/Prague');
  }

  // Checked before the transaction so the caller gets the real reason rather
  // than a UNIQUE constraint message.
  if (await sql.row<any>('SELECT 1 FROM organizations WHERE slug = ?', [slug])) {
    throw new Error(`slug "${slug}" is taken`);
  }
  // Тут НЕ перевіряється, чи адреса вже є десь на сервері.
  //
  // Перевірка стояла — і забороняла рівно те, заради чого це місце існує:
  // завести власнику другий готель. Унікальність адреси потенантна
  // (idx_app_users_org_email), організація тут щойно створюється, тож дубля в
  // її межах бути не може за побудовою. А вхід уміє спитати, у який із двох
  // готелів людина заходить (login.handlers.ts).

  const organizationId = `org_${crypto.randomBytes(8).toString('hex')}`;
  const propertyId = `prop_${crypto.randomBytes(8).toString('hex')}`;
  const ownerId = `user_${crypto.randomBytes(8).toString('hex')}`;
  const categoryId = `cat_${crypto.randomBytes(8).toString('hex')}`;
  const cashAccountId = `acc_${crypto.randomBytes(8).toString('hex')}`;

  // As the organization being created. Postgres applies WITH CHECK to every
  // insert — a row whose organization_id does not match the connection's tenant
  // is rejected — and this is the one caller that has no tenant to inherit,
  // because it is making one. The id exists already, so the transaction can run
  // as it: postgres.ts reads this context once, at BEGIN.
  await runWithOrganization(organizationId, async () => await sql.tx(async (t) => {
    await t.run(`
      INSERT INTO organizations (id, name, slug, timezone, default_currency, language)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [organizationId, name, slug, timezone, currency, language]);

    // Currency lives on the organization; a property carries location and
    // times. (getOrgIdentity and the ARI push both read it from there.)
    await t.run(`
      INSERT INTO properties (id, organization_id, name, slug, city, country, property_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [propertyId, organizationId,
      input.propertyName || name,
      `${slug}-1`,
      input.city || null,
      // Країна, якої ніхто не назвав, — NULL, а не «CZ».
      //
      // Ця колонка не етикетка: `documentLanguage()` виводить із неї
      // ЮРИСДИКЦІЮ рахунка, і вона перебиває мову організації. «CZ» за
      // замовчуванням давало німецькому готелю чеську фактуру в кронах —
      // і, що гірше, порожнє значення дало б правильну відповідь: при NULL
      // та сама функція падає на мову організації, тобто на `de`.
      //
      // Тому мовчазного вгадування тут більше немає: не названо — NULL, і
      // юрисдикцію вирішує мова готелю, поки країну не введуть явно.
      input.country || null,
      // Рід житла — названий, звірений вище. Мовчазного дефолту немає (В1).
      lodgingKind]);

    // One category so the calendar has a group to draw. Its name is generic on
    // purpose — the hotel renames it, and the type is now free text.
    await t.run(`
      INSERT INTO categories (id, property_id, name, type, sort_order)
      VALUES (?, ?, ?, 'rooms', 1)
    `, [categoryId, propertyId, DEFAULT_CATEGORY_NAME[language] ?? DEFAULT_CATEGORY_NAME.en]);

    // Канали, з яких приходить бронь. Без них КОЖНА бронь малюється сірим
    // бейджем «direct» — однаковим для прямого гостя, дзвінка й пошти, — а
    // звіт «звідки приходять гості» показує одну колонку.
    //
    // Наповнювала цю таблицю рівно одна SQLite-міграція, і рівно для
    // `properties LIMIT 1`: список діставався demo-seed, а кожен реальний
    // готель стартував порожнім. На Postgres та міграція не виконується
    // взагалі. Місце цього — тут, де готель заводиться.
    //
    // OTA в списку немає навмисно: див. booking-sources.ts.
    for (const s of defaultBookingSources(language)) {
      await t.run(`
        INSERT INTO booking_sources (id, property_id, name, code, icon_letter, color, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [`bs_${crypto.randomBytes(8).toString('hex')}`, propertyId,
        s.name, s.code, s.iconLetter, s.color, s.sortOrder]);
    }

    // Каса готелю — У ЙОГО ВАЛЮТІ, і до створення власника: той одразу
    // отримує її як свій рахунок за замовчуванням (INC-028, ланка 2).
    //
    // Без цього рядка місток платежів шукає запасний рахунок і не знаходить
    // жодного, а `createOperationInTx` відмовляє `income requires
    // account_to_id`. Свіжозаведений готель не міг провести готівку взагалі —
    // тобто перша ж дія портьє на рецепції впиралась у порожній довідник.
    //
    // Валюта — організації, не літерал: рахунок у кронах для німецького
    // готелю місток просто не побачив би (він шукає за валютою операції), і
    // відмова повернулась би там, де її найважче звʼязати з причиною.
    await t.run(`
      INSERT INTO finance_accounts (id, organization_id, name, type, currency, sort_order)
      VALUES (?, ?, ?, 'cash', ?, 1)
    `, [cashAccountId, organizationId,
      DEFAULT_CASH_ACCOUNT_NAME[language] ?? DEFAULT_CASH_ACCOUNT_NAME.en, currency]);

    // The owner's language stays NULL: they follow the hotel, so changing the
    // hotel's base language later moves them with it.
    //
    // `default_cash_account_id` — щоб готівка, прийнята власником, лягала в
    // касу готелю, а не в «перший рахунок за sort_order»: у готелю з кількома
    // касами це різні гроші (`app/api/payments` читає саме цю колонку).
    await t.run(`
      INSERT INTO app_users (id, organization_id, email, full_name, role, password_hash, default_cash_account_id)
      VALUES (?, ?, ?, ?, 'owner', ?, ?)
    `, [ownerId, organizationId, email, input.ownerName || name,
      bcrypt.hashSync(input.ownerPassword, 10), cashAccountId]);

    // Every feature gets a row, so the state is explicit rather than absent.
    // Through `t`, not the pool: these rows reference an organization this
    // transaction has not committed yet, so on Postgres a second connection
    // would fail the foreign key. On SQLite there is only ever one connection,
    // which is why writing them outside the transaction worked by accident.
    // `enable` називає ДОКУПЛЕНЕ; модулі, які є в PMS за замовчуванням,
    // приходять із самого реєстру. Без другої половини новий клієнт
    // отримував би готель без задач, залів, аналітики й аркушів дня — і
    // виглядало б це не як «вимкнено», а як «нема такого в продукті».
    const wanted = new Set(input.enable || []);
    for (const key of Object.keys(FEATURES) as FeatureKey[]) {
      await setFeature(organizationId, key, wanted.has(key) || featureDefault(key), t);
    }

    // План рахунків і бізнес-юніти — КОЖНОМУ готелю свої (INC-025).
    //
    // Сіяв їх `db.ts` рівно один раз на всю базу:
    // `SELECT id FROM organizations LIMIT 1` — проти інваріанта 1 — і з
    // літеральними первинними ключами (`ec_accommodation`, `bu_shared`, …),
    // тож другий комплект був неможливий за означенням PK. Тут не сіялось
    // нічого. Наслідок: або статей немає ні в кого (чиста інсталяція) і
    // готівкова оплата віддає 500 першому ж готелю, або вони належать готелю
    // №1, і операції готелю №2 тихо чіпляються на ЧУЖИЙ рядок довідника —
    // ключ пропускає, політика його ховає, і проживання лягає в P&L не в той
    // рядок.
    //
    // Ідентифікатор випадковий, стала величина — `code`, унікальний у межах
    // організації. Список один на всіх (`core/chart-of-accounts.ts`): два
    // списки розійшлися б, і новий готель отримав би довідник, якого немає
    // у старих.
    // Прапорці за ТИПОМ колонки, не за виглядом (інваріант 12):
    // include_in_pnl / include_in_cash — числові (BIGINT на Postgres), тож 1/0;
    // is_capex — BOOLEAN, тож true/false. Postgres відхиляє true в число і 1 у
    // булеве, а на SQLite цього не видно взагалі.
    //
    // `op_type` і `classifier` НАЗИВАЮТЬСЯ ТУТ (Р12.1). Перша редакція їх не
    // писала — і стаття виходила такою, що існує, показується в довіднику і
    // приймає операції, а грошей по ній не видно: P&L бере
    // `COALESCE(classifier,'other')` і кладе оренду з зарплатою в «Інше»,
    // нижче EBITDA (виміряно: EBITDA свіжого готелю дорівнювала виручці), а
    // форма витрати питає `?op_type=expense` і отримує порожній список.
    // На SQLite це маскується перезапуском — міграція `db.ts` підписує осі за
    // `std_group` на наступному завантаженні, тобто ТОЙ САМИЙ готель до і
    // після рестарту рахує по-різному. На Postgres тієї міграції немає взагалі.
    for (const a of CHART_OF_ACCOUNTS) {
      await t.run(`
        INSERT INTO expense_categories (id, organization_id, code, name, std_group, pnl_line,
          op_type, classifier,
          include_in_pnl, include_in_cash, alloc_method, is_capex, icon, color, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [`ec_${crypto.randomBytes(8).toString('hex')}`, organizationId, a.code, a.name,
        a.stdGroup, a.pnlLine, a.opType, a.classifier,
        a.includeInPnl ? 1 : 0, a.includeInCash ? 1 : 0,
        a.allocMethod, a.isCapex, a.icon, a.color, a.sortOrder]);
    }
    for (const u of BUSINESS_UNITS) {
      await t.run(`
        INSERT INTO business_units (id, organization_id, code, name, unit_type, is_shared, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [`bu_${crypto.randomBytes(8).toString('hex')}`, organizationId, u.code, u.name,
        u.unitType, u.isShared, u.sortOrder]);
    }

    // Каталог зручностей тут НЕ сіється, і це не пропуск.
    //
    // Перша редакція кликала звідси `seedAmenityCatalog` через фасад
    // `@properties` — і зламала `scripts/provision-org.mjs`: той запускає цей
    // файл голим node, без резолвера аліасів, тож заведення готеля падало на
    // `Invalid module "@properties"`. Побачив це CI, не я: локально скрипт
    // ніхто не кличе, а `npm run check` імпортує з аліасами.
    //
    // Урок ширший за одну помилку: ядро не має знати про модуль навіть через
    // двері. Каталог досівається там, де він потрібен, — при першому читанні
    // екрана (`ensureAmenityCatalog`) і в `apply-hotel`, — і це той самий
    // шлях, яким його отримують готелі, заведені до 0111.
  }));

  return { organizationId, propertyId, ownerId, language, timezone, timezoneFrom, lodgingKind };
}
