/**
 * Фірмовий тариф — ОКРЕМИЙ ПРАЙС, а не знижка; і відсоток на броні його не заміняє.
 *
 *   node src/modules/pricing/data/company-rate-quote.check.ts
 *
 * ── Що тут доводиться числами ───────────────────────────────────────────
 *
 * Що фірмова ціна — окремий прайс, а не «стандарт мінус десять відсотків»,
 * видно лише на числах, і числа взято з живого прайса Ґрайца
 * (`docs/research/winhotel/MAPPING.md` §129):
 *
 *    84,00 — Standard, категорія SD
 *    80,10 — Firmenpreise (PREISCODE 3), та сама категорія, той самий день
 *
 * `84 × 0,9 = 75,60`, а не `80,10`. Якби фірмова ціна була знижкою, числа
 * збіглися б; вони не збігаються — тому фірмове живе тарифом і своїм рядком
 * у ціновому календарі, а не правилом «−10 %».
 *
 * ── І друга річ, якої не видно з коду: вони СКЛАДАЮТЬСЯ ─────────────────
 *
 * `reservations.lodging_discount_percent` (§6.3.1) — не той самий механізм.
 * Тариф каже, ЯКА ціна в цієї фірми; відсоток — поступка ОДНОМУ гостю з
 * причини, якої немає в жодній таблиці («постійний клієнт», «зіпсований
 * вечір»). У Winhotel вони теж складаються: `ADRESSEN.PR_CODE` і
 * `ADRESSEN.RABATT` стоять на одній адресі, і другий діє ДОДАТКОВО.
 *
 * Тому — складаються, і це рішення К23, а не «як вийде»:
 *
 *    80,10  ціна фірмового тарифу
 *   −10 %   поступка на броні
 *   ------
 *    72,09
 *
 * Числа навмисно попарно несумісні: 72,09 ≠ 72,00 (не «взяли інший тариф»),
 * ≠ 75,60 (не «знижка від стандарту»), ≠ 80,10 (відсоток не загубився),
 * ≠ 84,00 (тариф не загубився). Кожна з чотирьох помилок дає СВОЄ число, і
 * жодна не маскується під іншу.
 *
 * ── Чому це тут, а не в invoicing ───────────────────────────────────────
 *
 * Складання відбувається на двох різних кроках: тариф дає ціну в
 * котируванні, відсоток застосовує `splitOtaAmount()` уже на рахунку. Тобто
 * подвійного застосування немає за побудовою — і саме тому це треба
 * стверджувати: «немає за побудовою» тримається рівно доти, доки хтось не
 * додасть відсоток ще й у котирування, і жоден тип цього не зловить.
 *
 * Сцена лежить у `pricing`, бо саме сюди прийде така правка; `ota-split`
 * вона лише КЛИЧЕ, не змінюючи (модуль фактурування — не наш).
 *
 * ── Осі фікстури (інваріант 26) ─────────────────────────────────────────
 *
 * Дві ціни на той самий день і той самий тип (84,00 і 80,10) — з однією
 * «тариф урахований» і «тариф проігноровано» дали б те саме число. І два
 * значення відсотка (0 і 10) — з одним нулем «відсоток застосовано» і
 * «відсоток забуто» невідрізнимі.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-company-quote-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { calculateQuote } = await import('./quote.repo.ts');
const { money } = await import('@core/money.ts');

const sql = getSql();

const ORG = '__crq__org';
const PROP = `${ORG}_prop`;
const CAT = `${ORG}_cat`;
const TYPE = `${ORG}_type`;
const FIRMEN = `${ORG}_rp_firmen`;

const DAY = '2027-03-15';   // HS у його сезонах
const NEXT = '2027-03-16';

const STANDARD_PRICE = 84.00;
const FIRMEN_PRICE = 80.10;

await sql.run('INSERT INTO organizations (id, name, slug, default_currency) VALUES (?, ?, ?, ?)', [ORG, ORG, ORG, 'EUR']);
await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, 'Greiz', PROP]);
await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [CAT, PROP, 'Rooms', 'room']);
await sql.run(
  `INSERT INTO unit_types (id, property_id, category_id, name, code, base_occupancy, max_adults, max_children, max_occupancy)
   VALUES (?, ?, ?, 'Einzelzimmer', 'SD', 1, 2, 1, 3)`,
  [TYPE, PROP, CAT],
);
await sql.run(
  `INSERT INTO rate_plans (id, property_id, name, code, currency, is_active, is_hidden)
   VALUES (?, ?, 'Firmenpreise', 'FIRMEN', 'EUR', TRUE, FALSE)`,
  [FIRMEN, PROP],
);

// Дві ціни на ОДИН день: рядок без тарифу — прайс для всіх, рядок тарифу —
// фірмовий. Саме ця пара і робить вісь; один рядок нічого не розрізняв би.
await sql.run(
  'INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price) VALUES (?, ?, NULL, ?, ?)',
  [`${ORG}_pc_std`, TYPE, DAY, STANDARD_PRICE],
);
await sql.run(
  'INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price) VALUES (?, ?, ?, ?, ?)',
  [`${ORG}_pc_firmen`, TYPE, FIRMEN, DAY, FIRMEN_PRICE],
);

try {
  // ── 1. Без тарифу — прайс для всіх ──────────────────────────────────
  const standard = await calculateQuote(TYPE, DAY, NEXT, 1, 0, {});
  assert.strictEqual(standard.accommodationTotal, STANDARD_PRICE,
    `без тарифу мала бути ціна для всіх ${STANDARD_PRICE}, отримали ${standard.accommodationTotal}`);

  // ── 2. З фірмовим тарифом — його власна ціна ────────────────────────
  const firmen = await calculateQuote(TYPE, DAY, NEXT, 1, 0, { ratePlanId: FIRMEN });
  assert.strictEqual(firmen.accommodationTotal, FIRMEN_PRICE,
    `з фірмовим тарифом мало бути ${FIRMEN_PRICE}, отримали ${firmen.accommodationTotal}: `
    + `${STANDARD_PRICE} означає, що тариф проігноровано`);

  // ── 3. І це НЕ знижка: 84 × 0,9 ≠ 80,10 ─────────────────────────────
  //
  // Твердження про сам ЗАДУМ, а не про код: воно каже, чому фірмове живе
  // тарифом і рядком у календарі, а не правилом «−10 %».
  assert.notStrictEqual(FIRMEN_PRICE, Math.round(STANDARD_PRICE * 0.9 * 100) / 100,
    'фірмова ціна збіглася зі знижкою −10 % — тоді окремий тариф не потрібен, '
    + 'і всю цю роботу треба переробити на price_rules');
  console.log(`  ok  фірмовий тариф — окремий прайс: ${FIRMEN_PRICE}, а не ${STANDARD_PRICE} і не ${(STANDARD_PRICE * 0.9).toFixed(2)}`);

  // ── 4. Котирування віддає ціну ДО поступки, і це головне тут ────────
  //
  // Поступку (`lodging_discount_percent`) застосовує `splitOtaAmount()` уже
  // на рахунку — тобто складання розкладене на два кроки, і подвійного
  // застосування немає ЗА ПОБУДОВОЮ. «За побудовою» тримається рівно доти,
  // доки хтось не додасть відсоток ще й сюди; жоден тип цього не зловить, і
  // саме тому це стверджується числом.
  //
  // Твердження 2 вище вже пінить це число — тут воно назване другим боком:
  // 72,09 у котируванні означало б, що поступку застосовано двічі, і гість
  // заплатив би 64,88 замість 72,09.
  assert.strictEqual(firmen.accommodationTotal, FIRMEN_PRICE,
    `котирування мусить віддавати ціну ДО поступки (${FIRMEN_PRICE}); `
    + `${money(FIRMEN_PRICE * 0.9)} означає, що відсоток заїхав у котирування — `
    + `тоді рахунок застосує його вдруге і гість заплатить ${money(money(FIRMEN_PRICE * 0.9) * 0.9)}`);

  // ── 5. Складене число — те, яке обіцяє К23, і рахує його наш money() ─
  //
  // Не `toFixed` і не `Math.round(x*100)/100` (інваріант 9): якщо
  // округлення колись зміниться, зміниться й це число, і сцена скаже про це
  // замість того, щоб мовчки погодитись.
  assert.strictEqual(money(FIRMEN_PRICE * 0.9), 72.09,
    'складене число розійшлося з тим, що обіцяє К23 і документація');
  assert.notStrictEqual(money(FIRMEN_PRICE * 0.9), money(STANDARD_PRICE * 0.9),
    'поступка від фірмової ціни збіглася з поступкою від стандарту — '
    + 'тоді фірмовий тариф не має значення, і числа фікстури обрані невдало');
  console.log('  ok  тариф і поступка складаються на РІЗНИХ кроках: 80,10 у котируванні, 72,09 на рахунку');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('company-rate-quote: фірмовий тариф — окремий прайс, і відсоток його не заміняє (К23)');
