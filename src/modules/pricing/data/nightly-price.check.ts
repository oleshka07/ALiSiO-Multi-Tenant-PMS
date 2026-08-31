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
  'INSERT INTO unit_types (id, property_id, category_id, name, code, base_occupancy) VALUES (?, ?, ?, ?, ?, ?)',
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
const bar2 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, persons: 2, ratePlanId: BAR });
const bnb2 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, persons: 2, ratePlanId: BNB });
assert.strictEqual(bar2.nights[0].price, 312.66, 'BAR мав коштувати свою ціну, а не базову');
assert.strictEqual(bnb2.nights[0].price, 111, 'B&B мав коштувати свою ціну, а не базову');
assert.strictEqual(bar2.nights[0].source, 'rate_plan', 'джерелом ночі мав бути тариф');
assert.notStrictEqual(bar2.nights[0].price, bnb2.nights[0].price, 'два тарифи однієї доби дали однакову ціну');

// ── Ціна тарифу перекриває базову; відсутня — падає на базову ──────────────
// 10–11 листопада BAR має свою ціну, 12–13 — ні. Перевіряємо весь заїзд
// одним викликом, бо саме на межі діапазону це й ламається.
const mixed = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 4, persons: 2, ratePlanId: BAR });
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
const plain = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 4, persons: 2 });
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

const bar3 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, persons: 3, ratePlanId: BAR });
const bnb3 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, persons: 3, ratePlanId: BNB });
assert.strictEqual(bar3.nights[0].price, 372.66, 'BAR на трьох мав отримати надбавку 60 понад свою ціну');
assert.strictEqual(bnb3.nights[0].price, 171, 'B&B на трьох мав отримати ТУ САМУ надбавку 60');
assert.strictEqual(
  bar3.nights[0].price - 312.66,
  bnb3.nights[0].price - 111,
  'надбавка за заселеність розійшлася між тарифами — вона мусить бути спільною',
);
assert.strictEqual(bar3.occupancyPriced, true, 'ніч із надбавкою з матриці мала позначитись occupancyPriced');

// Заселеність, якої матриця не знає (четверо): ціна тарифу стоїть сама, і
// occupancyPriced лишається false — щоб виклик далі додав extra_person_charge,
// рівно як він робить для звичайної календарної ночі.
const bar4 = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, persons: 4, ratePlanId: BAR });
assert.strictEqual(bar4.nights[0].price, 312.66, 'без рядка матриці ціна тарифу мала лишитись без надбавки');
assert.strictEqual(bar4.occupancyPriced, false, 'невідома надбавка не має видавати себе за пораховану заселеність');

// На двох (= base_occupancy) надбавки немає за визначенням, і матриця тут
// нічого не міняє: 312.66 лишається 312.66.
const bar2again = await priceNights({ unitTypeId: TYPE, checkIn: '2026-11-10', nights: 1, persons: 2, ratePlanId: BAR });
assert.strictEqual(bar2again.nights[0].price, 312.66, 'заселеність, що дорівнює базовій, не має міняти ціну тарифу');

// ── Ніч, якої не знає жодне джерело ────────────────────────────────────────
// Заселеність 5 — матриця має рядки лише на 2 і 3; дата 1 грудня — календар
// не має жодного рядка, ні базового, ні тарифного. Матриця тут відповідає на
// БУДЬ-ЯКУ дату, бо її рядки безстрокові, тож «діру» треба робити по
// заселеності, а не лише по даті.
const gap = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-01', nights: 1, persons: 5, ratePlanId: BAR });
assert.deepStrictEqual(gap.missing, ['2026-12-01'], 'ніч без жодного джерела мала лишитись missing');
assert.strictEqual(gap.nights.length, 0, 'ніч без ціни не має потрапляти в результат');
assert.strictEqual(gap.total, 0, 'вигадана сума на ніч без ціни');

// Дзеркало до попереднього: та сама дата на двох матриця ЗНАЄ (рядок
// безстроковий), тож missing там не буде. Це не дублікат — це те, що робить
// перевірку вище чесною: діра має бути справжньою, а не наслідком дати.
const notGap = await priceNights({ unitTypeId: TYPE, checkIn: '2026-12-01', nights: 1, persons: 2, ratePlanId: BAR });
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

fs.rmSync(tmp, { recursive: true, force: true });
console.log('nightly-price: all checks passed');
