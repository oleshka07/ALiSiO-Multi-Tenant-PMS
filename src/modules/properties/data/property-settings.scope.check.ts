/**
 * Збори з податками і гостьові сторінки типів — про ОДИН будинок.
 *
 *   node src/modules/properties/data/property-settings.scope.check.ts
 *
 * ── Що ламалося ─────────────────────────────────────────────────────────
 *
 * Обидва списки обмежувались лише орендарем.
 *
 * `listFees` — це ГРОШІ: ставка збору «для громади», відсоток, чи входить у
 * ціну. У двох готелів однієї компанії вони різні (різні міста — різні
 * ставки), і спільний список запрошує правку не в тому рядку. Інваріант 29
 * каже, що межа проходить по ДАНИХ, не по екрану: форма збору — звичайна
 * акуратність, а сам рядок ставки їде у квоту і на рахунок гостя.
 *
 * `guest-page-configs` — рядки з кодами дверей і Wi-Fi-паролями (так каже
 * шапка того хендлера). Готель із двома будинками бачив в одному списку типи
 * обох, тобто коди чужого будинку поруч зі своїми.
 *
 * ── Числа ───────────────────────────────────────────────────────────────
 *
 * Збори: 2 в А, 3 в Б (сума 5). Типи номерів фікстури: 2 в А, 1 в Б (сума 3).
 * Жодна сума не дорівнює жодному доданку (§26), і числа зборів навмисно не
 * збігаються з числами типів — інакше «переплутав список» було б зеленим.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-prop-settings-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { seedTwoProperties, seedNeighbourOrganization } = await import('@core/fixtures/two-properties.ts');
const { ALL_PROPERTIES, oneProperty } = await import('@core/property-scope.ts');
const { listFees } = await import('./fees.repo.ts');
const { listGuestPageConfigs } = await import('./guest-page-configs.repo.ts');

const sql = getSql();
const fx = await seedTwoProperties();
const neighbour = await seedNeighbourOrganization();

/** Засів — під орендарем того рахунку, якому рядок належить (див. lists.scope). */
const inOurs = <T>(fn: () => Promise<T>) => runWithOrganization(fx.organizationId, fn);
const inTheirs = <T>(fn: () => Promise<T>) => runWithOrganization(neighbour.organizationId, fn);
const forProperty = <T>(propertyId: string, fn: () => Promise<T>) =>
  (propertyId === neighbour.propertyId ? inTheirs(fn) : inOurs(fn));
const forOrg = <T>(organizationId: string, fn: () => Promise<T>) =>
  runWithOrganization(organizationId, fn);


// `fees_taxes` не несе `organization_id` — орендар доводиться через
// `property_id`, тож обидві осі тут тримає одна колонка.
const fee = async (id: string, propertyId: string, name: string, amount: number) => forProperty(propertyId, () => sql.run(
  `INSERT INTO fees_taxes (id, property_id, name, type, amount, applies_to, collected_for,
                           is_included_in_price, is_active)
   VALUES (?, ?, ?, 'per_night', ?, 'all', 'authority', FALSE, TRUE)`,
  [id, propertyId, name, amount]));

// Збори 2 і 3: різні ставки навмисно — «взяв не той рядок» видно числом.
await fee('f_a1', fx.a.id, 'Місцевий збір', 20);
await fee('f_a2', fx.a.id, 'Курортний збір', 15);
await fee('f_b1', fx.b.id, 'Місцевий збір', 35);
await fee('f_b2', fx.b.id, 'Прибирання', 500);
await fee('f_b3', fx.b.id, 'Паркування', 200);
await fee('f_n1', neighbour.propertyId, 'Чужий збір', 99);

await runWithOrganization(fx.organizationId, async () => {
  const org = fx.organizationId;

  // ─── Збори ───────────────────────────────────────────────────────────────
  const inA = await listFees(org, oneProperty(fx.a.id));
  assert.strictEqual(inA.length, 2, `очікували 2 збори обʼєкта А, отримали ${inA.length}`);
  // Ставка «Місцевий збір» в А — 20, у Б — 35. Якби область не діяла, у списку
  // були б обидва рядки з однією назвою, і оператор виправив би не той.
  assert.deepStrictEqual(inA.map((f) => Number(f.amount)).sort((x, y) => x - y), [15, 20],
    'у списку обʼєкта А стоять ставки не того будинку');

  assert.strictEqual((await listFees(org, oneProperty(fx.b.id))).length, 3,
    'очікували 3 збори обʼєкта Б');
  assert.strictEqual((await listFees(org, ALL_PROPERTIES)).length, 5,
    '«усі обʼєкти» мали дати 5 зборів і жодного чужого орендаря');
  assert.strictEqual((await listFees(org, oneProperty(neighbour.propertyId))).length, 0,
    'обʼєкт сусіда, названий нашою організацією, віддав збори');

  // ─── Гостьові сторінки типів ─────────────────────────────────────────────
  //
  // Числа тут ІНШІ, ніж у зборів (2/1/3 проти 2/3/5), і це навмисно: якби
  // хендлер узяв не той список, збіг чисел приховав би це.
  assert.strictEqual((await listGuestPageConfigs(org, oneProperty(fx.a.id))).length, 2,
    'очікували 2 типи обʼєкта А');
  assert.strictEqual((await listGuestPageConfigs(org, oneProperty(fx.b.id))).length, 1,
    'очікували 1 тип обʼєкта Б');
  assert.strictEqual((await listGuestPageConfigs(org, ALL_PROPERTIES)).length, 3,
    '«усі обʼєкти» мали дати 3 типи');
});

// Вісь орендаря з другого боку.
await runWithOrganization(neighbour.organizationId, async () => {
  assert.strictEqual((await listFees(neighbour.organizationId, ALL_PROPERTIES)).length, 1,
    'сусід побачив не свій збір');
  assert.strictEqual((await listGuestPageConfigs(neighbour.organizationId, ALL_PROPERTIES)).length, 1,
    'сусід побачив не свій тип');
});

console.log('  ok  збори 2/3/5 (ставки 15+20 в А), гостьові сторінки 2/1/3; чужий орендар — по одному своєму');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('property-settings.scope: усі перевірки пройдено');
