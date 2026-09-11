/**
 * Одна організація, ДВА обʼєкти — спільна фікстура осі обʼєкта.
 *
 * ── Навіщо вона одна на всіх ────────────────────────────────────────────
 *
 * Кожна фікстура в проєкті мала один обʼєкт. Наскрізний прохід, який знайшов
 * зашиту CZK, брав дві ОРГАНІЗАЦІЇ, а не два обʼєкти в одній, — тобто був
 * вироджений рівно по тій осі, про яку INC-029. Вада не ховалась: її нікому
 * було побачити. Це інваріант 26 у чистому вигляді: твердження зелене і з
 * віссю, і без неї.
 *
 * Тому фікстура спільна і лежить у ядрі. Три сесії ведуть блок паралельно; три
 * власні фікстури розійшлися б числами, і «очікували 5, отримали 12» в одній
 * означало б не те саме, що в другій.
 *
 * ── Чому саме ці числа ──────────────────────────────────────────────────
 *
 * 5 і 7, не 2 і 2. Друга половина інваріанта 26 — очікуване число мусить бути
 * АРИФМЕТИЧНО НЕСУМІСНЕ з альтернативним прочитанням, а 2 і 2 сумісні з чим
 * завгодно: 2 = «мій обʼєкт», 2 = «половина від чотирьох», 4 = «обидва», і
 * жодне з них не розрізняється. З 5 і 7 читач, який забув вісь, віддає 12 —
 * число, яким не є ЖОДЕН обʼєкт, і повідомлення «очікували 5 номерів обʼєкта
 * А, отримали 12» називає ваду замість того, щоб натякати на неї.
 *
 * Те саме зроблено на кожній осі, яку фікстура несе, — типи (2 проти 1), ціни
 * (1000/1200 проти 3300), броні (2 проти 3), курортний збір (20 проти 35).
 * Скрізь різні числа й скрізь сума ≠ жодного доданка.
 *
 * ── Як користуватись ────────────────────────────────────────────────────
 *
 * З `.check.ts`, після того як піднято тимчасову базу (зразок —
 * `src/modules/properties/data/availability.check.ts`):
 *
 *   const fx = await seedTwoProperties();
 *   const rows = await listUnits(fx.organizationId, oneProperty(fx.a.id));
 *   assert.strictEqual(rows.length, fx.a.unitIds.length,
 *     `очікували ${fx.a.unitIds.length} номерів обʼєкта А, отримали ${rows.length}`);
 *
 * Ідентифікатори фіксовані й позначені префіксом `__two_props__`: фікстура
 * розрахована на порожню базу свого `.check.ts`, а не на підмішування в чужу.
 */
import { getSql } from '../db/async.ts';
import { runWithOrganization } from '../auth/tenant-context';

/** Один обʼєкт фікстури — усе, що на ньому висить. */
export interface FixtureProperty {
  id: string;
  name: string;
  categoryId: string;
  /** Типи номерів ЦЬОГО обʼєкта. У А їх два, у Б один — вісь має два значення. */
  unitTypeIds: string[];
  /** Номери ЦЬОГО обʼєкта: 5 в А, 7 в Б. */
  unitIds: string[];
  /** Надбавка за додаткову особу на першому типі — своя на кожному обʼєкті. */
  extraPersonCharge: number;
  /** Курортний збір за дорослого за ніч — теж свій. */
  cityTaxPerNight: number;
  /** Сума кожної броні цього обʼєкта. Чужа сума тут — видима вада. */
  stayTotal: number;
  /** Броні ЦЬОГО обʼєкта: 2 в А, 3 в Б. */
  reservationIds: string[];
  /** День заїзду кожної броні, `YYYY-MM-DD`, у порядку `reservationIds`. */
  checkIns: string[];
  /** День виїзду кожної броні, у тому ж порядку. */
  checkOuts: string[];
}

export interface TwoProperties {
  organizationId: string;
  /** 5 номерів, 2 типи, 2 броні. */
  a: FixtureProperty;
  /** 7 номерів, 1 тип, 3 броні. */
  b: FixtureProperty;
  /** 12 — і це не 5 і не 7. Читач, який забув вісь, віддасть саме його. */
  totalUnits: number;
  /** 5 — і це не 2 і не 3. */
  totalReservations: number;
  /**
   * Місяць, у якому лежать УСІ броні фікстури, `YYYY-MM`.
   *
   * Він відносний до дня запуску (див. `MONTHS_AHEAD`), тож сцена, якій
   * потрібен діапазон, бере його ЗВІДСИ, а не пише вересень 2026 руками.
   * Саме літерали й були бомбою: вони не старіють, старіє календар.
   */
  month: string;
  /** Перший день `month` — нижня межа діапазону звітів і експортів. */
  from: string;
  /** Останній день `month` — верхня межа. */
  to: string;
  /**
   * Місяць, у якому фікстура НЕ має жодної броні, `YYYY-MM` — наступний після
   * `month`.
   *
   * Для сцен, яким потрібне ЦІЛЕ вікно зі своїми числами: наявність,
   * календар сайту, шахматка. Вони сіють власні броні на кілька тижнів і
   * рахують зайняті дати точно, тож будь-який рядок фікстури в тому ж вікні
   * робить їхнє число іншим.
   *
   * Раніше такі сцени писали «листопад» руками з приміткою «навмисно не
   * перетинається з вереснем фікстури». Примітка була правдою рівно доти,
   * доки вересень був літералом: щойно місяць фікстури став відносним, він
   * став листопадом, і перетин, якого «навмисно немає», зʼявився. Тепер
   * непересічність не обіцяна коментарем, а обчислена.
   */
  quietMonth: string;
  /** Перший день `quietMonth`. */
  quietFrom: string;
  /** Останній день `quietMonth`. */
  quietTo: string;
  /**
   * Доба ТИХОГО місяця, у яку фікстура НЕ має жодної броні.
   *
   * Для сцен, які будують ВЛАСНИЙ день (аркуші доби, доба готелю, прибирання):
   * їм потрібні свої числа — «у домі двоє, заїжджає один», — а кожна зайва
   * бронь фікстури зробила б їх іншими.
   *
   * Саме таке зіткнення й сталось при переїзді на відносні дати:
   * `day-sheets.scope` тримався за літерал `2026-11-10`, і рівно того дня, коли
   * місяць фікстури став листопадом, у «домі» обʼєкта А опинилось троє замість
   * двох. Тобто той самий клас, лише з іншого боку — і саме тому доба тепер
   * ПИТАЄТЬСЯ у фікстури, а не вгадується.
   */
  freeDay: string;
}

const ORG = '__two_props__org';

/**
 * На скільки місяців уперед лежать броні фікстури.
 *
 * Не «щоб було з запасом»: два місяці — це більше за будь-яке вікно, яким
 * оперують читачі, що дивляться НА СЬОГОДНІ. Тривоги беруть тиждень назад,
 * доба готелю — добу, наявність і шахматка — місяць від поточного дня. Бронь
 * за два місяці не потрапляє в жодне з них, тож фікстура не додає рядків у
 * твердження, які їх не чекають, — а саме це й сталося 11.09.2026.
 *
 * Менший зсув повернув би ту саму ваду в іншій формі: місяць уперед — і
 * шахматка на 30 днів починає бачити фікстурні броні краєм.
 */
const MONTHS_AHEAD = 2;

/** Заїзд першої броні обʼєкта А — десяте число, щоб усі 5 броней і виїзди
 *  (до +8 днів) гарантовано лишались У ТОМУ САМОМУ місяці: звіти й експорти
 *  питають діапазон МІСЯЦЯ, і бронь, що перелізла через межу, зробила б їхні
 *  числа залежними від того, коли запустили перевірку. */
const FIRST_DAY = 10;

/** Десяте число ТИХОГО місяця — див. `TwoProperties.freeDay`. Десяте, а не
 *  перше: сцені, яка будує свій день, потрібні й сусідні доби з обох боків
 *  («заїхав позавчора», «виїжджає післязавтра»), і жодна з них не має
 *  перелізти в попередній місяць. */
const FREE_DAY = 10;

/** Місяць фікстури, `YYYY-MM`, відносно дня запуску. */
function fixtureMonth(today: string, ahead: number = MONTHS_AHEAD): string {
  const [year, month] = today.split('-').map(Number);
  const shifted = month + ahead;
  return `${year + Math.floor((shifted - 1) / 12)}-${String(((shifted - 1) % 12) + 1).padStart(2, '0')}`;
}

/** Останній день місяця `YYYY-MM` — для верхньої межі діапазону звітів. */
function lastDayOf(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}

/** День номер `n` місяця фікстури, `YYYY-MM-DD`. */
const dayOf = (month: string, n: number) => `${month}-${String(n).padStart(2, '0')}`;

/** Зсув першої броні обʼєкта Б від першої броні обʼєкта А, у днях. Броні А
 *  йдуть підряд від `FIRST_DAY`, броні Б — від `FIRST_DAY + B_OFFSET`, щоб
 *  обʼєкти не ділили доби: інакше «у домі» одного обʼєкта залежало б від
 *  броней другого. */
const B_OFFSET = 5;

/**
 * Дата заїзду броні `i` обʼєкта `key`, якщо фікстуру сіють у день `today`.
 *
 * Функція ЧИСТА і бере день параметром — саме тому властивість «дати завжди
 * попереду дня засіву» можна перевірити на чотириста днів уперед, не чіпаючи
 * годинника (`two-properties.check.ts`). Засів кличе її ж: другий примірник
 * цієї арифметики розійшовся б із першим, і перевірка стверджувала б про
 * копію, а не про фікстуру.
 */
export function fixtureCheckIn(today: string, key: 'a' | 'b', i: number): string {
  return dayOf(fixtureMonth(today), FIRST_DAY + i + (key === 'b' ? B_OFFSET : 0));
}

/**
 * Форма одного обʼєкта до засіву — числа зібрані в одному місці, щоб їх було видно.
 *
 * Цінових ТАБЛИЦЬ (`price_calendar`, `price_occupancy`, `price_los_tiers`) тут
 * немає навмисно: інваріант 16 каже, що їх питає лише `modules/pricing`, і
 * фікстура в ядрі не має права заводити другого джерела ціни навіть на
 * тимчасовій базі (`check-price-source --strict`). Грошова вісь тому взята
 * колонками, які цінові таблиці не заміняють і живуть там, де їм належить:
 * `unit_types.extra_person_charge` (надбавка типу) і `reservations.total_price`
 * (сума броні). Перевірці, якій потрібні саме нічні ціни, їх досіває СВІЙ
 * модуль через `@pricing` — поверх цієї фікстури, а не всередині неї.
 */
const PLAN = [
  {
    key: 'a',
    id: '__two_props__prop_a',
    name: 'Property A',
    /** Два типи, і номери між ними розкладені нерівно: 3 + 2, не 2 + 3 і не 2 + 2. */
    types: [{ code: 'A1', units: 3, extraPersonCharge: 300 }, { code: 'A2', units: 2, extraPersonCharge: 450 }],
    cityTaxPerNight: 20,
    stayTotal: 1000,
    reservations: 2,
  },
  {
    key: 'b',
    id: '__two_props__prop_b',
    name: 'Property B',
    types: [{ code: 'B1', units: 7, extraPersonCharge: 900 }],
    cityTaxPerNight: 35,
    stayTotal: 3300,
    reservations: 3,
  },
] as const;

/**
 * Засіяти фікстуру в базу, яку підняв виклик.
 *
 * Пише прямо SQL, а не через репозиторії: репозиторій — це те, що перевіряють
 * нею, і засів через нього доводив би сам себе. `organization_id` названо
 * явно всюди, де колонка є (інваріант 12), валюту — теж (підзапитом від
 * організації), бо фікстура, яка сама порушує інваріанти, вчить їх обходити.
 */

/**
 * Прибрати за собою ПЕРЕД засівом.
 *
 * На SQLite кожна сцена бере свою тимчасову теку, тож питання не стоїть. На
 * Postgres база одна на всі сцени `check:pg`, і друга сцена падала б на
 * `duplicate key value violates unique constraint "organizations_pkey"` —
 * саме це й сталося при першому прогоні всіх 29 сцен під `alisio_app`.
 *
 * Чому цикл, а не список у правильному порядку: між таблицями орендаря є свої
 * звʼязки (`reservation_line_items` → `reservation_sub_bookings` → …), і
 * порядок, виписаний рукою, розійдеться з наступною міграцією мовчки. Цикл
 * питає базу, що саме зараз не дає видалити, і повторює, доки просувається.
 * Коли просування нема — лишились таблиці без `organization_id`, і їх знімає
 * каскад від `properties`.
 *
 * `TRUNCATE` тут не можна свідомо: `.claude/hooks/guard.sh` його блокує, і
 * правильно — незворотна зміна бази повз журнал міграцій.
 */
async function forgetFixtureTenant(sql: ReturnType<typeof getSql>, org: string): Promise<void> {
  const tables = (await sql.rows<{ name: string }>(sql.dialect.tables()))
    .map((t) => String(t.name))
    .filter((t) => t !== 'organizations' && t !== 'properties' && t !== 'schema_migrations');

  let left = tables;
  for (let pass = 0; pass < 6 && left.length; pass++) {
    const stuck: string[] = [];
    for (const table of left) {
      try {
        await sql.run(`DELETE FROM ${table} WHERE organization_id = ?`, [org]);
      } catch {
        // Або колонки немає, або на рядок ще хтось посилається. Перше зникне
        // само (таблиця випаде зі списку наступним проходом лише якщо вдалось),
        // друге — після того, як приберуть посилача.
        stuck.push(table);
      }
    }
    if (stuck.length === left.length) break;
    left = stuck;
  }

  await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
}

/** Обидва орендарі фікстури — і поза контекстом лишається тільки сам рахунок. */
async function forgetFixture(sql: ReturnType<typeof getSql>): Promise<void> {
  for (const org of [ORG, '__two_props__neighbour']) {
    await runWithOrganization(org, () => forgetFixtureTenant(sql, org));
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

export async function seedTwoProperties(
  alsoSeed?: (fx: TwoProperties) => Promise<void>,
): Promise<TwoProperties> {
  const sql = getSql();

  await forgetFixture(sql);

  // `organizations` — єдина таблиця без RLS: створення рахунку за означенням
  // відбувається поза орендарем (AGENTS §7). Усе інше — вже під контекстом.
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'Two Properties', ORG]);

  const fixture = await runWithOrganization(ORG, () => seedInsideTenant(sql, alsoSeed));

  return fixture;
}

/**
 * Тіло засіву — виконується ЛИШЕ під `runWithOrganization`.
 *
 * До 10.09.2026 воно стояло просто в `seedTwoProperties`, і на SQLite це
 * працювало: політик там немає. На Postgres під роллю `alisio_app` (без
 * суперправ) кожен `INSERT` відхилявся політикою —
 * `new row violates row-level security policy for table "guests"` — і сім
 * сцен, які цю фікстуру беруть, не входили в `check:pg` ВЗАГАЛІ.
 *
 * Тобто фікстура вчила писати повз контекст, і сцени так і писали. Сама
 * обгортка цього не забороняє — заборона в тому, що ці сцени тепер бігають
 * під `alisio_app`, де RLS відмовляє негайно.
 */
async function seedInsideTenant(
  sql: ReturnType<typeof getSql>,
  alsoSeed?: (fx: TwoProperties) => Promise<void>,
): Promise<TwoProperties> {
  await sql.run(
    'INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)',
    ['__two_props__guest', ORG, 'Scope', 'Guest'],
  );

  const seeded: Record<string, FixtureProperty> = {};
  // Один раз на весь засів: обчислити двічі означало б ризик розійтись на
  // опівнічному прогоні, і половина броней лягла б в інший місяць.
  const month = fixtureMonth(new Date().toISOString().slice(0, 10));
  // Тихий місяць — наступний за місяцем фікстури, тією ж арифметикою.
  const quietMonth = fixtureMonth(dayOf(month, 1), 1);

  for (const plan of PLAN) {
    await sql.run(
      'INSERT INTO properties (id, organization_id, name, slug, city_tax_per_night) VALUES (?, ?, ?, ?, ?)',
      [plan.id, ORG, plan.name, plan.id, plan.cityTaxPerNight],
    );

    const categoryId = `${plan.id}_cat`;
    await sql.run(
      'INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)',
      [categoryId, plan.id, `${plan.name} rooms`, 'room'],
    );

    const unitTypeIds: string[] = [];
    const unitIds: string[] = [];

    for (const type of plan.types) {
      const typeId = `${plan.id}_type_${type.code}`;
      unitTypeIds.push(typeId);
      // Надбавка за особу — ЦЬОГО типу цього обʼєкта. Читач без осі обʼєкта
      // віддасть сусідову, і це та сама помилка, що зайвий номер у списку,
      // лише дорожча: число їде в котирування.
      await sql.run(
        `INSERT INTO unit_types (id, property_id, category_id, name, code, bookable_online, extra_person_charge)
         VALUES (?, ?, ?, ?, ?, TRUE, ?)`,
        [typeId, plan.id, categoryId, type.code, type.code, type.extraPersonCharge],
      );

      for (let i = 1; i <= type.units; i++) {
        const unitId = `${typeId}_u${i}`;
        unitIds.push(unitId);
        await sql.run(
          `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [unitId, plan.id, typeId, categoryId, `${type.code}-${i}`, `${type.code}-${i}`, i],
        );
      }
    }

    const reservationIds: string[] = [];
    const checkIns: string[] = [];
    const checkOuts: string[] = [];
    for (let i = 0; i < plan.reservations; i++) {
      const id = `${plan.id}_res_${i + 1}`;
      reservationIds.push(id);
      // Дати рознесені по обʼєктах, щоб «усі броні на цю ніч» теж давало
      // різні числа, а не одне спільне.
      const day = FIRST_DAY + i + (plan.key === 'b' ? B_OFFSET : 0);
      checkIns.push(dayOf(month, day));
      checkOuts.push(dayOf(month, day + 1));
      await sql.run(
        `INSERT INTO reservations (id, organization_id, property_id, unit_id, unit_type_id, guest_id,
                                   check_in, check_out, nights, adults, total_price, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT default_currency FROM organizations WHERE id = ?))`,
        [id, ORG, plan.id, unitIds[i], unitTypeIds[0], '__two_props__guest',
          dayOf(month, day), dayOf(month, day + 1), 1, 2, plan.stayTotal, ORG],
      );
    }

    seeded[plan.key] = {
      id: plan.id,
      name: plan.name,
      categoryId,
      unitTypeIds,
      unitIds,
      extraPersonCharge: plan.types[0].extraPersonCharge,
      cityTaxPerNight: plan.cityTaxPerNight,
      stayTotal: plan.stayTotal,
      reservationIds,
      checkIns,
      checkOuts,
    };
  }

  const fixture: TwoProperties = {
    organizationId: ORG,
    a: seeded.a,
    b: seeded.b,
    totalUnits: seeded.a.unitIds.length + seeded.b.unitIds.length,
    totalReservations: seeded.a.reservationIds.length + seeded.b.reservationIds.length,
    month,
    from: dayOf(month, 1),
    to: lastDayOf(month),
    quietMonth,
    quietFrom: dayOf(quietMonth, 1),
    quietTo: lastDayOf(quietMonth),
    freeDay: dayOf(quietMonth, FREE_DAY),
  };

  assertNotDegenerate(fixture);
  assertStaysAreFuture(fixture, new Date().toISOString().slice(0, 10));
  assertQuietMonthIsQuiet(fixture);
  // Рядки сцени сіються ТУТ — усередині того самого контексту. Інакше сцена
  // мусила б памʼятати про `runWithOrganization` сама, а те, що доводиться
  // памʼятати, рано чи пізно забувають.
  if (alsoSeed) await alsoSeed(fixture);
  return fixture;
}

/**
 * Дати фікстури мусять лежати в МАЙБУТНЬОМУ, і це відмова на місці засіву.
 *
 * Правило заведене 11.09.2026, коли календар дійшов до літералів. Фікстура
 * сіяла броні датами `2026-09-10…17` без явного статусу, тобто `confirmed`;
 * 11.09 бронь обʼєкта А на 10.09 стала ПРОСТРОЧЕНИМ ЗАЇЗДОМ, і
 * `alerts.scope.check` дістав 2 там, де стверджує 1. Сцена мала рацію:
 * підтверджена бронь із минулою датою заїзду СПРАВДІ є простроченим заїздом.
 * Брехала фікстура.
 *
 * Найгірше в цьому — не сам збій, а те, що він самоусувається: приблизно
 * через два тижні рядки випали б із тижневого вікна тривог, сцена позеленіла
 * б сама, і бомба перезарядилась би до наступного разу. Червоне, що
 * зеленіє від календаря, — це не полагоджене, це відкладене.
 *
 * Тому дата тут не пишеться літералом ніде, а ця відмова стереже саме
 * ВЛАСТИВІСТЬ («жодна бронь фікстури не в минулому»), а не форму запису:
 * літерал майбутнього року пройшов би повз перевірку візерунка і став би
 * тією самою бомбою з довшим ґнотом (§3.2.1).
 */
/**
 * Тихий місяць мусить бути СПРАВДІ тихим — і це теж відмова, а не обіцянка.
 *
 * Раніше непересічність жила в коментарі сцени: «вікно запиту (листопад)
 * навмисно не перетинається з бронями фікстури (вересень)». Коментар був
 * правдою рівно доти, доки обидва місяці були літералами. Щойно місяць
 * фікстури став відносним, він САМ став листопадом — і «навмисно немає»
 * перетворилось на три червоні твердження про зайняті дати.
 *
 * Тому тепер перевіряється властивість: жодна бронь фікстури не торкається
 * жодного дня тихого місяця. Не «місяці різні» (це візерунок — бронь через
 * межу місяця його пройшла б), а саме перекриття відрізків: бронь
 * `checkIn…checkOut` і відрізок `quietFrom…quietTo`.
 */
export function assertQuietMonthIsQuiet(fx: TwoProperties): void {
  const stays = [
    ...fx.a.checkIns.map((from, i) => [from, fx.a.checkOuts[i]] as const),
    ...fx.b.checkIns.map((from, i) => [from, fx.b.checkOuts[i]] as const),
  ];
  const overlapping = stays.filter(([from, to]) => from <= fx.quietTo && to >= fx.quietFrom);
  if (overlapping.length > 0) {
    throw new Error(
      `two-properties: ${overlapping.length} броней фікстури заходять у тихий місяць `
      + `${fx.quietMonth} (${overlapping.map(([f, t]) => `${f}…${t}`).join(', ')}). `
      + 'Сцена, яка рахує зайняті дати у своєму вікні, дістане зайві — і її числа перестануть означати те, що написано.',
    );
  }
}

export function assertStaysAreFuture(fx: TwoProperties, today: string): void {
  const past = [...fx.a.checkIns, ...fx.b.checkIns].filter((d) => d <= today);
  if (past.length > 0) {
    throw new Error(
      `two-properties: ${past.length} броней фікстури заїжджають не пізніше за сьогодні (${past.join(', ')}; сьогодні ${today}). `
      + 'Підтверджена бронь із минулою датою заїзду — це прострочений заїзд, '
      + 'і кожне твердження про тривоги, доба готелю і наявність починає рахувати її теж.',
    );
  }
}

/**
 * Фікстура, зведена до одного значення осі, доводить нуль — і робить це
 * мовчки, зеленим кольором. Тому не рецензія, а відмова на місці засіву:
 * той, хто «підрівняє» 5 і 7 до 5 і 5, побачить це в ту ж секунду, а не
 * через місяць у вигляді втраченого твердження.
 */
export function assertNotDegenerate(fx: TwoProperties): void {
  const pairs: [string, number, number][] = [
    ['номерів', fx.a.unitIds.length, fx.b.unitIds.length],
    ['типів', fx.a.unitTypeIds.length, fx.b.unitTypeIds.length],
    ['надбавки за особу', fx.a.extraPersonCharge, fx.b.extraPersonCharge],
    ['суми броні', fx.a.stayTotal, fx.b.stayTotal],
    ['курортного збору', fx.a.cityTaxPerNight, fx.b.cityTaxPerNight],
    ['броней', fx.a.reservationIds.length, fx.b.reservationIds.length],
  ];
  for (const [what, left, right] of pairs) {
    if (left === right) {
      throw new Error(
        `two-properties: вісь обʼєкта вироджена по «${what}» — в обох ${left}. `
        + 'Твердження на такій фікстурі зелене і з віссю, і без неї (інваріант 26).',
      );
    }
  }
  const sum = fx.a.unitIds.length + fx.b.unitIds.length;
  if (sum === fx.a.unitIds.length || sum === fx.b.unitIds.length) {
    throw new Error('two-properties: сума номерів збігається з одним із обʼєктів — «забув вісь» не відрізнити від «врахував».');
  }
}

/**
 * Сусідня організація з ОДНИМ обʼєктом і 4 номерами.
 *
 * Вісь обʼєкта не заміняє осі орендаря, і твердження про першу без другої
 * порожнє: «читач віддав 5 номерів обʼєкта А» зелене й на коді, який просто
 * не бачить нікого, крім А. Тому кожна перевірка читача сіє ще й сусіда і
 * доводить обидва боки — свій бачить своє, чужий не бачить нічого.
 *
 * 4 номери, бо це не 5, не 7 і не 12: якщо сусід протече, жодна сума не
 * збіжиться з очікуваною (5+4=9, 7+4=11, 12+4=16).
 *
 * Окремою функцією, а не всередині `seedTwoProperties`: більшість тверджень
 * потребує лише осі обʼєкта, і зайвий орендар у базі робив би кожне число
 * трохи іншим без причини.
 */
export interface NeighbourOrganization {
  organizationId: string;
  propertyId: string;
  unitTypeId: string;
  unitIds: string[];
}

export async function seedNeighbourOrganization(
  alsoSeed?: (n: NeighbourOrganization) => Promise<void>,
): Promise<NeighbourOrganization> {
  const sql = getSql();
  const org = '__two_props__neighbour';

  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, 'Neighbour', org]);
  return runWithOrganization(org, () => seedNeighbourInsideTenant(sql, org, alsoSeed));
}

async function seedNeighbourInsideTenant(
  sql: ReturnType<typeof getSql>,
  org: string,
  alsoSeed?: (n: NeighbourOrganization) => Promise<void>,
): Promise<NeighbourOrganization> {
  const property = `${org}_prop`;
  const category = `${org}_cat`;
  const unitType = `${org}_type`;

  await sql.run(
    'INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
    [property, org, 'Neighbour', property],
  );
  await sql.run(
    'INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)',
    [category, property, 'Neighbour rooms', 'room'],
  );
  await sql.run(
    `INSERT INTO unit_types (id, property_id, category_id, name, code, bookable_online)
     VALUES (?, ?, ?, ?, ?, TRUE)`,
    [unitType, property, category, 'N1', 'N1'],
  );

  const unitIds: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const id = `${unitType}_u${i}`;
    unitIds.push(id);
    await sql.run(
      `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, property, unitType, category, `N1-${i}`, `N1-${i}`, i],
    );
  }

  const neighbour = { organizationId: org, propertyId: property, unitTypeId: unitType, unitIds };
  if (alsoSeed) await alsoSeed(neighbour);
  return neighbour;
}
