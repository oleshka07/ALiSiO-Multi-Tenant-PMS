/**
 * Тіло редактора дня несе лише змінене (рецензія 07.09 раунд 2, правка 1).
 *
 *   node src/modules/pricing/ui/day-edit.check.ts
 *
 * Чому це гейт, а не «і так очевидно». Модалка засівається ЕФЕКТИВНИМИ
 * значеннями пари: власний мінімум тарифу і успадкований від типу виглядають
 * на екрані однаково. Форма, яка шле всі поля завжди, перетворює відкриття
 * дня на запис: збереження самої лише ціни переносило власний мінімум пари в
 * базовий рядок типу, і сусідній тариф отримував чуже число — у продажу і в
 * каналі. Гейт тримає різницю між «подивився» і «записав».
 *
 * Осі (інваріант 26). Вісь твердження — «поле змінене / не змінене», і у
 * фікстурі є обидва значення: ціна 100 → 120 змінена, мінімум 10 лишився 10,
 * «закрито» лишилось true, CTA false → true змінено. Числа несумісні з
 * альтернативним прочитанням: «шле все» дало б `min_stay: 10` у тілі, «не
 * шле нічого» — не дало б ні 120, ні CTA.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { changedDayFields, hasRestrictionField, inheritRestrictionsPayload, buildDayPayload } = await import('./day-edit.ts');

// День, як його бачить оператор у сітці ТАРИФУ: ціна власна, мінімум 10 —
// власний мінімум цієї пари, «закрито» успадковане від типу. На екрані
// різниці немає, і саме тому форма не сміє переказувати їх назад.
const opened = { base_price: 100, weekend_price: null, min_stay: 10, closed: true, cta: false, ctd: false };

// ── 1. Оператор змінив ЛИШЕ ціну ───────────────────────────────────────
{
  const payload = changedDayFields(opened, { ...opened, base_price: 120 });
  assert.deepStrictEqual(payload, { base_price: 120 },
    `тіло мусить нести лише ціну, а несе ${JSON.stringify(payload)} — усе зайве тут осідає в типі й накриває сусідні тарифи`);
  assert.strictEqual(hasRestrictionField(payload), false, 'обмежень у тілі немає — область («на всі тарифи типу») до запиту не додається');
}

// ── 2. Оператор змінив обмеження — воно в тілі, і саме нове ────────────
{
  const payload = changedDayFields(opened, { ...opened, min_stay: 3, cta: true });
  assert.deepStrictEqual(payload, { min_stay: 3, cta: true },
    `змінене обмеження мусить поїхати новим значенням: ${JSON.stringify(payload)}`);
  assert.strictEqual(hasRestrictionField(payload), true, 'обмеження назване — область має сенс');
  assert.ok(!('closed' in payload), '«закрито», якого не чіпали, не називається: назване однакове — це запис');
}

// ── 3. Порожня правка — порожнє тіло ───────────────────────────────────
{
  assert.deepStrictEqual(changedDayFields(opened, { ...opened }), {}, 'нічого не змінили — нічого не пишемо');
}

// ── 4. `null` — це значення, а не «не чіпати» ──────────────────────────
{
  // Ціна вихідних: прибрати (був 150, стало порожньо) — явний null.
  const withWeekend = { ...opened, weekend_price: 150 };
  assert.deepStrictEqual(changedDayFields(withWeekend, { ...withWeekend, weekend_price: null }), { weekend_price: null },
    'порожнє поле ціни вихідних — явний null, інакше «прибрати» не відрізнити від «не чіпати»');
  // «Як у типу» для обмежень пари — усі п'ять у null, ціни не чіпає.
  const inherit = inheritRestrictionsPayload();
  assert.deepStrictEqual(inherit, { min_stay: null, max_stay: null, closed: null, cta: null, ctd: null },
    '«Як у типу» скидає всі обмеження пари, зокрема максимум, якого в денній модалці немає');
  assert.ok(!('base_price' in inherit), 'ціна тарифу при скиданні обмежень лишається його власною');
}

// ── 5. Тіло модалки — ПОВЕДІНКА `buildDayPayload`, не форма виразу ─────
//
// Рецензія 07.09 раунд 5, правка 5.2. Попереднє формулювання читало
// `pricing/page.tsx` текстом і забороняло один синтаксис — на трьох інших
// саботажах, що імітують ту саму помилку, воно лишалось зеленим:
// домішування сирого стану поверх обчисленого, проміжна змінна, порожня
// база порівняння. Тепер збірка тіла живе окремою функцією, і тут
// стверджується те, що вона ВІДДАЄ.
{
  // День у сітці ТАРИФУ: власний мінімум пари 10, ціна 100.
  const day = { base_price: 100, weekend_price: null, min_stay: 10, closed: false, cta: false, ctd: false };
  const form = { basePrice: 100 as number | '', weekendPrice: '' as number | '', minStay: 10, closed: false, cta: false, ctd: false };
  const flags = { ratePlanSelected: true, allPlans: true, inherit: false, advanced: true };

  // Оператор змінив ЛИШЕ ціну, прапорця не чіпав.
  assert.deepStrictEqual(
    buildDayPayload(day, { ...form, basePrice: 155 }, flags), { base_price: 155 },
    'тіло мусить нести саму ціну: усе зайве осідає в типі й накриває сусідні тарифи',
  );

  // Змінене обмеження їде разом з областю.
  assert.deepStrictEqual(
    buildDayPayload(day, { ...form, minStay: 3 }, flags), { min_stay: 3, restrictionsScope: 'type' },
    'змінений мінімум — новим значенням і з областю «на всі тарифи типу»',
  );
  assert.deepStrictEqual(
    buildDayPayload(day, { ...form, minStay: 3 }, { ...flags, allPlans: false }), { min_stay: 3, restrictionsScope: 'pair' },
    'знятий прапорець — лише на пару',
  );

  // «Як у типу»: всі пʼять у NULL, область — завжди пара.
  assert.deepStrictEqual(
    buildDayPayload(day, form, { ...flags, inherit: true }),
    { min_stay: null, max_stay: null, closed: null, cta: null, ctd: null, restrictionsScope: 'pair' },
    '«Як у типу» скидає всі обмеження пари, зокрема максимум',
  );

  // Нічого не змінили — порожнє тіло, запиту не буде.
  assert.deepStrictEqual(buildDayPayload(day, form, flags), {}, 'порожня правка — порожнє тіло');

  // Без обраного тарифу область не називається взагалі.
  assert.deepStrictEqual(
    buildDayPayload(day, { ...form, minStay: 3 }, { ...flags, ratePlanSelected: false }), { min_stay: 3 },
    'у базовій сітці області немає — писати нема куди, крім типу',
  );
}

// ── 5a. ПРОСТИЙ режим: ціна, яку ввели, і є ціна ───────────────────────
//
// Привід усього Блоку 6, дослівно: 07.09.2026 власник поставив на 22
// листопада 333 і отримав 115, бо на дні лежала ціна вихідних, якої в
// простому режимі на екрані НЕМА. Поле, якого оператор не бачить, не має
// права перебивати поле, яке він щойно заповнив, — тому зміна ціни в
// простому режимі прибирає ціну вихідних явним `null`.
//
// Осі (інваріант 26): день із ціною вихідних 115 проти дня без неї; ціна
// змінена (333) проти незміненої; простий режим проти розширеного —
// «завжди прибирати» і «ніколи не прибирати» на такій фікстурі не проходять.
{
  const withWeekend = { base_price: 100, weekend_price: 115, min_stay: 1, closed: false, cta: false, ctd: false };
  const form = { basePrice: 100 as number | '', weekendPrice: 115 as number | '', minStay: 1, closed: false, cta: false, ctd: false };
  const simple = { ratePlanSelected: false, allPlans: false, inherit: false, advanced: false };

  assert.deepStrictEqual(
    buildDayPayload(withWeekend, { ...form, basePrice: 333 }, simple),
    { base_price: 333, weekend_price: null },
    'простий режим: 333 стає ціною і в суботу — ціна вихідних прибирається явним null',
  );

  // Ціну не чіпали — ціна вихідних лишається: простий режим не витирає того,
  // чого оператор не просив чіпати.
  assert.deepStrictEqual(
    buildDayPayload(withWeekend, { ...form, minStay: 4 }, simple), { min_stay: 4 },
    'у простому режимі змінили лише мінімум — ціна вихідних недоторкана',
  );

  // Без ціни вихідних прибирати нема чого: зайвого поля в тілі бути не має.
  const plain = { base_price: 100, weekend_price: null, min_stay: 1, closed: false, cta: false, ctd: false };
  assert.deepStrictEqual(
    buildDayPayload(plain, { ...form, basePrice: 333, weekendPrice: '' }, simple), { base_price: 333 },
    'нема чого прибирати — у тілі лише ціна',
  );

  // РОЗШИРЕНИЙ режим тим самим натисканням ціни вихідних не чіпає: там поле
  // на екрані є, і оператор ним розпоряджається сам.
  assert.deepStrictEqual(
    buildDayPayload(withWeekend, { ...form, basePrice: 333 }, { ...simple, advanced: true }),
    { base_price: 333 },
    'розширений режим: 115 лишається, бо поле видно і його не міняли',
  );

  // Простий режим не шле полів, яких у ньому НЕМАЄ, навіть коли в стані форми
  // лежать їхні значення: інакше CTA знялося б само. «Закрито» — навпаки:
  // воно в простому режимі показується (головна щоденна дія малого готелю),
  // тож ним оператор розпоряджається.
  const closedDay = { base_price: 100, weekend_price: null, min_stay: 1, closed: true, cta: true, ctd: false };
  assert.deepStrictEqual(
    buildDayPayload(closedDay, { ...form, basePrice: 333, closed: true, cta: false }, simple),
    { base_price: 333 },
    'простий режим не знімає CTA, якого в ньому не показують',
  );
  assert.deepStrictEqual(
    buildDayPayload(closedDay, { ...form, closed: false, cta: false }, simple),
    { closed: false },
    'а «Закрито» в простому режимі знімається — воно там на екрані',
  );
}

// ── 5b. Прапорець типу: знятий за замовчуванням і названий ДО збереження ─
//
// Блок 6, п.3. Дефолт був увімкнений, і через нього тест 7 сертифікації дав
// 35 координат замість 4 і торішнє «unexpected rate plan»: оператор ставив
// обмеження «на цей тариф», а воно лягало на ТИП і їхало на кожну його пару.
// Дія, яка розширює наслідок за межі названого оператором, не може бути
// замовчуванням — і не може бути мовчазною.
{
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../../../app/app/(dashboard)/pricing/page.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // Обидві модалки заводять прапорець ЗНЯТИМ.
  assert.strictEqual((page.match(/useState\(true\);?\s*\n?\s*(?=const \[dateFrom|const \[basePrice)/g) || []).length, 0,
    'прапорець «на тип» більше не вмикається за замовчуванням у жодній із модалок');
  assert.strictEqual((page.match(/const \[allPlans, setAllPlans\] = useState\(false\)/g) || []).length, 2,
    'обидві модалки (день і масова) заводять прапорець знятим');

  // І він названий прямо — «записати на ТИП», а не «на всі тарифи».
  assert.ok(/Записати на тип номера/.test(page),
    'підпис прапорця мусить казати, КУДИ пишеться значення, а не перелічувати наслідок');

  // Попередження про власне значення тарифу лишається — і воно ДО збереження,
  // тобто в тілі модалки, а не в тості після відповіді сервера.
  const modalStart = page.indexOf('function EditDayModal(');
  const modalEnd = page.indexOf('function BulkEditModal(');
  const modal = page.slice(modalStart, modalEnd);
  assert.ok(/restrictionsOwn/.test(modal) && /власні цього тарифу/.test(modal),
    'модалка мусить попередити про власне значення тарифу ДО збереження');
  assert.ok(modal.indexOf('власні цього тарифу') < modal.indexOf('Зберегти'),
    'попередження стоїть у тілі форми, вище кнопки — інакше його читають після дії');
}

// ── 6. Екран кличе саме цю функцію ─────────────────────────────────────
//
// Один рядок, і більше нічого: усе інше тепер тримає сцена 5 поведінкою.
{
  const fs = await import('node:fs');
  const file = fs.readFileSync(new URL('../../../app/app/(dashboard)/pricing/page.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const start = file.indexOf('function EditDayModal(');
  const end = file.indexOf('function BulkEditModal(');
  assert.ok(start >= 0 && end > start, 'у файлі екрана мусять бути обидві модалки');
  assert.ok(/buildDayPayload\(/.test(file.slice(start, end)),
    'модалка дня мусить будувати тіло через buildDayPayload — інакше поведінка вище нічого не стереже');
}

console.log('day-edit: тіло дня несе лише змінене; «Як у типу» скидає пʼять; область за прапорцями; екран кличе buildDayPayload');
