/**
 * Фікстура твердження не вироджена по осі, про яку воно стверджує.
 *
 *   node scripts/check-fixture-axes.mjs [--strict]
 *
 * ── Один звір, пʼять разів ──────────────────────────────────────────────
 *
 * За одну добу 01.09.2026 пʼять окремих відкриттів, і кожне коштувало
 * окремого прогону:
 *
 *   * DBL/TRI з `max_adults = max_occupancy` — не розрізняли два правила
 *     місткості, і обрізання по не тій колонці було зеленим;
 *   * одна ніч — не розрізняла «за ніч» і «за перебування»;
 *   * нульовий модифікатор — не розрізняв «зсув застосовано» і «зсув забуто»;
 *   * один тип номера — не розрізняв «вісь пари є» і «осі пари немає»;
 *   * засів, що котирував трьох дорослих у номер на двох.
 *
 * Це не пʼять недоглядів, а один клас: твердження, чия фікстура вироджена
 * по осі, яку воно нібито перевіряє. Зелено і з віссю, і без неї. Правило —
 * інваріант 26 AGENTS: для кожної осі, про яку твердження щось стверджує,
 * фікстура мусить містити щонайменше ДВА значення, що на цій осі різняться,
 * а очікуване число — бути арифметично несумісним з альтернативним
 * прочитанням.
 *
 * ── Що з цього рахується механічно, а що — ні ────────────────────────────
 *
 * Друга половина (несумісність числа) читається очима. Перша — «скільки
 * різних значень осі у фікстурі» — рахується: реєстр нижче каже, який файл
 * про яку вісь стверджує, і гейт лічить різні літерали. Це не доводить, що
 * твердження правильне; це не дає фікстурі тихо виродитись назад — рівно
 * так, як храповик меж не доводить архітектуру, а не дає їй поповзти.
 *
 * Реєстр — це ЗАЯВА перевірки про себе: «я розрізняю по цій осі». Нова
 * перевірка з віссю додає свій рядок сюди; перевірка без рядка нічого не
 * заявляє, і гейт про неї мовчить. Мовчання гейта ≠ доведеність.
 *
 * Коментарі вирізаються перед підрахунком (AGENTS §4): інакше гейт лічив
 * би власні приклади й прозу.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Одна вісь одного файла.
 *
 *   distinct — регулярка з ОДНІЄЮ групою захоплення; гейт лічить різні
 *              значення групи, поріг `min` (типово 2);
 *   some     — серед захоплених має бути хоч одне, що проходить `test`
 *              (ненульовий модифікатор, більше однієї ночі, дитина > 0);
 *   pairs    — регулярка з ДВОМА групами; гейт вимагає хоч одну пару, у якій
 *              значення РІЗНЯТЬСЯ (max_adults ≠ max_occupancy);
 *   scope    — регулярка, що вирізає СЦЕНУ (за її заголовком-коментарем, тож
 *              береться з сирого тексту, до вирізання коментарів). Без неї
 *              вісь лічиться по всьому файлу — і саме так перший варіант
 *              цього гейта був вироджений по тій самій осі, яку стереже:
 *              `'ut'` з чужих сцен тримав «два різних» навіть після того, як
 *              у сцені про пару лишився один тип. Знайдено зламом, як і
 *              належить (інваріант 24).
 */
const AXES = [
  // Два правила місткості: без типу, де вони розходяться, обрізання по не
  // тій колонці зелене.
  {
    file: 'src/modules/pricing/data/property-rate-plans.check.ts',
    axis: 'max_adults ≠ max_occupancy хоч в одного типу',
    pairs: /max_adults, max_children, max_occupancy, base_occupancy\)\s*VALUES \([^)]*?,\s*(\d+),\s*\d+,\s*(\d+),/g,
  },
  // «За ніч» проти «за перебування»: з однією ніччю обидва прочитання дають
  // одне число.
  {
    file: 'src/modules/pricing/domain/occupancy-price.check.ts',
    axis: 'ночей у сцені про тривалість проживання («за ніч» ≠ «за перебування»)',
    scope: /\/\/ ─── Length of stay[\s\S]*?(?=\n\/\/ ─── Vierbett)/,
    distinct: /\bnights:\s*(\d+)/g, min: 2,
    some: { pattern: /\bnights:\s*(\d+)/g, test: (v) => Number(v) > 1, why: 'потрібна хоч одна ніч > 1' },
  },
  // Ц30 (0070): дитина — надбавка за правилом, її сцени — у домені надбавок.
  {
    file: 'src/modules/pricing/domain/extra-occupancy.check.ts',
    axis: 'дітей у ночі (дитина — не малий дорослий)',
    some: { pattern: /\bchildren:\s*(\d+)/g, test: (v) => Number(v) > 0, why: 'потрібна хоч одна ніч із дітьми' },
  },
  {
    file: 'src/modules/pricing/domain/extra-occupancy.check.ts',
    axis: 'ціна ночі під відсотковою надбавкою («% від ночі» ≠ константа)',
    distinct: /nightPrice: (\d+)/g, min: 2,
  },
  {
    file: 'src/modules/pricing/domain/extra-occupancy.check.ts',
    axis: 'режим продажу в надбавках',
    distinct: /sellMode: '(per_room|per_person)'/g, min: 2,
  },
  // Правка 4.6: без котирування БЕЗ правила твердження про порядок було б
  // зеленим і на коді, який просто не рахує зборів.
  {
    file: 'src/modules/pricing/data/quote.repo.check.ts',
    axis: 'сума збору під правилом і без нього',
    distinct: /feesTotal, (\d+),/g, min: 2,
  },
  // Правка 4.2: без правила, яке В КАНАЛ ЇДЕ, твердження «max_los не їде»
  // лишалось би зеленим і на коді, що просто вимкнув правила в каналі.
  {
    file: 'src/modules/channels/channex/ari-adapter.check.ts',
    axis: 'ціна в каналі під правилом, яке їде, і яке не їде',
    scope: /── 15\. У канал не їдуть[\s\S]*?(?=\n\s*\}\n\s*\}\);)/,
    distinct: /rateOn\(D1\d\), (\d+),/g, min: 2,
  },
  // Правка 4.3: із замовленням на ОДИН номер «списали по одному, поки є» і
  // «замовлення цілим» дають те саме число.
  {
    file: 'src/modules/pricing/data/price-rules.repo.check.ts',
    axis: 'номерів у замовленні під промокодом',
    distinct: /'BULK3', (\d+)\)/g, min: 2,
    some: { pattern: /'BULK3', (\d+)\)/g, test: (v) => Number(v) > 1, why: 'потрібне хоч одне замовлення більш ніж на один номер' },
  },
  // Правка 4.4: якби знижки двох готелів під ОДНИМ кодом були рівні, «узяли
  // перший знайдений» лишилось би зеленим — число мусить бути чуже.
  {
    file: 'src/modules/widget/data/legacy-offer-code.check.ts',
    axis: 'знижка купона в сусідній організації під тим самим кодом',
    distinct: /\[[AB], (\d+)\]/g, min: 2,
  },
  // Правила цін (Ц31): одна ціна ночі не розрізняє «% від ночі» і константу;
  // одна дія — знижку й надбавку; один вид значення — відсоток і суму; одна
  // тривалість — «від 3 ночей» діє і не діє; одна дата бронювання — EB діє й ні.
  {
    file: 'src/modules/pricing/domain/price-rules.check.ts',
    axis: 'ціна ночі під відсотковим правилом',
    distinct: /'2027-07-05', (\d+)\)/g, min: 2,
  },
  {
    file: 'src/modules/pricing/domain/price-rules.check.ts',
    axis: 'дія правила (decrease/increase)',
    distinct: /action: '(decrease|increase)'/g, min: 2,
  },
  {
    file: 'src/modules/pricing/domain/price-rules.check.ts',
    axis: 'вид значення правила (percent/fixed)',
    distinct: /valueKind: '(percent|fixed)'/g, min: 2,
  },
  {
    file: 'src/modules/pricing/domain/price-rules.check.ts',
    axis: 'тривалість поїздки проти min_los',
    distinct: /\bnights: (\d+)/g, min: 2,
  },
  {
    file: 'src/modules/pricing/domain/price-rules.check.ts',
    axis: 'дата бронювання проти вікна EB/LM',
    distinct: /bookedAt: '(\d{4}-\d{2}-\d{2})'/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/price-rules.repo.check.ts',
    axis: 'рід правила у писача (rule/promo)',
    distinct: /kind: '(rule|promo)'/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/price-rules.repo.check.ts',
    axis: 'дія правила у писача',
    distinct: /action: '(decrease|increase)'/g, min: 2,
  },
  // Писач надбавок: один рід гостя не розрізняє «дорослий» і «дитина» у
  // клітинці конфлікту; один режим — «сума» і «відсоток» у перевірці значення.
  {
    file: 'src/modules/pricing/data/extra-occupancy.repo.check.ts',
    axis: 'рід гостя у правилах писача',
    distinct: /guestKind: '(adult|child)'/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/extra-occupancy.repo.check.ts',
    axis: 'режим надбавки у правилах писача',
    distinct: /(?:lodging|meal)Mode: '(fixed|percent)'/g, min: 2,
  },
  {
    file: 'src/modules/pricing/domain/occupancy-price.check.ts',
    axis: 'дорослих у котируванні',
    distinct: /\badults:\s*(\d+)/g, min: 2,
  },
  // Зсув на нулі невідрізнюваний від відсутності зсуву.
  {
    file: 'src/modules/channels/domain/ari-batch.check.ts',
    axis: 'модифікатор точки збуту (Ц7)',
    scope: /\/\/ ── 9\. Ц7[\s\S]*?(?=\n\/\/ ── 10\.)/,
    some: { pattern: /priceModifierPercent:\s*(-?[\d.]+)/g, test: (v) => Number(v) !== 0, why: 'потрібен хоч один НЕНУЛЬОВИЙ модифікатор' },
  },
  // Вісь пари: з одним типом номера її наявність невидима. Лічиться в СЦЕНІ
  // про пару, не по файлу — інакше 'ut' із сусідніх сцен тримає «два різних».
  {
    file: 'src/modules/channels/domain/ari-batch.check.ts',
    axis: 'типів номера в координатах ціни (И15)',
    scope: /\/\/ ── 11\. Вісь ПАРИ[\s\S]*?(?=\nconsole\.log\('ari-batch:)/,
    distinct: /kind: 'rate'(?: as const)?, unitTypeId: '([^']+)'/g, min: 2,
  },
  {
    file: 'src/modules/channels/channex/channex.check.ts',
    axis: 'типів номера у дзеркалі пар (И15)',
    scope: /\/\/ ── 14\.1 Вісь ПАРИ[\s\S]*?(?=\n\/\/ ── 15\.)/,
    // Кожен запис дзеркала окремо — `['тариф', 'тип', 'їхній id']`. Перша
    // версія ловила лише перший запис виклику `pairMap(` і була зеленою від
    // сусідніх сцен: та сама виродженість, тільки в регулярці гейта.
    distinct: /\['[^']*',\s*'([^']+)',\s*'[^']*'\]/g, min: 2,
  },
  // Транзієнтна невдача проти відмови вендора: з одним родом невдачі
  // «спроба не рахується» і «спроба рахується» невідрізнювані.
  {
    file: 'src/modules/channels/domain/ari-batch.check.ts',
    axis: 'невдача проходу і невдача рядка в сцені про спроби',
    scope: /\/\/ ── 13\. Транспортна невдача[\s\S]*?(?=\nconsole\.log\('ari-batch:)/,
    distinct: /report\.needsAttention, ([01]),/g, min: 2,
  },
  // Двері писачів: «вимкнене зʼєднання теж отримує чергу» невидиме з одним
  // увімкненим; «незмаплений тип не отримує» невидиме з одним змапленим.
  {
    file: 'src/modules/channels/api/outbox.check.ts',
    axis: 'увімкнене й вимкнене зʼєднання у фікстурі',
    distinct: /enabled: (true|false)/g, min: 2,
  },
  {
    file: 'src/modules/channels/api/outbox.check.ts',
    axis: 'змаплений і незмаплений тип у твердженнях',
    distinct: /unitTypeId: '(UT\d)'/g, min: 2,
  },
  // Дорослих у котируванні більше одного значення, і місткість засіву не
  // менша за найбільше з них: інакше «місткість» перевіряється числом, яке
  // засів не вміщає.
  {
    file: 'src/modules/pricing/data/nightly-price.check.ts',
    axis: 'дорослих у котируванні',
    distinct: /\badults:\s*(\d+)/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/nightly-price.check.ts',
    axis: 'ночей у котируванні',
    some: { pattern: /\bnights:\s*(\d+)/g, test: (v) => Number(v) > 1, why: 'потрібна хоч одна ніч > 1' },
  },
  // Звірка П6: з однією ціною «збіг» і «розбіжність» невідрізнювані — те
  // саме для наявності і для прапорця «закрито» на тому боці.
  {
    file: 'src/modules/channels/domain/verify.check.ts',
    axis: 'ціна очікувана і прочитана (збіг ≠ розбіжність)',
    distinct: /rateMinor: (\d+)/g, min: 2,
  },
  {
    file: 'src/modules/channels/domain/verify.check.ts',
    axis: 'наявність очікувана і прочитана',
    distinct: /free: (\d+)/g, min: 2,
  },
  {
    file: 'src/modules/channels/channex/verify-adapter.check.ts',
    axis: 'прапорець «закрито» на тому боці (збіг ≠ розбіжність)',
    distinct: /cell\('[\d.]+', (true|false), \d+\)/g, min: 2,
  },
  // Обмеження дня в пачці без наявності (INC-016): з одним мінімумом ночей
  // константа в тілі й прочитаний базовий рядок невідрізнювані.
  {
    file: 'src/modules/channels/channex/ari-adapter.check.ts',
    axis: 'мінімум ночей у базових рядках сцени про обмеження без наявності',
    scope: /\/\/ ── 7\. Обмеження дня[\s\S]*?(?=\n\} finally)/,
    distinct: /min_stay:\s*(\d+)/g, min: 2,
  },
  // Блок 2.1: сцени про зняття з продажу стверджують про вісь `is_active` —
  // той самий рядок ціни їде закритим при FALSE і відкритим при TRUE. Сцена
  // з одним значенням довела б лише «завжди закрито» або «завжди відкрито».
  {
    file: 'src/modules/channels/channex/ari-adapter.check.ts',
    axis: 'стан тарифу (is_active) у сцені про зняття з продажу',
    scope: /\/\/ ── 8\. Тариф знято з продажу[\s\S]*?(?=\n\} finally)/,
    distinct: /is_active = (TRUE|FALSE)/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/rate-plans.repo.check.ts',
    axis: 'стан тарифу (isActive) у сцені про зняття з продажу',
    scope: /\/\/ ── 7\. Зняти з продажу[\s\S]*?(?=\n\} finally)/,
    distinct: /isActive: (true|false) \}/g, min: 2,
  },
  // Блок 2.2: режим ціни тарифу — обидва режими в кожній сцені, що про нього
  // стверджує: з одним «режим не впливає» і «режим завжди той самий»
  // невідрізнювані.
  {
    file: 'src/modules/pricing/data/rate-plans.repo.check.ts',
    axis: 'режим ціни (sell_mode) у сцені про вибір і замок режиму',
    scope: /\/\/ ── 8\. Режим ціни[\s\S]*?(?=\n\} finally)/,
    distinct: /'(per_room|per_person)'/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/nightly-price.check.ts',
    axis: 'режим ціни (sell_mode) у сцені «за номер»',
    scope: /\/\/ ── Режим «за номер»[\s\S]*?(?=\n\/\/ ── Викликач без)/,
    distinct: /'(per_room|per_person)'/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/property-rate-plans.check.ts',
    axis: 'режим ціни (sell_mode) у фікстурі шва',
    scope: /async function seed\([\s\S]*?\n\}\n/,
    distinct: /'(per_room|per_person)'/g, min: 2,
  },
  {
    file: 'src/modules/channels/channex/catalog-target.check.ts',
    axis: 'режим ціни (sellMode) у тілі тарифу',
    scope: /[\s\S]+/,
    distinct: /sellMode: '(per_room|per_person)'/g, min: 2,
  },
  // Ц32 переглянуто 07.09: обмеження на ПАРІ. Одне значення мінімуму не
  // розрізняє «власне пари» й «типу»; одна пара — «на пару» й «на тип»;
  // «закрито» лише на парі не розрізняє «пара закрита» й «тип закритий».
  // Сцена 10 звірки: з ОДНИМ тарифом у файлі «ефективне пари» і «ефективне
  // типу» дають те саме число — сцена була зелена й на коді до 0072
  // (рецензія 07.09 раунд 2, правка 2).
  {
    file: 'src/modules/channels/channex/verify-adapter.check.ts',
    axis: 'два тарифи одного типу в сцені про обмеження пари',
    scope: /\/\/ ── 10\. Розбіжність на рівні ПАРИ[\s\S]*?(?=\n {2}\}\);)/,
    distinct: /ratePlanId === (RP2|RP) /g, min: 2,
  },
  {
    file: 'src/modules/channels/channex/verify-adapter.check.ts',
    axis: 'мінімум пари проти мінімуму типу в сцені 10 (очікуване 3 і 2)',
    scope: /\/\/ ── 10\. Розбіжність на рівні ПАРИ[\s\S]*?(?=\n {2}\}\);)/,
    distinct: /open\((\d+), 1\)/g, min: 2,
  },
  // Редактор дня: тіло несе лише змінене (правка 1 тієї ж рецензії). Вісь —
  // «поле змінене / не змінене»; з одним значенням у фікстурі твердження
  // зелене і для форми, яка шле все.
  {
    file: 'src/modules/pricing/ui/day-edit.check.ts',
    axis: 'змінене поле проти незмінного в тілі редактора дня',
    distinct: /base_price: (\d+)/g, min: 2,
  },
  // Сцена 14: з одним лише нулем твердження «нуль відмовляє» зелене й у
  // писача, який відмовляє ВСЬОМУ (рецензія 07.09 раунд 3, правка 1.1).
  {
    file: 'src/modules/pricing/data/price-calendar.repo.check.ts',
    axis: 'мінімум ночей: заборонене значення проти дозволеного (сцена 14)',
    scope: /\/\/ ── 14\. Мінімум ночей[\s\S]*?(?=\n {2}console\.log\('price-calendar)/,
    distinct: /min_stay: (-?\d+)/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/price-calendar.repo.check.ts',
    axis: 'мінімум пари проти мінімуму типу в сцені 13 (витік у тип)',
    scope: /\/\/ ── 13\. Редактор дня[\s\S]*?(?=\n {2}console\.log\('price-calendar)/,
    distinct: /min_stay: (\d+)/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/price-calendar.repo.check.ts',
    axis: 'мінімум на парі проти мінімуму типу (сцена 11)',
    scope: /\/\/ ── 11\. Обмеження на ТАРИФІ[\s\S]*?(?=\n {2}\/\/ ── 12\.)/,
    distinct: /min_stay: (\d+)/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/price-calendar.repo.check.ts',
    axis: '«закрито» на парі й на типі (сцена 11): обидва значення',
    scope: /\/\/ ── 11\. Обмеження на ТАРИФІ[\s\S]*?(?=\n {2}\/\/ ── 12\.)/,
    distinct: /closed: (true|false)/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/nightly-price.check.ts',
    axis: 'закрита пара проти відкритої на тому ж типі',
    scope: /\/\/ ── Обмеження на ТАРИФІ[\s\S]*?(?=\n\/\/ ── Правила цін)/,
    distinct: /ratePlanId: (BAR|BNB) \}/g, min: 2,
  },
  {
    file: 'src/modules/channels/channex/ari-adapter.check.ts',
    axis: 'область обмежень у сцені 12: пара і «на всі тарифи типу»',
    scope: /\/\/ ── 12\. Обмеження на ПАРІ[\s\S]*?(?=\n {4}\/\/ ── 14\.)/,
    some: { pattern: /restrictionsScope: '(type)'/g, test: (v) => v === 'type', why: 'потрібен хоч один запис «на всі тарифи типу» поруч із записами в пару' },
  },
  // Рецензія 07.09 п.1: похідний бере рядок бази ЦІЛКОМ (власний, інакше
  // типу), а не по полю. З однією ціною вихідних у фікстурі «weekend типу
  // просочився у власний рядок бази без weekend» і «взято власний рядок»
  // дають одне число.
  {
    file: 'src/modules/pricing/data/rate-plans.repo.check.ts',
    axis: 'ціна вихідних рядка типу в сцені похідного',
    scope: /\/\/ ── 10\. Похідний тариф[\s\S]*?(?=\n\} finally)/,
    distinct: /weekend_price: (\d+)/g, min: 2,
  },
  // Блок 2 крок 2 (Ц28): похідний тариф. Один вид коригування не розрізняє
  // «відсоток» і «суму»; один напрям — «плюс» і «мінус»; одна базова ціна —
  // «порахували від бази» і «взяли константу».
  {
    file: 'src/modules/pricing/data/rate-plans.repo.check.ts',
    axis: 'вид коригування похідного (adjustmentKind)',
    scope: /\/\/ ── 10\. Похідний тариф[\s\S]*?(?=\n\} finally)/,
    distinct: /adjustmentKind: '(percent|fixed)'/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/rate-plans.repo.check.ts',
    axis: 'напрям коригування похідного (adjustmentDirection)',
    scope: /\/\/ ── 10\. Похідний тариф[\s\S]*?(?=\n\} finally)/,
    distinct: /adjustmentDirection: '(increase|decrease)'/g, min: 2,
  },
  {
    file: 'src/modules/pricing/data/rate-plans.repo.check.ts',
    axis: 'базові ціни, від яких рахується похідний',
    scope: /\/\/ ── 10\. Похідний тариф[\s\S]*?(?=\n\} finally)/,
    distinct: /base_price: (\d+)/g, min: 3,
  },
  // ── Блок 5a ─────────────────────────────────────────────────────────────
  //
  // Обидві нові перевірки заявляли у своїй документації «фікстура не
  // вироджена по осях», а рядка тут не мали — тобто заявляли нікому
  // (рецензія раунду 4, п. 2.6). Мовчання гейта не доведеність.
  {
    file: 'src/modules/properties/data/amenities.repo.check.ts',
    axis: 'область зручності у сцені призначення (обʼєкт ≠ номер ≠ обидва)',
    scope: /\/\/ ── 2\. Область тримає[\s\S]*?(?=\n {2}\/\/ ── 3\.)/,
    distinct: /a\.code === '(elevator|hair_dryer|breakfast)'/g, min: 3,
  },
  {
    file: 'src/modules/properties/data/amenities.repo.check.ts',
    axis: 'мова каталогу (одна мова не розрізняє переклад і константу)',
    // Рахуються мови ДВОХ ГОТЕЛІВ, про яких і йдеться в твердженні (`ORG`
    // українською, `OTHER` чеською), а не всі мови у файлі. Перша редакція
    // брала `seedAmenityCatalog(\w+, …)` будь-де — і коли обидва справжні
    // готелі звели на `'uk'`, вісь лишилась зеленою, бо `min: 2` добирала
    // сцена запасної мови (`'pl'`) з іншого твердження. Вісь, яку рятує
    // сусідня сцена, не стереже нічого (рецензія раунду 6, п. 3.4).
    distinct: /seedAmenityCatalog\((?:ORG|OTHER), '(\w\w)'\)/g, min: 2,
  },
  {
    file: 'src/core/currency.rates.check.ts',
    axis: 'джерело курсу в одного готелю (manual ≠ cnb)',
    distinct: /rateSource: '(manual|cnb)'/g, min: 2,
  },
  {
    file: 'src/core/currency.rates.check.ts',
    axis: 'числа курсу: ручний ≠ фіксинг банку',
    distinct: /(?:, 'CZK', |, 'EUR', |EUR: |USD: )(\d+(?:\.\d+)?)/g, min: 3,
  },
  {
    file: 'src/core/currency.rates.check.ts',
    axis: 'базова валюта двох готелів (спільна база не розрізняє «до бази» і «до крон»)',
    distinct: /default_currency\) VALUES \(\?, \?, \?, '(\w{3})'\)/g, min: 2,
  },
  {
    file: 'src/modules/properties/data/guest-page-levels.check.ts',
    axis: 'рівні мережі гостя (обʼєкт ≠ тип ≠ номер)',
    distinct: /'(HOUSE|TYPE|ROOM)-NET'/g, min: 3,
  },
];

/** Коментарі геть — блокові й рядкові; `://` у рядках лишається. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function values(src, pattern, group = 1) {
  const out = [];
  for (const m of src.matchAll(pattern)) out.push(m[group]);
  return out;
}

const problems = [];
let checked = 0;

for (const a of AXES) {
  const full = path.join(ROOT, a.file);
  if (!fs.existsSync(full)) {
    problems.push(`${a.file}: файла немає — рядок реєстру застарів, приберіть його`);
    continue;
  }
  const raw = fs.readFileSync(full, 'utf8');
  let region = raw;
  if (a.scope) {
    const m = raw.match(a.scope);
    if (!m) {
      problems.push(`${a.file}: вісь «${a.axis}» — сцену не знайдено (${a.scope}); заголовок сцени перейменовано? гейт нічого не лічить`);
      continue;
    }
    region = m[0];
  }
  const src = stripComments(region);
  checked++;

  if (a.distinct) {
    const seen = new Set(values(src, a.distinct));
    const min = a.min ?? 2;
    if (seen.size < min) {
      problems.push(`${a.file}: вісь «${a.axis}» — ${seen.size} різних значень (${[...seen].join(', ') || 'жодного'}), треба ≥ ${min}: `
        + 'з одним значенням твердження зелене і з віссю, і без неї');
    }
  }
  if (a.some) {
    const all = values(src, a.some.pattern);
    if (!all.some(a.some.test)) {
      problems.push(`${a.file}: вісь «${a.axis}» — ${a.some.why}; знайдено: ${all.join(', ') || 'нічого'}`);
    }
  }
  if (a.pairs) {
    const found = [...src.matchAll(a.pairs)];
    if (!found.some((m) => m[1] !== m[2])) {
      problems.push(`${a.file}: вісь «${a.axis}» — усі пари однакові (${found.map((m) => `${m[1]}/${m[2]}`).join(', ') || 'жодної'}): `
        + 'два правила з однаковим числом невідрізнювані');
    }
  }
}

if (problems.length) {
  console.error('\n✗ фікстура вироджена по осі, про яку твердження стверджує (AGENTS інваріант 26):\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\n  Твердження з такою фікстурою зелене в обох світах. Додайте друге значення осі');
  console.error('  й переконайтесь, що очікуване число несумісне з альтернативним прочитанням.');
  if (strict) process.exit(1);
} else {
  console.log(`  чисто — ${AXES.length} осей у ${new Set(AXES.map((a) => a.file)).size} перевірках, жодна фікстура не вироджена`);
}
