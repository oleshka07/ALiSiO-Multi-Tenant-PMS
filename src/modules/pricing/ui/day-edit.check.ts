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

const { changedDayFields, hasRestrictionField, inheritRestrictionsPayload } = await import('./day-edit.ts');

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

// ── 5. Екран справді ходить через цю функцію ───────────────────────────
//
// Рецензія 07.09 раунд 3, правка 1.2: сцени вище стережуть ФУНКЦІЮ, а дефект
// жив у `pricing/page.tsx`. Повернення тіла модалки до сирого обʼєкта форми
// лишало `npm run check` і `tsc` зеленими — файл, у якому був дефект, гейтом
// не накритий. Тому статичне твердження про сам екран, тим самим патерном,
// що сцена 6 `price-calendar.repo.check`: коментарі вирізаються, інакше
// перевірка рахує власну документацію (AGENTS §4).
{
  const fs = await import('node:fs');
  const url = new URL('../../../app/app/(dashboard)/pricing/page.tsx', import.meta.url);
  const file = fs.readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Лише модалка ДНЯ. Масовий редактор поруч збирає тіло сам, і правильно:
  // там «поле не заповнене» вже означає «не чіпати» (`!== ''` → undefined),
  // тобто те саме правило, тільки іншим механізмом.
  const start = file.indexOf('function EditDayModal(');
  const end = file.indexOf('function BulkEditModal(');
  assert.ok(start >= 0 && end > start, 'у файлі екрана мусять бути обидві модалки — інакше сцена дивиться не туди');
  const src = file.slice(start, end);

  // Не «виклик десь є», а «тіло будується саме ним у КОЖНІЙ гілці»: перше
  // твердження зелене й тоді, коли одна гілка повернулась до сирого стану
  // форми (саме так і виглядав дефект).
  const changed = src.match(/const changed = [\s\S]*?;\n/);
  assert.ok(changed, 'у модалці дня мусить бути один вираз, який будує тіло');
  const expr = changed![0];
  assert.ok(/changedDayFields\(/.test(expr),
    `тіло дня будується через changedDayFields — інакше модалка знову шле всю форму: ${expr.trim()}`);
  // `: edited.base_price` всередині гілки скидання — законне читання поля,
  // а не віддача всього стану; ловимо саме віддачу цілком.
  assert.strictEqual(/[?:]\s*edited\s*(?=[;\n])/.test(expr), false,
    `жодна гілка не віддає сирий стан форми як тіло: ${expr.trim()}`);
  assert.ok(/inheritRestrictionsPayload\(\)/.test(src),
    'дія «Як у типу» мусить брати тіло з inheritRestrictionsPayload');
  assert.ok(/hasRestrictionField\(/.test(src),
    'область («на всі тарифи типу») додається лише коли в тілі є обмеження');

  // Тіло, яке йде в onSave, — результат `body()`, а не розгорнутий стан
  // форми. Саме таке розгортання й було дефектом.
  assert.ok(/onSave\(body\(\)\)/.test(src),
    'кнопка «Зберегти» мусить кликати onSave(body()) — тіло будує одна функція, а не розмітка');

  // І тіло не збирається обʼєктом просто в місці виклику: саме таке
  // розгортання стану форми й було дефектом.
  const raw = src.match(/onSave\(\s*\{/);
  assert.strictEqual(raw, null, `модалка не збирає тіло вручну в onSave: ${raw?.[0]}`);
}

console.log('day-edit: тіло дня несе лише змінене; null — прибрати чи «як у типу»; порожня правка нічого не пише; екран ходить через цю функцію');
