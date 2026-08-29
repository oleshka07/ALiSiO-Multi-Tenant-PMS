/**
 * Наявність рахується один раз і однаково.
 *
 *   node src/modules/properties/data/availability.check.ts
 *
 * Розрахунок «чи вільно» переїхав із обробника віджета сюди, щоб батчер ARI
 * не заводив другий. Помилка тут дорожча за звичайну: число, відправлене в
 * канал, — це те, за чим OTA продає. Завищили на одиницю — овербукінг і
 * компенсація гостю; занизили — номер стоїть порожній.
 *
 * Тому перевірка ганяє справжню SQLite, а не підробку: уся логіка тут — це
 * SQL і межі діапазонів, і саме вони ламаються. Підроблений `sql` перевіряв
 * би форму виклику, а не відповідь.
 *
 * Що тримаємо:
 *   - ніч виїзду вільна (півінтервал), бо це класичне «на одну добу більше»;
 *   - скасування і неявка звільняють номер, інакше фонд тане з кожним
 *     скасуванням;
 *   - блокування рахується нарівні з бронню;
 *   - бронь, що виходить за вікно запиту, обрізається, а не зникає;
 *   - тип із нулем вільних лишається у відповіді з нулем — канал мусить
 *     почути «нуль», інакше продаватиме за старим числом;
 *   - віджетова відповідь вимагає ВЕСЬ діапазон вільним;
 *   - службовий фонд (неактивний, накопичувач, не для онлайну) у канал не
 *     їде.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Аліаси спершу, потім усе, що їх потребує: статичний імпорт аліасованого
// модуля піднявся б вище цього рядка і не знайшовся б.
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-avail-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { availabilityByDay, freeUnitsForRange } = await import('./availability.ts');

const sql = getSql();
const ORG = '__avail_check__org';
const PROP = '__avail_check__prop';
const CAT = '__avail_check__cat';
const TYPE_A = '__avail_check__type_a';   // два номери, обидва продаються
const TYPE_B = '__avail_check__type_b';   // один номер
const GUEST = '__avail_check__guest';

await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [ORG, 'Avail', ORG]);
await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, ORG, 'Avail', ORG]);
await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [CAT, PROP, 'Rooms', 'room']);

for (const [id, name] of [[TYPE_A, 'A'], [TYPE_B, 'B']] as const) {
  await sql.run(
    'INSERT INTO unit_types (id, property_id, category_id, name, code, bookable_online) VALUES (?, ?, ?, ?, ?, TRUE)',
    [id, PROP, CAT, name, name],
  );
}
// Тип, який рецепція продає, а онлайн — ні. У відповідь потрапити не має.
const TYPE_OFFLINE = '__avail_check__type_off';
await sql.run(
  'INSERT INTO unit_types (id, property_id, category_id, name, code, bookable_online) VALUES (?, ?, ?, ?, ?, FALSE)',
  [TYPE_OFFLINE, PROP, CAT, 'Offline', 'OFF'],
);

const unit = async (id: string, typeId: string, extra: Record<string, unknown> = {}) => {
  const cols = ['id', 'property_id', 'unit_type_id', 'category_id', 'name', 'code', ...Object.keys(extra)];
  const vals = [id, PROP, typeId, CAT, id, id, ...Object.values(extra)];
  await sql.run(`INSERT INTO units (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
};

await unit('a1', TYPE_A);
await unit('a2', TYPE_A);
await unit('b1', TYPE_B);
// Тип, на якому перевіряються ОБИДВІ межі вікна запиту: бронь, що
// закінчується рівно на його початку, і бронь, що починається рівно на його
// кінці. Обидві не мають займати жодної ночі всередині.
const TYPE_EDGE = '__avail_check__type_edge';
await sql.run(
  'INSERT INTO unit_types (id, property_id, category_id, name, code, bookable_online) VALUES (?, ?, ?, ?, ?, TRUE)',
  [TYPE_EDGE, PROP, CAT, 'Edge', 'EDGE'],
);
await unit('e1', TYPE_EDGE);
await unit('dead', TYPE_A, { is_active: false });        // вимкнений
await unit('pool', TYPE_A, { is_pool: true });           // віртуальний накопичувач
await unit('off1', TYPE_OFFLINE);                        // тип не для онлайну

await sql.run('INSERT INTO guests (id, organization_id, first_name, last_name) VALUES (?, ?, ?, ?)', [GUEST, ORG, 'A', 'B']);

const book = async (id: string, unitId: string, from: string, to: string, status = 'confirmed') =>
  sql.run(
    `INSERT INTO reservations (id, organization_id, property_id, unit_id, guest_id, check_in, check_out, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ORG, PROP, unitId, GUEST, from, to, status],
  );

// a1 зайнятий 10→12: ночі 10 і 11. 12-те має бути вільним.
await book('r1', 'a1', '2026-09-10', '2026-09-12');
// Скасована і неявка не займають нічого.
await book('r2', 'a2', '2026-09-10', '2026-09-12', 'cancelled');
await book('r3', 'a2', '2026-09-11', '2026-09-12', 'no_show');
// b1 зайнятий бронню, що починається ДО вікна і тягнеться за нього.
await book('r4', 'b1', '2026-09-01', '2026-10-01');
// Дві броні, що ТОРКАЮТЬСЯ вікна [10, 13), не заходячи в нього: перша
// виїжджає рівно 10-го, друга заїжджає рівно 13-го. Якщо межа перетину
// зсунеться на `<=`/`>=`, e1 почне рахуватись зайнятим — і готель
// недопродасть номер у обидва кінці сезону.
await book('r5', 'e1', '2026-09-08', '2026-09-10');
await book('r6', 'e1', '2026-09-13', '2026-09-15');

const byDay = await availabilityByDay(PROP, '2026-09-10', '2026-09-13');

const a = byDay.get(TYPE_A)!;
assert.ok(a, 'тип A зник із відповіді');
assert.strictEqual(a.get('2026-09-10'), 1, 'ніч заїзду: a1 зайнятий, вільний лише a2');
assert.strictEqual(a.get('2026-09-11'), 1, 'друга ніч: a1 ще зайнятий');
assert.strictEqual(a.get('2026-09-12'), 2, 'ніч ВИЇЗДУ має бути вільна — півінтервал [from, to)');

const b = byDay.get(TYPE_B)!;
assert.ok(b, 'тип із нулем вільних зник із відповіді — канал не почує «нуль»');
for (const d of ['2026-09-10', '2026-09-11', '2026-09-12']) {
  assert.strictEqual(b.get(d), 0, `${d}: бронь поза вікном мала обрізатись, а не зникнути`);
}

const e = byDay.get(TYPE_EDGE)!;
assert.ok(e, 'тип E зник із відповіді');
for (const d of ['2026-09-10', '2026-09-11', '2026-09-12']) {
  assert.strictEqual(e.get(d), 1, `${d}: бронь, що лише ТОРКАЄТЬСЯ вікна, зайняла ніч усередині`);
}

assert.strictEqual(byDay.size, 3, 'у відповідь потрапив службовий фонд або тип не для онлайну');
assert.ok(!byDay.has(TYPE_OFFLINE), 'тип без bookable_online поїхав би в канал');

// Вимкнений номер і накопичувач не додають фонду: інакше тип A мав би 4.
assert.strictEqual(a.get('2026-09-12'), 2, 'вимкнений номер або накопичувач порахувались як фонд');

// Блокування рахується нарівні з бронню.
await sql.run(
  'INSERT INTO availability_blocks (id, organization_id, unit_id, date_from, date_to) VALUES (?, ?, ?, ?, ?)',
  ['__avail_check__blk', ORG, 'a2', '2026-09-12', '2026-09-13'],
);
const afterBlock = await availabilityByDay(PROP, '2026-09-10', '2026-09-13');
assert.strictEqual(
  afterBlock.get(TYPE_A)!.get('2026-09-12'), 1,
  'блокування не зменшило наявність — номер у ремонті поїхав би в продаж',
);

// Порожній і зворотний діапазон — це відсутність питання, а не нуль вільних.
assert.strictEqual((await availabilityByDay(PROP, '2026-09-10', '2026-09-10')).size, 0, 'нуль ночей дав відповідь');
assert.strictEqual((await availabilityByDay(PROP, '2026-09-13', '2026-09-10')).size, 0, 'зворотний діапазон дав відповідь');

// Віджетова відповідь: вільний на ВЕСЬ заїзд.
//
// Блокування, поставлене вище, стоїть на ніч 12-го. Заїзд 10→12 цю ніч НЕ
// займає, заїзд 10→13 — займає. Та сама межа, з обох боків: саме на ній
// ламається «на одну добу більше».
const all = ['a1', 'a2', 'b1'];
const free1012 = await freeUnitsForRange(all, '2026-09-10', '2026-09-12');
assert.ok(!free1012.has('a1'), 'a1 зайнятий обидві ночі, а показаний вільним');
assert.ok(free1012.has('a2'), 'блок на ніч 12-го не має займати заїзд 10→12');
assert.ok(!free1012.has('b1'), 'b1 зайнятий увесь місяць');

const free1013 = await freeUnitsForRange(['a2'], '2026-09-10', '2026-09-13');
assert.strictEqual(free1013.size, 0, 'заїзд, що ЗАХОПЛЮЄ ніч блокування, мав бути відкинутий');

// Ті самі дві межі для віджетової відповіді: виїзд попереднього гостя рівно
// в день заїзду і заїзд наступного рівно в день виїзду — номер вільний.
assert.ok(
  (await freeUnitsForRange(['e1'], '2026-09-10', '2026-09-13')).has('e1'),
  'номер, що звільняється в день заїзду і зайнятий лише з дня виїзду, показаний зайнятим',
);

// Без дат питання про зайнятість немає — повертаються всі передані.
assert.strictEqual((await freeUnitsForRange(all, '2026-09-10', '2026-09-10')).size, 3, 'нуль ночей мав повернути всі номери');
assert.strictEqual((await freeUnitsForRange([], '2026-09-10', '2026-09-13')).size, 0, 'порожній список мав лишитись порожнім');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('availability: all checks passed');
