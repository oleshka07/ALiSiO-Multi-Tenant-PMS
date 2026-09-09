/**
 * Типи номерів і категорії — теж списки ОДНОГО обʼєкта.
 *
 *   node src/modules/properties/data/property-lists.check.ts
 *
 * Один файл на два списки навмисно: вони сидять на одній осі, на одній
 * фікстурі й ламаються однаково, а кожен окремий `.check.ts` піднімає свою
 * SQLite і мігрує її з нуля. Різні твердження — різні сцени всередині.
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * Обидва списки обмежувались `propertyScopeSql(...)` — віссю ОРЕНДАРЯ. У
 * шапці `unit-types.repo.ts` про цю саму функцію вже написано, як вона одного
 * разу не спрацювала («`organizationId` приходив аргументом, `propertyScopeSql`
 * був імпортований, і в запиті не використовувався жоден із них»), і вада
 * вилізла тоді, коли другий готель дістав такий самий код типу, як перший, і
 * зацінив свої ночі з чужої матриці. Вісь обʼєкта — той самий клас на один
 * рівень нижче: усередині ОДНОГО рахунку.
 *
 * ── Чому числа саме такі ────────────────────────────────────────────────
 *
 * Фікстура спільна: у обʼєкта А два типи й одна категорія, у Б — один тип і
 * одна категорія. Тобто на осі типів 2 ≠ 1, а на осі категорій 1 = 1 — і це
 * не недогляд фікстури, а причина, чому категорії доводяться НЕ кількістю, а
 * іменами: два однакових числа не розрізняють «мою категорію» і «сусідову»
 * (інваріант 26, друга половина). Кількість номерів у категорії при цьому
 * різна — 5 проти 7, — і саме вона ловить джойн, що зібрав чужі номери.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-prop-lists-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { listUnitTypes } = await import('./unit-types.repo.ts');
const { listCategories } = await import('./categories.repo.ts');

const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

// ─── Типи номерів ───────────────────────────────────────────────────────────

type TypeRow = { id: string; property_id: string; unit_count: number };

const typesA = await listUnitTypes(fx.organizationId, oneProperty(fx.a.id)) as TypeRow[];
assert.strictEqual(typesA.length, 2, `очікували 2 типи обʼєкта А, отримали ${typesA.length}`);
assert.ok(typesA.every((t) => t.property_id === fx.a.id), 'у списку типів А є чужий обʼєкт');

const typesB = await listUnitTypes(fx.organizationId, oneProperty(fx.b.id)) as TypeRow[];
assert.strictEqual(typesB.length, 1, `очікували 1 тип обʼєкта Б, отримали ${typesB.length}`);

const typesAll = await listUnitTypes(fx.organizationId, ALL_PROPERTIES) as TypeRow[];
assert.strictEqual(typesAll.length, 3, `«усі обʼєкти» мали дати 3 типи, отримали ${typesAll.length}`);

// Лічильник номерів усередині типу. Джойн тут по `unit_type_id`, тож чужі
// номери до нього не пристануть і без осі — це твердження не про вісь, а про
// те, що вісь не ЗЛАМАЛА джойн: фільтр, поставлений на `u` замість `ut`,
// обнулив би лічильники всіх типів, крім тих, чиї номери потрапили в область.
assert.strictEqual(Number(typesB[0].unit_count), 7, 'єдиний тип обʼєкта Б мав порахувати рівно свої 7 номерів');
assert.strictEqual(
  typesA.reduce((n, t) => n + Number(t.unit_count), 0), 5,
  'типи обʼєкта А разом мали порахувати 5 номерів',
);

// Вісь орендаря на місці, обидва боки.
assert.strictEqual(
  (await listUnitTypes(neighbour.organizationId, ALL_PROPERTIES) as unknown[]).length, 1,
  'сусід мав побачити рівно свій один тип',
);
assert.strictEqual(
  (await listUnitTypes(fx.organizationId, oneProperty(neighbour.propertyId)) as unknown[]).length, 0,
  'обʼєкт сусіда, названий нашою організацією, віддав типи',
);

// Фільтр за категорією діє ВСЕРЕДИНІ області, а не замість неї.
assert.strictEqual(
  (await listUnitTypes(fx.organizationId, oneProperty(fx.a.id), { category: 'room' }) as unknown[]).length, 2,
  'фільтр за категорією зрізав область',
);

console.log('  ok  типи номерів: 2 у А, 1 у Б, 3 «усі»; лічильник номерів не виходить за обʼєкт');

// ─── Категорії ──────────────────────────────────────────────────────────────
//
// Тут кількість однакова (по одній), тож доводиться ІМЕНАМИ: два однакових
// числа не розрізняють «моя» і «сусідова».

type CategoryRow = { id: string; property_id: string; unit_count: number };

const catsA = await listCategories(fx.organizationId, oneProperty(fx.a.id)) as CategoryRow[];
assert.strictEqual(catsA.length, 1, `очікували 1 категорію обʼєкта А, отримали ${catsA.length}`);
assert.strictEqual(catsA[0].id, fx.a.categoryId, 'у області А віддано категорію не того обʼєкта');
assert.strictEqual(Number(catsA[0].unit_count), 5, 'категорія А мала порахувати свої 5 номерів');

const catsB = await listCategories(fx.organizationId, oneProperty(fx.b.id)) as CategoryRow[];
assert.strictEqual(catsB.length, 1, `очікували 1 категорію обʼєкта Б, отримали ${catsB.length}`);
assert.strictEqual(catsB[0].id, fx.b.categoryId, 'у області Б віддано категорію не того обʼєкта');
assert.strictEqual(Number(catsB[0].unit_count), 7, 'категорія Б мала порахувати свої 7 номерів');

const catsAll = await listCategories(fx.organizationId, ALL_PROPERTIES) as CategoryRow[];
assert.deepStrictEqual(
  catsAll.map((c) => c.id).sort(), [fx.a.categoryId, fx.b.categoryId].sort(),
  '«усі обʼєкти» мали дати обидві категорії рахунку і жодної чужої',
);

assert.strictEqual(
  (await listCategories(fx.organizationId, oneProperty(neighbour.propertyId)) as unknown[]).length, 0,
  'категорія сусіда знайшлася в нашій організації',
);
assert.strictEqual(
  (await listCategories(neighbour.organizationId, ALL_PROPERTIES) as CategoryRow[])[0].id,
  `${neighbour.organizationId}_cat`, 'сусід побачив не свою категорію',
);

console.log('  ok  категорії: своя в кожній області, обидві в «усіх», чужа — ніде');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('property-lists: усі перевірки пройдено');
