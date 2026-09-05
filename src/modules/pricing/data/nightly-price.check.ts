/**
 * Ціна ночі рахується один раз і однаково — тепер ще й на тариф.
 *
 *   node src/modules/pricing/data/nightly-price.check.ts
 *
 * `priceNights()` — єдине джерело відповіді «скільки коштує ніч» (AGENTS.md
 * §3, інваріант 16). Відколи в `price_calendar` з'явився `rate_plan_id`,
 * джерел рядка стало три, і порядок між ними — це гроші: помилка тут не падає,
 * вона виставляє гостю інше число.
 *
 * Перевірка ганяє справжню SQLite, а не підробку `sql`. Половина того, що тут
 * може зламатися, — це сам SQL: умова `(rate_plan_id IS NULL OR rate_plan_id
 * = ?)`, унікальний індекс із COALESCE і `ON CONFLICT`, який мусить із ним
 * збігтися. Підроблений драйвер перевіряв би форму виклику, а не відповідь.
 *
 * Що тримаємо:
 *   - ціна тарифу на дату перекриває базову;
 *   - дата без ціни тарифу падає на базову, а не зникає;
 *   - надбавка за заселеність СПІЛЬНА для двох тарифів одного типу — це
 *     свідоме обмеження рішення §10.11, і воно має бути видимим, а не
 *     випадковим;
 *   - виклик БЕЗ тарифу поводиться точно як до зміни;
 *   - ніч, якої не знає жодне джерело, лишається в `missing`;
 *   - два тарифи мають незалежні ціни на ту саму дату — те, заради чого все
 *     це робилось (сертифікаційний тест 4 Channex);
 *   - старий UNIQUE(unit_type_id, date) знято: базовий рядок і рядок тарифу
 *     на ту саму добу співіснують, а другий базовий — ні.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Аліаси спершу, потім усе, що їх потребує: статичний імпорт аліасованого
// модуля піднявся б вище цього рядка і не знайшовся б.
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-nightly-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { priceNights } = await import('./nightly-price.ts');

const sql = getSql();
const ORG = '__np_check__org';
const PROP = '__np_check__prop';
const CAT = '__np_check__cat';
const TYPE = '__np_check__type';        // base_occupancy = 2
const BAR = '__np_check__rp_bar';
const BNB = '__np_check__rp_bnb';

await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'Nightly', ORG]);
await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, 'Nightly', ORG]);
await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [CAT, PROP, 'Rooms', 'room']);
await sql.run(
  // Місткість названа явно: чотири дорослих, двоє дітей, усього шість. Без
  // цього тип брав дефолти (2/2/4), і твердження нижче котирували ТРЬОХ і
  // ЧОТИРЬОХ дорослих у двомісний номер — заселеність, якої він не вміщає.
  // Поки запобіжника місткості не було, цього ніхто не помічав; тепер це
  // видно, і числа тут навмисно не тісні: ці твердження про НАДБАВКУ тарифу,
  // а не про місткість, і впиратися в неї вони не мають.
  `INSERT INTO unit_types (id, property_id, category_id, name, code,
                           base_occupancy, max_adults, max_children, max_occupancy)
   VALUES (?, ?, ?, ?, ?, ?, 4, 2, 6)`,
  [TYPE, PROP, CAT, 'Double', 'DBL', 2],
);
for (const [id, name, code] of [[BAR, 'Best Available Rate', 'BAR'], [BNB, 'Bed & Breakfast', 'BNB']] as const) {
  await sql.run(
    'INSERT INTO rate_plans (id, property_id, name, code) VALUES (?, ?, ?, ?)',
    [id, PROP, name, code],
  );
}

/** Один рядок календаря: `ratePlanId === null` — базова ціна типу номера. */
const cal = async (ratePlanId: string | null, date: string, base: number) => {
  await sql.run(
    'INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price) VALUES (?, ?, ?, ?, ?)',
    [`pc_${ratePlanId ?? 'base'}_${date}`, TYPE, ratePlanId, date, base],
  );
};

// Базова ціна типу — на всі чотири доби.
for (const d of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) await cal(null, d, 200);
// BAR дорожчий за базу, B&B дешевший — і обидва лише на частину діапазону.
// Саме форма сертифікаційного тесту 4: діапазони тарифів перетинаються між
// собою і НЕ збігаються з базовим.
await cal(BAR, '2026-11-10', 312.66);
await cal(BAR, '2026-11-11', 312.66);
await cal(BNB, '2026-11-10', 111);
await cal(BNB, '2026-11-11', 111);
await cal(BNB, '2026-11-12', 111);

// ── Два тарифи, та сама доба, незалежні ціни ────────────────────────────────
// Це те саме твердження, яке підтвердив живий API Channex (INVENTORY §14.1),
// перевірене тепер із нашого боку.
const bar2 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 2, ratePlanId: BAR });
const bnb2 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 2, ratePlanId: BNB });
assert.strictEqual(bar2.nights[0].price, 312.66, 'BAR мав коштувати свою ціну, а не базову');
assert.strictEqual(bnb2.nights[0].price, 111, 'B&B мав коштувати свою ціну, а не базову');
assert.strictEqual(bar2.nights[0].source, 'rate_plan', 'джерелом ночі мав бути тариф');
assert.notStrictEqual(bar2.nights[0].price, bnb2.nights[0].price, 'два тарифи однієї доби дали однакову ціну');

// ── Ціна тарифу перекриває базову; відсутня — падає на базову ──────────────
// 10–11 листопада BAR має свою ціну, 12–13 — ні. Перевіряємо весь заїзд
// одним викликом, бо саме на межі діапазону це й ламається.
const mixed = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 4, adults: 2, ratePlanId: BAR });
assert.deepStrictEqual(
  mixed.nights.map((n) => [n.date, n.price, n.source]),
  [
    ['2026-11-10', 312.66, 'rate_plan'],
    ['2026-11-11', 312.66, 'rate_plan'],
    ['2026-11-12', 200, 'calendar'],
    ['2026-11-13', 200, 'calendar'],
  ],
  'ціна тарифу мала перекрити базову там, де вона є, і поступитися їй там, де немає',
);
assert.strictEqual(mixed.missing.length, 0, 'доба з базовою ціною не може бути missing');
assert.strictEqual(mixed.total, 1025.32, 'сума заїзду порахована неправильно');

// ── Виклик БЕЗ тарифу поводиться як до зміни ───────────────────────────────
// Найважливіше твердження файлу: кожен наявний виклик — віджет, кошторис
// оператора, публічний календар — тарифу не передає, і мусить бачити те саме,
// що бачив учора. Рядки тарифів у таблиці вже лежать.
const plain = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 4, adults: 2 });
assert.deepStrictEqual(
  plain.nights.map((n) => [n.price, n.source]),
  [[200, 'calendar'], [200, 'calendar'], [200, 'calendar'], [200, 'calendar']],
  'виклик без тарифу побачив ціну тарифу — рядки тарифів течуть у базовий шлях',
);

// ── Надбавка за заселеність спільна для тарифів ────────────────────────────
// Матриця: двоє — 200, троє — 260. Надбавка за третього = 60, і вона та сама
// для обох тарифів, бо береться з матриці, яка про тарифи не знає. Це свідоме
// обмеження рішення §10.11, і воно перевіряється, щоб не з'ясувалося потім.
const occ = async (persons: number, price: number) => {
  await sql.run(
    'INSERT INTO price_occupancy (id, organization_id, property_id, unit_type_id, persons, price_gross) VALUES (?, ?, ?, ?, ?, ?)',
    [`po_${persons}`, ORG, PROP, TYPE, persons, price],
  );
};
await occ(2, 200);
await occ(3, 260);

const bar3 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 3, ratePlanId: BAR });
const bnb3 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 3, ratePlanId: BNB });
assert.strictEqual(bar3.nights[0].price, 372.66, 'BAR на трьох мав отримати надбавку 60 понад свою ціну');
assert.strictEqual(bnb3.nights[0].price, 171, 'B&B на трьох мав отримати ТУ САМУ надбавку 60');
assert.strictEqual(
  bar3.nights[0].price - 312.66,
  bnb3.nights[0].price - 111,
  'надбавка за заселеність розійшлася між тарифами — вона мусить бути спільною',
);
assert.strictEqual(bar3.occupancyPriced, true, 'ніч із надбавкою з матриці мала позначитись occupancyPriced');

// Заселеність, якої матриця не знає (четверо): до 05.09.2026 ціна тарифу
// стояла сама (312.66 — четверо дешевше за трьох за 372.66). Розділ A п.3:
// це ціна, якої готель не називав, — ніч без ціни на цю кількість дорослих
// (інваріант 17). Сцена з двома режимами — нижче, у блоці «за номер».
const bar4 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 4, ratePlanId: BAR });
assert.deepStrictEqual(bar4.missing, ['2026-11-10'], 'без рядка матриці на четверо ніч мала лишитись без ціни, а не взяти ціну тарифу');
assert.strictEqual(bar4.occupancyPriced, false, 'ніч без ціни не видає себе за пораховану заселеність');

// На двох (= base_occupancy) надбавки немає за визначенням, і матриця тут
// нічого не міняє: 312.66 лишається 312.66.
const bar2again = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 2, ratePlanId: BAR });
assert.strictEqual(bar2again.nights[0].price, 312.66, 'заселеність, що дорівнює базовій, не має міняти ціну тарифу');

// ── Ніч, якої не знає жодне джерело ────────────────────────────────────────
// Заселеність 5 — матриця має рядки лише на 2 і 3; дата 1 грудня — календар
// не має жодного рядка, ні базового, ні тарифного. Матриця тут відповідає на
// БУДЬ-ЯКУ дату, бо її рядки безстрокові, тож «діру» треба робити по
// заселеності, а не лише по даті.
const gap = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-01', nights: 1, adults: 5, ratePlanId: BAR });
assert.deepStrictEqual(gap.missing, ['2026-12-01'], 'ніч без жодного джерела мала лишитись missing');
assert.strictEqual(gap.nights.length, 0, 'ніч без ціни не має потрапляти в результат');
assert.strictEqual(gap.total, 0, 'вигадана сума на ніч без ціни');

// Дзеркало до попереднього: та сама дата на двох матриця ЗНАЄ (рядок
// безстроковий), тож missing там не буде. Це не дублікат — це те, що робить
// перевірку вище чесною: діра має бути справжньою, а не наслідком дати.
const notGap = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-01', nights: 1, adults: 2, ratePlanId: BAR });
assert.strictEqual(notGap.missing.length, 0, 'безстроковий рядок матриці мав покрити грудень');
assert.strictEqual(notGap.nights[0].source, 'matrix', 'поза діапазоном тарифу мала відповісти матриця');

// ── Старий UNIQUE(unit_type_id, date) справді знято ────────────────────────
// Рядки вище вже це довели (базовий і два тарифні на 10 листопада), але
// твердження варте власної перевірки: саме цей констрейнт мовчки заблокував би
// другий тариф на наявній базі клієнта.
const rows = await sql.rows<any>(
  'SELECT rate_plan_id FROM price_calendar WHERE unit_type_id = ? AND date = ?',
  [TYPE, '2026-11-10'],
);
assert.strictEqual(rows.length, 3, 'на одну добу мали лежати базовий рядок і два тарифні');

// А унікальність — на місці: другий БАЗОВИЙ рядок на ту саму добу відхиляється
// індексом із COALESCE. Без нього два базові рядки співіснували б, і яка ціна
// виграє, залежало б від порядку читання.
await assert.rejects(
  () => cal(null, '2026-11-10', 999),
  'другий базовий рядок на ту саму добу мав бути відхилений унікальним індексом',
);
// І другий рядок ТОГО САМОГО тарифу — теж.
await assert.rejects(
  () => cal(BAR, '2026-11-10', 999),
  'другий рядок того самого тарифу на ту саму добу мав бути відхилений',
);

// ── Місткість: діти мусять у щось упиратися ──────────────────────────────
//
// До Ц12 це ловилось ВИПАДКОВО: `persons` складав дорослих із дітьми, і
// сімʼя на сім осіб просто не знаходила рядка матриці — ніч ставала
// `missing`, бронювання відхилялось. Після розділу осі дорослих двоє, рядок
// на двох є, і ніщо більше не питає, куди подіти пʼятьох дітей.
//
// Тип номера тут заведено з дефолтами: max_adults 2, max_children 2,
// max_occupancy 4.
const overCapacity = await priceNights({
  unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 2, children: 5,
  ratePlanId: BAR,
});
assert.ok(overCapacity.missing.length > 0,
  'дві дорослі й пʼятеро дітей у номер 2+2 — це продано понад місткість');
assert.strictEqual(overCapacity.total, 0, 'проживання понад місткість не має суми');
console.log('  ok  партія понад місткість типу не котирується');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('nightly-price: all checks passed');

// ── Д1/Д2 (INC-012): обмеження й «закрито» читаються котируванням ────────
//
// Пʼять днів у грудні, кожен зі своїм обмеженням, і два РІЗНІ мінімуми
// (інваріант 26): 20 — мін. 2 і заборона заїзду; 21 — мін. 3; 22 — закрито;
// 23 — заборона виїзду (дата ВИЇЗДУ); 24 — відкритий. Рядок ТАРИФУ на 20-те
// має власне «закрито» — і його ніхто не читає: обмеження живуть на типі (П7).
{
  const { stayRefusal } = await import('../domain/restrictions.ts');
  const dec = async (date: string, over: Record<string, unknown>) => {
    const cols = ['id', 'unit_type_id', 'date', 'base_price', ...Object.keys(over)];
    const vals = [`pc_r_${date}`, TYPE, date, 200, ...Object.values(over)];
    await sql.run(`INSERT INTO price_calendar (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
  };
  await dec('2026-12-20', { min_stay: 2, cta: 1 });
  await dec('2026-12-21', { min_stay: 3 });
  await dec('2026-12-22', { closed: 1 });
  await dec('2026-12-23', { ctd: 1 });
  await dec('2026-12-24', {});
  await sql.run('INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price, closed) VALUES (?, ?, ?, ?, ?, 1)',
    ['pc_r_bar_20', TYPE, BAR, '2026-12-20', 250]);

  const closedNight = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-22', nights: 1, adults: 2 });
  assert.deepStrictEqual(closedNight.missing, ['2026-12-22'], 'закрита ніч не продається — вона в missing (інваріант 17)');
  assert.deepStrictEqual(closedNight.closed, ['2026-12-22'], 'і названа закритою, а не «неоціненою»');
  assert.strictEqual(stayRefusal(closedNight.restrictions, 1), 'closed');

  const span = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-21', nights: 3, adults: 2 });
  assert.deepStrictEqual(span.closed, ['2026-12-22'], 'закрита ніч усередині перебування названа');
  assert.strictEqual(span.nights.length, 2, 'дві відкриті ночі оцінені, закрита — ні');

  const arr20 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-20', nights: 2, adults: 2 });
  assert.strictEqual(arr20.restrictions.minStay, 2, 'мінімум — з ночі заїзду');
  assert.strictEqual(arr20.restrictions.noArrival, true, 'заборона заїзду — з ночі заїзду');
  assert.strictEqual(stayRefusal(arr20.restrictions, 2), 'no_arrival');

  const arr21 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-21', nights: 1, adults: 2 });
  assert.strictEqual(arr21.restrictions.minStay, 3, 'сусідній день має СВІЙ мінімум, не скопійований');
  assert.strictEqual(stayRefusal(arr21.restrictions, 1), 'min_stay', 'одна ніч там, де вимагали трьох, — відмова');

  const dep23 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-21', nights: 2, adults: 2 });
  assert.strictEqual(dep23.restrictions.noDeparture, true, 'заборона виїзду — з ДАТИ виїзду (23-го), не з ночі');
  const dep24 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-23', nights: 1, adults: 2 });
  assert.strictEqual(dep24.restrictions.noDeparture, false, 'виїзд 24-го дозволений');
  assert.strictEqual(dep24.restrictions.minStay, 1);

  const barClosedRow = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-20', nights: 1, adults: 2, ratePlanId: BAR });
  assert.deepStrictEqual(barClosedRow.closed, [], '«закрито» на рядку ТАРИФУ не читається: обмеження — на типі (П7)');
  assert.strictEqual(barClosedRow.nights[0]?.price, 250, 'ціна тарифу при цьому своя');
  console.log('  ok  Д1/Д2: закрита ніч не продається й названа; мінімум, максимум, заїзд, виїзд — з базового рядка типу');
}

// ── Ціна вихідних нуль — це не ціна (рецензія 2.0, 05.09.2026) ─────────────
//
// 0062 зробила нулем-що-не-ціна лише `base_price`; `weekend_price = 0`
// лишався читатися як ціна — і з пʼятниці по неділю ніч продавалась за нуль
// тим самим шляхом, який INC-017 закрив для буднів. Рядок пишеться повз
// писача (як міг зʼявитись у базі до відмови `price_not_positive`): пʼятниця
// 2026-11-20, будень 180, вихідні 0. Дві осі (інваріант 26): 180 і 0 —
// несумісні числа; з вихідними 130 той самий рядок дає 130.
await cal(BAR, '2026-11-20', 180);
await sql.run('UPDATE price_calendar SET weekend_price = 0 WHERE id = ?', [`pc_${BAR}_2026-11-20`]);
const zeroWeekend = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-20', nights: 1, adults: 2, ratePlanId: BAR });
assert.strictEqual(zeroWeekend.nights[0]?.price, 180, `ціна вихідних 0 мала читатись як «немає», не як ціна: ${JSON.stringify(zeroWeekend.nights[0])}`);
await sql.run('UPDATE price_calendar SET weekend_price = 130 WHERE id = ?', [`pc_${BAR}_2026-11-20`]);
const realWeekend = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-20', nights: 1, adults: 2, ratePlanId: BAR });
assert.strictEqual(realWeekend.nights[0]?.price, 130, 'а справжня ціна вихідних читається');
console.log('  ok  ціна вихідних 0 — не ціна: пʼятниця продається за буденну, справжня вихідна читається');

// ── Режим «за номер» (Блок 2.2): ціна не залежить від кількості гостей ──────
//
// Той самий рядок ціни 312.66 і та сама матриця (двоє 200, троє 260): тариф
// «за особу» дає трьом 372.66 (надбавка 60), тариф «за номер» — 312.66 і
// трьом, і одному. Так каже вендор про per_room: «price is equal to any
// count of allowed guests». Дві осі (інваріант 26): режим і заселеність —
// з одним режимом або однією заселеністю надбавка й нуль невідрізнювані.
const ROOM = '__np_check__rp_room';
await sql.run("INSERT INTO rate_plans (id, property_id, name, code, sell_mode) VALUES (?, ?, ?, ?, 'per_room')", [ROOM, PROP, 'Room rate', 'ROOM']);
await sql.run("UPDATE rate_plans SET sell_mode = 'per_person' WHERE id = ?", [BAR]);
await cal(ROOM, '2026-11-10', 312.66);
const room3 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 3, ratePlanId: ROOM });
const room1 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 1, ratePlanId: ROOM });
const person3 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 3, ratePlanId: BAR });
assert.strictEqual(room3.nights[0].price, 312.66, 'тариф «за номер» на трьох мав дати ціну номера без надбавки матриці');
assert.strictEqual(room1.nights[0].price, 312.66, '…і на одного — ту саму');
assert.strictEqual(person3.nights[0].price, 372.66, 'тариф «за особу» на трьох — з надбавкою матриці, як і досі');
assert.strictEqual(room3.occupancyPriced, true, '«за номер»: доплати за гостя не буває — викликач не має додавати extra_person_charge');
console.log('  ok  режим «за номер»: одна ціна на будь-яку кількість гостей; «за особу» — з надбавкою');

// ── Опція без рядка матриці — без ціни (розділ A п.3, 05.09.2026) ──────────
//
// Матриця знає двох (200) і трьох (260), чотирьох — ні. Тариф «за особу» на
// чотирьох брав ціну тарифу без надбавки — 312.66, тобто четверо ДЕШЕВШЕ за
// трьох (372.66). Це не ціна, якої готель називав (інваріант 17): для
// заселеності без рядка матриці джерела немає, ніч у `missing`, і в каналі
// така опція закривається. Тариф «за номер» тут ні при чому — його ціна не
// залежить від кількості гостей, четверо в нього коштують 312.66 (дві осі:
// режим і наявність рядка).
const person4 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 4, ratePlanId: BAR });
assert.deepStrictEqual(person4.missing, ['2026-11-10'],
  `«за особу» на чотирьох без рядка матриці мало лишити ніч без ціни, а дало ${JSON.stringify(person4.nights.map((n) => n.price))} — четверо дешевше за трьох`);
assert.deepStrictEqual(person4.nights, [], 'і жодної ціни в ночах');
const room4 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 4, ratePlanId: ROOM });
assert.strictEqual(room4.nights[0]?.price, 312.66, '«за номер» на чотирьох — ціна номера, матриця тут не джерело');
console.log('  ok  «за особу» без рядка матриці на цю кількість дорослих — ніч без ціни, не ціна тарифу; «за номер» — ціна номера');

// ── Надбавки за заселеність правилами (Блок 2 крок 3, Ц30) ─────────────────
//
// Правило перебиває матрицю: третій дорослий на BAR — +40 сумою (правило на
// тариф), а не 60 з матриці; дитина — 10 % від ціни ночі на будь-якому
// тарифі; «за номер» — дитяча надбавка є, дорослої немає; тариф без свого
// правила (B&B) для дорослих понад базу далі бере матрицю (перехід, доки
// періоди матриці не мігровано в сезони); дитина без правила — ніч без ціни
// з названою причиною. Дві ціни ночі (312.66 і 111) під відсотком — «% від
// ночі», не константа (інваріант 26).
await sql.run(
  `INSERT INTO extra_occupancy_rules (id, organization_id, property_id, rate_plan_id, unit_type_id, guest_kind, age_band_index, lodging_mode, lodging_value, meal_mode, meal_value, extra_bed)
   VALUES ('__np_rule_adult', ?, ?, ?, NULL, 'adult', NULL, 'fixed', 40, NULL, NULL, FALSE)`, [ORG, PROP, BAR]);
await sql.run(
  `INSERT INTO extra_occupancy_rules (id, organization_id, property_id, rate_plan_id, unit_type_id, guest_kind, age_band_index, lodging_mode, lodging_value, meal_mode, meal_value, extra_bed)
   VALUES ('__np_rule_child', ?, ?, NULL, NULL, 'child', NULL, 'percent', 10, NULL, NULL, FALSE)`, [ORG, PROP]);
const ruled3 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 3, ratePlanId: BAR });
assert.strictEqual(ruled3.nights[0]?.price, 352.66, `третій дорослий на BAR — правило +40, не матриця +60: ${JSON.stringify(ruled3.nights)}`);
assert.strictEqual(ruled3.occupancyPriced, true, 'доплата за гостя вже в ціні — викликач не додає extra_person_charge');
const ruledKid = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 2, children: 1, ratePlanId: BAR });
assert.strictEqual(ruledKid.nights[0]?.price, 343.93, `дитина — 10 % від 312.66 = 31.27: ${JSON.stringify(ruledKid.nights)}`);
const bnbKid = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 2, children: 1, ratePlanId: BNB });
assert.strictEqual(bnbKid.nights[0]?.price, 122.1, 'та сама дитина на B&B за 111 — 11.10: відсоток від ночі, не константа');
const roomKid = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 3, children: 1, ratePlanId: ROOM });
assert.strictEqual(roomKid.nights[0]?.price, 343.93, '«за номер»: дитина доплачує, третій дорослий — ні');
const bnb3Ruled = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 3, ratePlanId: BNB });
assert.strictEqual(bnb3Ruled.nights[0]?.price, 171, 'B&B без свого правила для дорослих — матриця (+60), як і досі');
await sql.run("DELETE FROM extra_occupancy_rules WHERE id = '__np_rule_child'");
const noKidRule = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 2, children: 1, ratePlanId: BAR });
assert.deepStrictEqual(noKidRule.missing, ['2026-11-10'], 'дитина без правила — ніч без ціни, не безкоштовна дитина');
assert.strictEqual(noKidRule.childRuleMissing, true, 'і причина названа');
await sql.run("DELETE FROM extra_occupancy_rules WHERE organization_id = ?", [ORG]);
console.log('  ok  надбавки правилами: дорослий понад базу за правилом, дитина відсотком від ночі, «за номер» без дорослої, без правила — без ціни');

// ── Правила цін і промо (Блок 2 крок 4, Ц31) ───────────────────────────────
//
// Правило діє ПІСЛЯ надбавок за заселеність і ДО зборів: −10 % від 3 ночей на
// BAR, промо SUMMER −20 сумою лише з кодом, «вихідні +50» лише на ніч
// пʼятниці/суботи. Канал (без дати бронювання) не бачить правила «за 30 днів».
// Дві ціни ночі під відсотком (312.66 і 111) — «% від ночі» (інваріант 26).
await sql.run(
  `INSERT INTO price_rules (id, organization_id, property_id, name, kind, action, value, value_kind, min_los, priority)
   VALUES ('__np_rule_los', ?, ?, 'Від 3 ночей', 'rule', 'decrease', 10, 'percent', 3, 10)`, [ORG, PROP]);
await sql.run(
  `INSERT INTO price_rules (id, organization_id, property_id, name, kind, code, action, value, value_kind, priority)
   VALUES ('__np_rule_promo', ?, ?, 'Літо', 'promo', 'SUMMER', 'decrease', 20, 'fixed', 20)`, [ORG, PROP]);
await sql.run(
  `INSERT INTO price_rules (id, organization_id, property_id, name, kind, action, value, value_kind, week_days, priority)
   VALUES ('__np_rule_wknd', ?, ?, 'Вихідні', 'rule', 'increase', 50, 'fixed', '[5,6]', 30)`, [ORG, PROP]);
await sql.run(
  `INSERT INTO price_rules (id, organization_id, property_id, name, kind, action, value, value_kind, booked_days_before_from, priority)
   VALUES ('__np_rule_eb', ?, ?, 'Раннє', 'rule', 'decrease', 5, 'percent', 30, 40)`, [ORG, PROP]);
// 2026-11-10 — вівторок; три ночі BAR: 10, 11 (312.66), 12 (база 200). Заброньовано за 5 днів — EB не діє.
const ruled = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 3, adults: 2, ratePlanId: BAR, bookedAt: '2026-11-05', channel: 'operator' });
assert.strictEqual(ruled.nights[0]?.price, 281.39, `−10 % від 312.66 = 281.39: ${JSON.stringify(ruled.nights)}`);
assert.strictEqual(ruled.nights[2]?.price, 180, '−10 % від базових 200 — відсоток від ночі, не константа');
assert.deepStrictEqual(ruled.nights[0]?.rules?.map((r) => [r.ruleId, r.delta]), [['__np_rule_los', -31.27]], 'розклад називає правило і дельту');
assert.strictEqual(ruled.nights[0]?.priceBeforeRules, 312.66, 'ціна до правил збережена для розкладу');
const twoNights = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 2, adults: 2, ratePlanId: BAR, bookedAt: '2026-11-05', channel: 'operator' });
assert.strictEqual(twoNights.nights[0]?.price, 312.66, 'дві ночі — правило «від 3» не діє');
const withPromo = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 2, ratePlanId: BNB, bookedAt: '2026-11-05', channel: 'direct', promoCode: 'summer' });
assert.strictEqual(withPromo.nights[0]?.price, 91, 'промо з кодом: 111 − 20 = 91');
assert.strictEqual((await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, adults: 2, ratePlanId: BNB, bookedAt: '2026-11-05', channel: 'direct' })).nights[0]?.price, 111, 'без коду промо не діє');
const friday = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-13', nights: 1, adults: 2, bookedAt: '2026-11-05', channel: 'operator' });
assert.strictEqual(friday.nights[0]?.price, 250, 'пʼятниця 13.11 — базова 200 + 50 «вихідні»');
const early = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-13', nights: 1, adults: 2, bookedAt: '2026-10-01', channel: 'operator' });
assert.strictEqual(early.nights[0]?.price, 237.5, 'за 43 дні: пріоритет «вихідні» (30) раніше за «раннє» (40): 200 + 50 = 250, потім −5 % = 237.5 — не 240');
const channel = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-13', nights: 1, adults: 2, bookedAt: null, channel: 'channel' });
assert.strictEqual(channel.nights[0]?.price, 250, 'канал без дати бронювання: «вихідні» діє, «раннє» — ні');
assert.strictEqual(ruled.rulesApplied?.find((r) => r.ruleId === '__np_rule_los')?.total, -82.54, `сума правила по поїздці: −31.27 −31.27 −20: ${JSON.stringify(ruled.rulesApplied)}`);
assert.strictEqual(ruled.totalBeforeRules, 825.32, 'сума до правил збережена: 312.66 + 312.66 + 200');
assert.strictEqual(ruled.total, 742.78, 'сума після правил');
await sql.run("DELETE FROM price_rules WHERE organization_id = ?", [ORG]);
console.log('  ok  правила цін: після надбавок, за пріоритетом, промо лише з кодом, EB/LM не в канал');

// ── Викликач без `adults` — відмова з назвою, не «неоцінені ночі» ─────────
//
// 02.09.2026: `scripts/apply-hotel.mjs` після Ц12 передавав `persons`, не
// `adults`; котирування мовчки віддавало кожну ніч як `missing`, і три тижні
// це бачила лише задача CI на Postgres. Інваріант 13 у мініатюрі: те, чого
// не назвали, відмовляє вголос, а не вдає порожній календар.
await assert.rejects(
  () => priceNights({ unitTypeId: TYPE, checkIn: '2026-12-20', nights: 1, persons: 2 } as any),
  /adults/,
  'без `adults` котирування мусить відмовити, назвавши поле — інакше стара сигнатура тихо дає «неоцінені ночі»',
);
console.log('  ok  виклик без adults відмовляє з назвою поля');

