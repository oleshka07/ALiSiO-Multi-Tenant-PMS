/**
 * Модуль, вимкнений у налаштуваннях, вимкнений і в меню, і в маршруті.
 *
 *   node src/core/features.check.ts
 *
 * ── Що тут ловиться ─────────────────────────────────────────────────────
 *
 * Реєстр фіч має три сторони, і вони вміють розходитись мовчки:
 *
 *   1. `FEATURE_SPEC` — що взагалі вмикається;
 *   2. `core/navigation.ts` — що зникає з меню, пошуку і за що заслінка
 *      `ModuleGate` закриває екран (усі три читають цей каталог);
 *   3. маршрути — що перестає відповідати.
 *
 * Розходження між (1) і (2) дає пункт меню, який неможливо прибрати. Між (2)
 * і (3) — гірше: модуль зникає з меню, але `/api/tasks` відповідає далі, тобто
 * «вимкнено» означає «сховано від того, хто не знає адреси». Це не теорія: до
 * `withModule` рівно так і було з усіма пʼятьма модулями.
 *
 * ── І чому дефолти — теж перевірка ──────────────────────────────────────
 *
 * `hasFeature` без рядка в базі повертає дефолт. Для інтеграції дефолт `ON`
 * означав би, що новий клієнт мовчки отримав німецьку фіскалізацію — тобто
 * PMS стала б незареєстрованою касою (docs/TSE-KASSENSICHV.md §6.4). Для
 * модуля дефолт `OFF` без міграції означав би, що в день додавання ключа
 * кожен наявний готель втратив би розділ меню. Обидві помилки тихі, тому
 * перелічені поіменно.
 *
 * ── Ключ без варти — червона збірка (Блок 0, П15) ───────────────────────
 *
 * Прапорець, який нічого не стереже, — перемикач-обманка в налаштуваннях:
 * клієнт його бачить, тисне, нічого не відбувається. Саме тому `site_builder`
 * не заводили наперед (П5), і саме тому кожен ключ модуля тут мусить назвати
 * файли, у яких стоїть його варта, — інакше збірка червона. Інтеграції
 * названі окремо, з місцем їхньої варти.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { FEATURE_SPEC, FEATURES, featureDefault } from './features.ts';

type Key = keyof typeof FEATURE_SPEC;

// ── Дефолти названі поіменно ────────────────────────────────────────────
//
// Список тут, а не виведений із FEATURE_SPEC: інакше перевірка звірялася б
// сама з собою і пропустила б будь-яку зміну.
const EXPECTED_DEFAULT: Record<Key, boolean> = {
  // Прямі броні даємо, конструктор сайту продаємо — розкол `widget`
  // 31.08.2026, обґрунтування в core/features.ts.
  booking_engine: true,
  fiscal_de: false,
  online_payments: false,
  // OFF (10.09.2026): вмикає лише готель, який переїжджає з Winhotel; поки
  // вимкнено, приймальний маршрут знімка відповідає 404.
  winhotel_import: false,
  // OFF (10.09.2026): платний застосунок — термінал у холі. Дефолт ON тут
  // означав би, що кожен готель на сервері має маршрут, який приймає код
  // парування; OFF робить його 400-кою для всіх, крім тих, хто термінал
  // справді купив.
  kiosk: false,
  // OFF (12.09.2026): за цим ключем стоїть ПУБЛІЧНА сторінка, з якої видно
  // назву готелю, його вільні номери й ціни. Дефолт ON відчинив би її
  // кожному готелю на сервері — включно з тими, хто про неї не просив.
  guest_app: false,
  // OFF від 05.09.2026 (П15): платний модуль. Наявні готелі мають явний
  // рядок enabled = TRUE, поставлений міграцією 0065.
  tasks: false,
  // OFF від 31.08.2026: зали — зайвий розділ для обʼєкта на 5 номерів.
  // Наявні готелі мають явний рядок enabled = 1, поставлений міграцією.
  events: false,
  // OFF від 05.09.2026 (П15): платний модуль; рядки — 0065.
  reports: false,
  dashboard: true,
  // OFF від 05.09.2026 (П15): платний модуль; рядки — 0065.
  day_sheets: false,
  // ON: готель, який здає номери, виписує документ — питання лише, чиїм
  // бланком. Дефолт OFF означав би, що в день появи ключа кожен наявний
  // клієнт мовчки втратив фактури, а новий не зміг би закрити перший заїзд.
  invoicing: true,
  // OFF: облік — не частина PMS, а фінансова система на 78 файлів, яку
  // більшість готелів веде у програмі свого бухгалтера. Наявні готелі його не
  // втрачають — міграція 0045 вписує їм явний рядок; саме тому дефолт можна
  // зробити чесним.
  accounting: false,
  // OFF, і саме за це береться плата: прямі броні даємо (вони не коштують
  // нам нічого і виграють клієнта), за доступ до ЧУЖОГО трафіку беремо —
  // рішення власника, записане в коментарі до `booking_engine`.
  //
  // Наявні готелі нічого не втрачають: сьогодні жоден із них каналів не має,
  // бо модуль щойно зʼявився. Тобто це той рідкісний випадок, коли дефолт
  // можна поставити чесним без міграції, яка вписує явні рядки.
  channels: false,
  // Новий ключ 05.09.2026 (П15), OFF, платно: гостьова сторінка,
  // самореєстрація, послуги гостя. Наявні готелі — рядок 0065.
  guest_page: false,
  // Новий ключ 05.09.2026 (П15), OFF, платно: сайти-вітрини (`/app/sites`
  // і їхнє керування). Форма бронювання лишається в `booking_engine`.
  sites: false,
};

for (const key of Object.keys(FEATURE_SPEC) as Key[]) {
  assert.ok(key in EXPECTED_DEFAULT,
    `новий ключ «${key}» без рішення про дефолт — впишіть його в features.check.ts і подумайте, ON це чи OFF`);
  assert.strictEqual(featureDefault(key), EXPECTED_DEFAULT[key],
    `дефолт «${key}» змінився на ${featureDefault(key)}. Якщо навмисно — тут теж; якщо ні, це або незареєстрована каса, або зниклий розділ меню`);
}
for (const key of Object.keys(EXPECTED_DEFAULT)) {
  assert.ok(key in FEATURE_SPEC, `«${key}» є в очікуваннях, але зник із реєстру`);
}
console.log(`  ok  дефолти ${Object.keys(FEATURE_SPEC).length} ключів — такі, як вирішено`);

// ── Каталог для екрана не втратив жодного ключа ─────────────────────────
assert.deepStrictEqual(Object.keys(FEATURES).sort(), Object.keys(FEATURE_SPEC).sort(),
  'FEATURES і FEATURE_SPEC розійшлись — екран налаштувань покаже не ті перемикачі');
for (const [key, label] of Object.entries(FEATURES)) {
  assert.ok(typeof label === 'string' && label.length > 2,
    `«${key}» без людської назви — на екрані буде порожній рядок з перемикачем`);
}
console.log('  ok  каталог для екрана збігається з реєстром');

// ── Інтеграції: варта живе не в маршрутах модуля, а там, де названо ─────
//
// Це не виняток із правила «ключ без варти — червона збірка», а той самий
// принцип з іншою адресою: у кожного названо файл, де прапорець питається.
const INTEGRATIONS: Partial<Record<Key, string>> = {
  booking_engine: 'src/modules/widget/api/widget-site.handlers.ts',
  fiscal_de: 'src/modules/invoicing/data/folio-payments.repo.ts',
  // Вимикач шлюзів живе в реєстрі застосунків (Блок «Застосунки», 09.09.2026):
  // `INTEGRATION_FEATURE` тепер виводиться з `apps.ts`, і саме там кожен шлюз
  // називає `online_payments`; збереження ключа питає цю мапу.
  online_payments: 'src/core/apps.ts',
  channels: 'src/modules/channels/api/pull-cron.handlers.ts',
  // Приймання знімка — публічний маршрут за токеном агента: сесії немає, тож
  // варта ключа стоїть у хендлері (`hasFeature`, 404 на вимкненому), а не в
  // `withModule`.
  winhotel_import: 'src/apps/winhotel-import/api/snapshots.handlers.ts',
  // Кіоск — те саме, і з тієї самої причини: біля термінала немає людини з
  // сесією, тож `withModule` не підходить. Варта стоїть у дверях пристрою
  // (`requireDevice` → `hasFeature`, 404 на вимкненому) — тобто в ОДНОМУ
  // місці на всі маршрути кіоска, а не в кожному. Парування питає той самий
  // ключ окремо (`pairing.handlers.ts`), бо туди приходять ще без токена.
  kiosk: 'src/apps/kiosk/api/session.handlers.ts',
  // Гостьовий застосунок — те саме, і варта теж в ОДНОМУ місці: через
  // `propertyByAppKey` проходять і сторінка, і всі пʼять публічних
  // маршрутів, іншого шляху до орендаря в них немає.
  guest_app: 'src/apps/guest-app/data/property.repo.ts',
};
for (const [key, file] of Object.entries(INTEGRATIONS)) {
  assert.ok(fs.existsSync(file!), `інтеграція «${key}»: файл варти ${file} зник`);
  assert.ok(new RegExp(`['"]${key}['"]`).test(fs.readFileSync(file!, 'utf8')),
    `інтеграція «${key}»: ${file} більше не називає ключ — прапорець нічого не стереже`);
}

// ── Модулі: меню/заслінка і маршрут читають той самий ключ ─────────────
//
// `day_sheets` у каталозі пишеться так само, як у реєстрі — підкресленням.
// Дефіс у ключі («day-sheets») дав би пункт, який ніколи не ховається:
// `features` такого ключа не має, і `!features[undefined]` — це просто `true`.
//
// Каталог — `core/navigation.ts`: з нього читають меню, пошук Ctrl+K і
// заслінка `ModuleGate`. Ключ, якого там немає, — це екран, який відкриється
// у вимкненому модулі з закладки.
const MODULES = (Object.keys(FEATURE_SPEC) as Key[]).filter((k) => !(k in INTEGRATIONS));

const catalog = fs.readFileSync('src/core/navigation.ts', 'utf8');
for (const key of MODULES) {
  assert.ok(catalog.includes(`feature: '${key}'`),
    `модуль «${key}» вмикається в налаштуваннях, але жоден екран каталогу core/navigation.ts не питає фічу — вимкнути його неможливо`);
}

// Інші списки з ключами модулів — верхнє меню й хаб звітів (Блок 0.6 B6):
// ключ, якого немає в реєстрі, там ніколи не ховає пункт (`!features[x]` на
// невідомому ключі — завжди true), а ключ, якого немає в каталозі
// navigation.ts, — екран без заслінки. Обидва списки читаються тут, щоб
// третій список не жив поза гейтом.
for (const file of ['src/components/layout/nav-items.ts', 'src/app/app/(dashboard)/reports/page.tsx']) {
  const src = fs.readFileSync(file, 'utf8');
  for (const [, key] of src.matchAll(/feature: '([a-z_]+)'/g)) {
    assert.ok(key in FEATURE_SPEC, `${file}: ключ «${key}» не існує в реєстрі — пункт ніколи не сховається`);
    assert.ok(catalog.includes(`feature: '${key}'`), `${file}: ключ «${key}» є в меню, але не в каталозі core/navigation.ts — екран без заслінки`);
  }
}
console.log(`  ok  ${MODULES.length} модулів ховаються з меню і закриваються заслінкою`);

// ── Маршрути справді відмовляють ────────────────────────────────────────
//
// Файл, що ВОЛОДІЄ вартою: або сам маршрут, або хендлер, у який він
// делегує. Перевірка на текст `withModule('<ключ>'` — вона не доводить, що
// варта правильна, але доводить, що фіча взагалі питається; до цього не
// питалась ніде. Там, де сесії немає (гостьовий портал за токеном) або
// обгортка своя (`withOwnedSite`), варта — `hasFeature(…, '<ключ>')` з
// відмовою; форма інша, питання те саме.
const OWNERS: Record<Key, string[]> = {
  booking_engine: [], fiscal_de: [], online_payments: [], channels: [], winhotel_import: [],
  tasks: [
    'src/app/api/tasks/route.ts',
    'src/app/api/tasks/[id]/route.ts',
    'src/app/api/tasks/projects/route.ts',
    'src/app/api/tasks/projects/[id]/route.ts',
    'src/app/api/tasks/tags/route.ts',
    'src/app/api/tasks/tags/[id]/route.ts',
    'src/modules/tasks/api/attachments.handlers.ts',
  ],
  events: ['src/modules/events/api/events.handlers.ts'],
  reports: ['src/app/api/reports/route.ts', 'src/app/api/reports/city-tax/route.ts'],
  dashboard: ['src/app/api/dashboard/route.ts'],
  day_sheets: ['src/modules/day-sheets/api/day-sheets.handlers.ts'],
  // Варта фактурування стоїть у ФАСАДІ, а не в хендлерах: там вона одна на
  // всі 25 експортів, а в хендлерах її довелось би повторити 25 разів — і
  // забути в одному з них.
  invoicing: ['src/modules/invoicing/api/index.ts'],
  accounting: ['src/modules/finance/api/_guard.ts'],
  // Гостьова сторінка: публічні двері за токеном проходять через
  // `withGuestReservation` (усі шість) і OCR; налаштування — через хендлери
  // конфігурації в properties і секцій у guests.
  guest_page: [
    'src/modules/guests/data/guest-scope.ts',
    'src/app/api/guest/[token]/ocr/route.ts',
    'src/modules/properties/api/guest-page-config.handlers.ts',
    'src/modules/properties/api/guest-page-configs.handlers.ts',
    'src/modules/properties/api/property-guest-config.handlers.ts',
    'src/modules/guests/api/guest-page-sections.handlers.ts',
    // Листи з посиланням на гостьову сторінку (Блок 0.6 B2): без модуля кнопка
    // вела б на 404 — лист іде без неї, а лист ЛИШЕ про гостьову сторінку
    // (нагадування про реєстрацію, кошик послуг) не іде взагалі.
    'src/modules/bookings/data/send-confirmation-email.ts',
    'src/modules/bookings/data/send-abandoned-cart-email.ts',
    'src/modules/bookings/data/send-guest-reminder-email.ts',
    'src/modules/widget/api/widget-reserve.handlers.ts',
    'src/modules/guests/api/cart.handlers.ts',
  ],
  // Сайти: кожен маршрут `booking-sites/[id]/**` проходить через
  // `withOwnedSite`; створення — у списковому маршруті; аналітика — у
  // хендлерах віджета. Список сайтів (GET) навмисно під `booking_engine`:
  // його читає екран коду віджета, а форма бронювання — не платний модуль.
  sites: [
    'src/app/api/booking-sites/_owned-site.ts',
    'src/app/api/booking-sites/route.ts',
    'src/modules/widget/api/site-analytics.handlers.ts',
  ],
};

const guardOf = (key: string) => new RegExp(`(?:withModule\\(\\s*'${key}'|hasFeature\\([^)]*'${key}')`);

let guarded = 0;
for (const key of MODULES) {
  const files = OWNERS[key];
  assert.ok(files && files.length > 0,
    `модуль «${key}» не називає жодного файла з вартою — ключ без варти це перемикач-обманка (П5); впишіть OWNERS у features.check.ts РАЗОМ із вартою`);
  for (const file of files) {
    assert.ok(fs.existsSync(file), `${file} названо власником варти «${key}», але файла немає`);
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(guardOf(key).test(src),
      `${file} обслуговує модуль «${key}», але не питає фічу — вимкнений модуль усе одно відповість`);
    guarded++;
  }
}
console.log(`  ok  ${guarded} файлів маршрутів відмовляють вимкненому модулю`);

// ── Жоден модуль не лишився на голому withActor/withPermission ──────────
//
// Половина модуля за фічею, половина ні — це найгірший із трьох станів:
// налаштування виглядає робочим, екран частково живий, і зрозуміти, чому
// «Зали» вимкнені, а один запит усе одно проходить, можна лише з коду.
for (const files of Object.values(OWNERS)) {
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const stray = [...src.matchAll(/\bexport const \w+ = (?:await )?with(Actor|Permission)\(/g)];
    assert.strictEqual(stray.length, 0,
      `${file}: ${stray.length} експорт(ів) на withActor/withPermission повз withModule — ці двері лишились відчиненими`);
  }
}
console.log('  ok  у файлах модулів не лишилось варти повз withModule');

console.log('  ok  features: реєстр, меню і маршрути кажуть одне');
