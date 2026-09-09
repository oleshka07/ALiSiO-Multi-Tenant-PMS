/**
 * Область обʼєкта: тип обмежує запит, а відсутність — не відповідь.
 *
 *   node src/core/property-scope.check.ts
 *
 * Дві речі перевіряються тут, і обидві — на СПРАВЖНІЙ базі, а не на підробці:
 *
 *   1. **Фікстура не вироджена.** «Одна організація, два обʼєкти» коштує
 *      рівно стільки, скільки в ній різних значень осі. Числа читаються
 *      НАЗАД із бази, а не з обʼєкта, який повернув засів: інакше твердження
 *      перевіряло б саме себе.
 *   2. **`propertyScopeFilter` справді ріже.** `{ kind: 'one' }` віддає лише
 *      свої 5 (або 7), `ALL_PROPERTIES` — усі 12. Саме 5/7/12, бо на 2 і 2
 *      «врахував вісь» і «забув вісь» дають те саме число (інваріант 26).
 *
 * І третя, менша: відсутність області не буває мовчазним «усі». З одним
 * обʼєктом вона — той обʼєкт, з кількома — 400, чужий id — 404 (інваріанти 8,
 * 13, 5).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Аліаси спершу: статичний імпорт аліасованого модуля піднявся б вище цього
// рядка і не знайшовся б.
import '../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-propscope-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, assertNotDegenerate } = await import('./fixtures/two-properties.ts');
const {
  ALL_PROPERTIES, oneProperty, propertyOrSharedFilter, propertyScopeFilter, requirePropertyScope,
  requestedPropertyParam, scopedPropertyId,
} = await import('./property-scope.ts');

const sql = getSql();
const fx = await seedTwoProperties();

// ─── 1. Фікстура: числа з БАЗИ, не з обʼєкта засіву ─────────────────────────

const countUnits = async (propertyId: string) => Number(
  (await sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM units WHERE property_id = ?', [propertyId]))!.n,
);

assert.strictEqual(await countUnits(fx.a.id), 5, 'обʼєкт А мав отримати 5 номерів');
assert.strictEqual(await countUnits(fx.b.id), 7, 'обʼєкт Б мав отримати 7 номерів');
assert.strictEqual(
  Number((await sql.row<{ n: number }>(
    `SELECT COUNT(*) AS n FROM units
     WHERE property_id IN (SELECT id FROM properties WHERE organization_id = ?)`,
    [fx.organizationId],
  ))!.n),
  12, 'разом мало вийти 12 — число, яким не є жоден обʼєкт',
);
assert.strictEqual(fx.totalUnits, 12, 'фікстура рахує свої номери не так, як база');

// Типи, ціни і збір теж різняться — вісь несе не лише кількість номерів.
const typeCount = async (propertyId: string) => Number(
  (await sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM unit_types WHERE property_id = ?', [propertyId]))!.n,
);
assert.strictEqual(await typeCount(fx.a.id), 2, 'у А мало бути два типи');
assert.strictEqual(await typeCount(fx.b.id), 1, 'у Б мав бути один тип');

// Грошова вісь — колонками, які не є ціновими таблицями: інваріант 16 каже,
// що `price_calendar`/`price_occupancy`/`price_los_tiers` питає лише
// `modules/pricing`, і фікстура в ядрі другого джерела ціни не заводить.
const chargeOf = async (propertyId: string) => Number(
  (await sql.row<{ p: number }>(
    'SELECT MIN(extra_person_charge) AS p FROM unit_types WHERE property_id = ?', [propertyId],
  ))!.p,
);
assert.strictEqual(await chargeOf(fx.a.id), 300, 'надбавка за особу в А');
assert.strictEqual(await chargeOf(fx.b.id), 900, 'надбавка Б — чуже число тут було б видимою вадою');

const stayTotalOf = async (propertyId: string) => Number(
  (await sql.row<{ t: number }>(
    'SELECT MAX(total_price) AS t FROM reservations WHERE property_id = ?', [propertyId],
  ))!.t,
);
assert.strictEqual(await stayTotalOf(fx.a.id), 1000, 'сума броні в А');
assert.strictEqual(await stayTotalOf(fx.b.id), 3300, 'сума броні в Б');

assert.strictEqual(
  Number((await sql.row<{ n: number }>('SELECT COUNT(*) AS n FROM reservations WHERE property_id = ?', [fx.b.id]))!.n),
  3, 'у Б мало бути три броні',
);

console.log('  ok  фікстура: 5 і 7 номерів, 2 і 1 типи, 300 і 900 надбавки, 1000 і 3300 суми, 2 і 3 броні');

// ─── 2. Фільтр справді ріже ─────────────────────────────────────────────────
//
// Запит навмисно такий самий за формою, як у репозиторії: спершу вісь
// ОРЕНДАРЯ, потім вісь ОБʼЄКТА, фрагмент і його параметри приклеюються до вже
// наявних. Якби фільтр «усіх» повертав порожній рядок, саме тут би це й
// зламалось — `AND` перед нічим.
//
// Дві осі в одному запиті — не надмірність. `ALL_PROPERTIES` означає «усі
// обʼєкти ЦЬОГО рахунку», і сам по собі фільтр обʼєкта орендаря не тримає:
// без першого рядка цей запит на порожній базі віддав би ще й 12 номерів
// демо-засіву, тобто «усі» означало б чуже.

const unitsInScope = async (scope: Parameters<typeof scopedPropertyId>[0]) => {
  const filter = propertyScopeFilter(scope, 'u');
  const rows = await sql.rows<{ id: string }>(
    `SELECT u.id FROM units u
     WHERE u.is_active = TRUE
       AND u.property_id IN (SELECT id FROM properties WHERE organization_id = ?)
       AND ${filter.sql}
     ORDER BY u.id`,
    [fx.organizationId, ...filter.params],
  );
  return rows.length;
};

const inA = await unitsInScope(oneProperty(fx.a.id));
const inB = await unitsInScope(oneProperty(fx.b.id));
const inAll = await unitsInScope(ALL_PROPERTIES);

assert.strictEqual(inA, 5, `очікували 5 номерів обʼєкта А, отримали ${inA}`);
assert.strictEqual(inB, 7, `очікували 7 номерів обʼєкта Б, отримали ${inB}`);
assert.strictEqual(inAll, 12, `«усі обʼєкти» мали дати 12, отримали ${inAll}`);

// Область без псевдоніма — та сама, тільки колонка гола: репозиторії пишуть
// і так, і так.
const bare = propertyScopeFilter(oneProperty(fx.a.id), '');
assert.strictEqual(bare.sql, 'property_id = ?', 'без псевдоніма фільтр не має чіпляти крапку');
assert.deepStrictEqual(bare.params, [fx.a.id], 'параметр мав бути рівно один — id обʼєкта');
assert.deepStrictEqual(propertyScopeFilter(ALL_PROPERTIES, 'u').params, [],
  '«усі» не мають параметрів — зайвий зсунув би решту');

assert.strictEqual(scopedPropertyId(oneProperty(fx.a.id)), fx.a.id);
assert.strictEqual(scopedPropertyId(ALL_PROPERTIES), null, '«усі» не мають id — і не мають його вигадувати');

console.log('  ok  {kind:one} віддає 5 і 7, ALL_PROPERTIES — 12');

// ─── 2.1. Другі двері: NULL означає «спільне для рахунку» ──────────────────
//
// Для `tasks` і `task_projects` NULL у `property_id` — не «забули», а «задача
// рахунку»: «оновити прайс на сайті» не належить жодному будинку і тому
// належить кожному. `propertyScopeFilter` тихо сховав би такі рядки, і саме
// тому дверей двоє (О14).
//
// Тут — ФОРМА фрагмента, без бази. Поведінку («спільний рядок видно з кожного
// обʼєкта, суворі двері його не показують») стверджує сцена того модуля, чия
// таблиця це робить: `modules/tasks/data/tasks.scope.check.ts`, числа 4/5/7
// проти 2. Так навмисно: `INSERT INTO tasks` із ядра зробив би `core` другим
// писачем таблиці, і `check-boundaries` перестав би вважати її власністю
// модуля — гейт «покращився» б від зміни, яка нічого не лагодить (INC-018).

const sharedOne = propertyOrSharedFilter(oneProperty('__prop_x'), 't');
assert.strictEqual(sharedOne.sql, '(t.property_id = ? OR t.property_id IS NULL)',
  'другі двері мусять пускати рядки без обʼєкта — інакше вони те саме, що суворі');
assert.deepStrictEqual(sharedOne.params, ['__prop_x'], 'параметр мав бути рівно один — id обʼєкта');

const strictOne = propertyScopeFilter(oneProperty('__prop_x'), 't');
assert.strictEqual(strictOne.sql, 't.property_id = ?',
  'суворі двері мусять лишитись суворими — інакше різниці між дверима немає');
assert.notStrictEqual(sharedOne.sql, strictOne.sql, 'двоє дверей видали однаковий фрагмент');

assert.strictEqual(propertyOrSharedFilter(ALL_PROPERTIES, 't').sql, 'TRUE',
  '«усі обʼєкти» мали лишитись тим самим TRUE в обох дверях');
assert.deepStrictEqual(propertyOrSharedFilter(ALL_PROPERTIES, 't').params, [],
  '«усі» не мають параметрів — зайвий зсунув би решту');

// Без псевдоніма — гола колонка, як і в суворих дверях.
assert.strictEqual(propertyOrSharedFilter(oneProperty('__prop_x'), '').sql,
  '(property_id = ? OR property_id IS NULL)', 'без псевдоніма фрагмент не має чіпляти крапку');

console.log('  ok  другі двері (О14): (property_id = ? OR IS NULL), «усі» — те саме TRUE');

// ── Пропущена область — відмова, а не «усі обʼєкти» ─────────────────────────
//
// `tsc` тримає це в TypeScript і НІДЕ БІЛЬШЕ: scripts/*.mjs ходять у ті самі
// репозиторії через хук аліасів, тобто без типів. 09.09.2026 apply-hotel.mjs
// кликав listCategories(organizationId) з одним аргументом — заведення КОЖНОГО
// готелю падало, і повідомлення `Cannot read properties of undefined (reading
// 'kind')` не називало ні дверей, ні винного. Чотири коміти CI був червоний.
//
// Твердження тут — про ОБИДВІ половини: (1) відмова є, (2) вона не мовчазне
// «усі обʼєкти». Друга половина важливіша: `scope ?? ALL_PROPERTIES` виглядало
// б доброзичливо і зробило б із забутого аргументу рівно ту ваду, від якої весь
// INC-029 (інваріант 8).
for (const [name, door] of [
  ['propertyScopeFilter', propertyScopeFilter],
  ['propertyOrSharedFilter', propertyOrSharedFilter],
] as const) {
  for (const missing of [undefined, null, {}, 'prop_1']) {
    assert.throws(
      () => (door as (s: unknown, a: string) => unknown)(missing, 'u'),
      (e: unknown) => e instanceof TypeError && String((e as Error).message).includes(name),
      `${name} прийняв ${JSON.stringify(missing) ?? 'undefined'} замість області`);
  }
}
console.log('  ok  пропущена область — названа відмова від самих дверей, не «усі обʼєкти»');

// ─── 3. Відсутність області — не «усі» ──────────────────────────────────────

const status = (e: unknown) => (e as { status?: number }).status;

await runWithOrganization(fx.organizationId, async () => {
  assert.deepStrictEqual(await requirePropertyScope('all'), ALL_PROPERTIES, '«all» словом — це «усі»');
  assert.deepStrictEqual(await requirePropertyScope(fx.b.id), oneProperty(fx.b.id), 'свій id — це він сам');

  await assert.rejects(
    () => requirePropertyScope(),
    (e: unknown) => status(e) === 400,
    'два обʼєкти й нічого не сказано — мало бути 400, а не мовчазне «усі»',
  );

  await assert.rejects(
    () => requirePropertyScope('__two_props__nobody'),
    (e: unknown) => status(e) === 404,
    'чужий або видалений id — 404 (інваріант 5), і точно не «отже, всі» (інваріант 13)',
  );
});

// Сусідня організація з ОДНИМ обʼєктом: там обирати нема з чого, і мовчання
// законне. Друга організація потрібна ще й для того, щоб доводити, що чужий
// обʼєкт не стає областю: з однією організацією таке твердження порожнє.
const SOLO = '__two_props__solo';
await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [SOLO, 'Solo', SOLO]);
await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
  [`${SOLO}_prop`, SOLO, 'Solo', SOLO]);

await runWithOrganization(SOLO, async () => {
  assert.deepStrictEqual(
    await requirePropertyScope(), oneProperty(`${SOLO}_prop`),
    'з одним обʼєктом мовчання — це він; вимагати параметр означало б зламати кожен екран',
  );
  await assert.rejects(
    () => requirePropertyScope(fx.a.id),
    (e: unknown) => status(e) === 404,
    'чужий обʼєкт не стає областю навіть у тієї організації, у якої свій один',
  );
});

console.log('  ok  немає області: один обʼєкт — він; кілька — 400; чужий — 404');

// ─── 3.1. Дві назви параметра, і жодна не помилка ──────────────────────────
//
// `?property=` пише провайдер в адресу вкладки, `?property_id=` шлють fetch-и
// чотирнадцяти екранів. Найважливіше тут — розрізнити ТРИ стани, які легко
// зливаються в один: сказано id, сказано «усі», не сказано нічого. Саме
// злиття другого з третім і було вадою: порожнє поле форми означало б
// «памʼятай, що я обрав минулого разу» замість «покажи всі».

const p = (query: string) => requestedPropertyParam(`https://alisio.test/api/units${query}`);

assert.strictEqual(p('?property_id=abc'), 'abc', 'fetch-параметр не прочитано');
assert.strictEqual(p('?property=abc'), 'abc', 'параметр адреси не прочитано');
assert.strictEqual(p('?property_id=abc&property=zzz'), 'abc', 'при обох мав перемогти той, що шлють fetch-и');
assert.strictEqual(p('?property_id='), '', 'порожній параметр — це сказане «усі», а не мовчання');
assert.strictEqual(p('?property=all'), 'all', '«all» словом мало доїхати як є');
assert.strictEqual(p(''), null, 'без параметра мало бути мовчання, а не «усі»');
assert.strictEqual(p('?category=room'), null, 'чужий параметр прочитано як область');

await runWithOrganization(fx.organizationId, async () => {
  assert.deepStrictEqual(
    await requirePropertyScope(p('?property_id=') ?? undefined), ALL_PROPERTIES,
    'порожній параметр мав дати «усі обʼєкти»',
  );
});

console.log('  ok  дві назви параметра: property_id перемагає, порожній = «усі», відсутній = мовчання');

// ─── 4. Сторож виродження сам уміє червоніти ────────────────────────────────
//
// §3.2: перевірка, яка ніколи не була червоною, доводить лише, що вона
// запускається. Тут вона червоніє на вимогу — на фікстурі, зведеній до одного
// значення осі.

// Кличеться САМ сторож із фікстури, не його копія: перевірка, що повторює
// тіло того, що перевіряє, доводить збіг двох копій, а не поведінку.
assert.throws(
  () => assertNotDegenerate({ ...fx, b: { ...fx.b, unitIds: fx.a.unitIds.slice() } }),
  /вироджена по «номерів»/,
  'сторож виродження мовчить, коли в обох обʼєктах по 5 номерів',
);
assert.throws(
  () => assertNotDegenerate({ ...fx, b: { ...fx.b, stayTotal: fx.a.stayTotal } }),
  /вироджена по «суми броні»/,
  'сторож дивиться лише на номери — а сума броні йде у звіт по обʼєкту',
);
// І мовчить на справжній: сторож, який червоніє завжди, теж нічого не тримає.
assert.doesNotThrow(() => assertNotDegenerate(fx), 'сторож червоніє на здоровій фікстурі');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('property-scope: усі перевірки пройдено');
