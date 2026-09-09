/**
 * Список номерів віддає номери ОДНОГО обʼєкта, коли його названо.
 *
 *   node src/modules/properties/data/units.repo.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * `listUnits` не мав `property_id` навіть параметром: запит обмежувався
 * `propertyScopeSql('u')`, а це вісь ОРЕНДАРЯ — «усі обʼєкти цього рахунку».
 * Власник із двома обʼєктами бачив на екрані «Номери» номери обох, маючи
 * вибраним один (INC-029). Писачі поруч, у цьому ж файлі, вісь знали:
 * `createUnit` бере `requirePropertyId`, `ownsAllRefs` питає `ownsProperty`.
 *
 * ── Чому саме ці числа ──────────────────────────────────────────────────
 *
 * Фікстура спільна (`@core/fixtures/two-properties`): 5 номерів в обʼєкта А,
 * 7 у Б, сума 12. Число 12 не є жодним обʼєктом, тож «забув вісь» не сплутати
 * з «урахував» — це друга половина інваріанта 26, і саме на 2 і 2 вона
 * ламається.
 *
 * Сусідня організація на 4 номери — не надмірність: твердження про вісь
 * обʼєкта без осі орендаря порожнє. «Віддав 5» було б зелене й на коді, який
 * просто не бачить нікого, крім А. 4 обрано так, щоб протікання сусіда не
 * збіглося з жодною очікуваною сумою (9, 11, 16 — усі помітні).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Аліаси спершу, потім усе, що їх потребує.
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-units-repo-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { listUnits } = await import('./units.repo.ts');

const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

// ─── Названий обʼєкт віддає СВОЇ номери, і лише свої ────────────────────────

const inA = await listUnits(fx.organizationId, oneProperty(fx.a.id)) as { id: string; property_id: string }[];
assert.strictEqual(inA.length, 5, `очікували 5 номерів обʼєкта А, отримали ${inA.length}`);
assert.deepStrictEqual(idsOf(inA), [...fx.a.unitIds].sort(), 'у списку А опинились не ті номери');
assert.ok(inA.every((u) => u.property_id === fx.a.id), 'у списку А є рядок чужого обʼєкта');

const inB = await listUnits(fx.organizationId, oneProperty(fx.b.id)) as { id: string }[];
assert.strictEqual(inB.length, 7, `очікували 7 номерів обʼєкта Б, отримали ${inB.length}`);
assert.deepStrictEqual(idsOf(inB), [...fx.b.unitIds].sort(), 'у списку Б опинились не ті номери');

// ─── «Усі обʼєкти» — це всі обʼєкти РАХУНКУ, не всі на сервері ─────────────

const all = await listUnits(fx.organizationId, ALL_PROPERTIES) as { id: string }[];
assert.strictEqual(all.length, 12, `«усі обʼєкти» мали дати 12, отримали ${all.length}`);
assert.deepStrictEqual(
  idsOf(all), [...fx.a.unitIds, ...fx.b.unitIds].sort(),
  'у зведений список потрапив чужий орендар — 16 замість 12',
);

// ─── Вісь орендаря лишилась на місці ───────────────────────────────────────
//
// Обидва боки, як велить §7 AGENTS: свій бачить своє, чужий не бачить нічого.

const neighbourList = await listUnits(neighbour.organizationId, ALL_PROPERTIES) as { id: string }[];
assert.strictEqual(neighbourList.length, 4, 'сусід мав побачити рівно свої 4 номери');
assert.deepStrictEqual(idsOf(neighbourList), [...neighbour.unitIds].sort(), 'сусід побачив не свої номери');

assert.strictEqual(
  (await listUnits(neighbour.organizationId, oneProperty(fx.a.id)) as unknown[]).length, 0,
  'чужий обʼєкт, названий у своїй області, віддав рядки — вісь обʼєкта переважила вісь орендаря',
);
assert.strictEqual(
  (await listUnits(fx.organizationId, oneProperty(neighbour.propertyId)) as unknown[]).length, 0,
  'обʼєкт сусіда, названий нашою організацією, віддав рядки',
);

console.log('  ok  список номерів: 5 у А, 7 у Б, 12 «усі», 0 через межу орендаря');

// ─── Фільтри працюють ВСЕРЕДИНІ області, а не замість неї ──────────────────
//
// Фільтр за типом і область — різні осі. Тип A1 має 3 номери з пʼяти в А;
// якби фільтр підмінив собою область, це число не змінилось би від того, що
// область названо іншим обʼєктом.

const typeA1 = fx.a.unitTypeIds[0];
const byType = await listUnits(fx.organizationId, oneProperty(fx.a.id), { unitType: typeA1 }) as unknown[];
assert.strictEqual(byType.length, 3, `тип A1 мав дати 3 номери, отримали ${byType.length}`);

const typeInWrongScope = await listUnits(fx.organizationId, oneProperty(fx.b.id), { unitType: typeA1 }) as unknown[];
assert.strictEqual(typeInWrongScope.length, 0, 'тип обʼєкта А знайшовся в області обʼєкта Б');

const byCategory = await listUnits(fx.organizationId, oneProperty(fx.b.id), { category: 'room' }) as unknown[];
assert.strictEqual(byCategory.length, 7, 'фільтр за категорією зрізав область');

console.log('  ok  фільтр за типом і категорією діє ВСЕРЕДИНІ області');

// ─── Секрети номера — як були ──────────────────────────────────────────────
//
// Перевіряється тут, бо саме цей виклик змінив підпис: правка осі не має
// тихо розширити відповідь (О8).

const plain = await listUnits(fx.organizationId, oneProperty(fx.a.id)) as Record<string, unknown>[];
assert.ok(!('lock_code' in plain[0]), 'код замка поїхав у список без manage_properties');
assert.ok(!('wifi_password' in plain[0]), 'пароль мережі поїхав у список без manage_properties');

const secret = await listUnits(fx.organizationId, oneProperty(fx.a.id), {}, { secrets: true }) as Record<string, unknown>[];
assert.ok('lock_code' in secret[0], 'під manage_properties код замка мав лишитись у відповіді');
assert.ok('wifi_password' in secret[0], 'під manage_properties пароль мережі мав лишитись у відповіді');

console.log('  ok  секрети номера видно лише під manage_properties');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('units.repo: усі перевірки пройдено');
