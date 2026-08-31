/**
 * Збір належить обʼєкту, а обʼєкт — орендарю.
 *
 *   node src/modules/properties/data/fees.repo.check.ts
 *
 * `fees_taxes` не має `organization_id`: вона досягає організації через
 * `property_id`. Такий запит, обмежений лише власним id рядка, не ізолює
 * НІЧОГО — id приходить із URL, і будь-який орендар може ввести будь-який.
 * Саме так свого часу `listCategories` віддавав категорії всіх клієнтів, а
 * `updateCategory` міняв те, на що вказував URL.
 *
 * Тому тут перевіряється не «функція повертає рядок», а **обидва боки**:
 * свій бачить своє, чужий не бачить нічого і не може нічого змінити. Один
 * орендар не доводить нічого — з ним усе зламане виглядає цілим (AGENTS §7).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const repo = await import('./fees.repo.ts');

// ── Частина без бази: словники не мають розійтися з CHECK у схемі ────────
//
// Розходження тут — це 500 від драйвера замість 400 з назвою поля.
assert.strictEqual(repo.validateFee({ name: '', type: 'per_stay', amount: 1 })?.field, 'name');
assert.strictEqual(repo.validateFee({ name: ' ', type: 'per_stay', amount: 1 })?.field, 'name',
  'пробіл — це не назва');
assert.strictEqual(repo.validateFee({ name: 'X', type: 'per_fortnight', amount: 1 })?.field, 'type');
assert.strictEqual(repo.validateFee({ name: 'X', type: 'per_stay', amount: 'дуже' })?.field, 'amount');
assert.strictEqual(repo.validateFee({ name: 'X', type: 'per_stay', amount: -5 })?.reason, 'negative',
  'відʼємний збір — це знижка, і вона заводиться не тут');
assert.strictEqual(repo.validateFee({ name: 'X', type: 'per_stay', amount: 1, applies_to: 'seniors' })?.field, 'applies_to');
assert.strictEqual(repo.validateFee({ name: 'X', type: 'per_stay', amount: 1, collected_for: 'платформа' })?.field, 'collected_for');
assert.strictEqual(repo.validateFee({ name: 'X', type: 'per_stay', amount: 0 }), null,
  'нуль дозволений: збір «поки не беремо» — це стан, а не помилка вводу');
assert.strictEqual(repo.validateFee({ name: 'X', type: 'per_stay', amount: 1 }), null,
  'без двох нових полів рядок валідний — дефолти в базі');
console.log('  ok  словники збігаються зі схемою, відмови називають поле');

const sql = getSql();
const A = 'org_fee_a';
const B = 'org_fee_b';

async function cleanup() {
  await sql.run("DELETE FROM fees_taxes WHERE property_id LIKE 'feeprop_%'", []);
  await sql.run("DELETE FROM properties WHERE id LIKE 'feeprop_%'", []);
  await sql.run('DELETE FROM organizations WHERE id IN (?, ?)', [A, B]);
}

await cleanup();
try {
  for (const [org, slug] of [[A, 'fee-a'], [B, 'fee-b']] as const) {
    await sql.run('INSERT INTO organizations(id, name, slug) VALUES (?,?,?)', [org, slug, slug]);
  }
  await sql.run('INSERT INTO properties(id, organization_id, name, slug) VALUES (?,?,?,?)',
    ['feeprop_a', A, 'Дім A', 'dim-a']);
  await sql.run('INSERT INTO properties(id, organization_id, name, slug) VALUES (?,?,?,?)',
    ['feeprop_b', B, 'Дім B', 'dim-b']);

  let feeOfA = '';

  await runWithOrganization(A, async () => {
    const made = await repo.createFee(A, {
      property_id: 'feeprop_a', name: 'Прибирання', type: 'per_stay', amount: 500,
    });
    assert.ok(made, 'свій обʼєкт — збір створюється');
    feeOfA = made.id;
    assert.strictEqual(made.applies_to, 'all', 'дефолт бере база, а не хендлер');
    assert.strictEqual(made.collected_for, 'property');

    // Чужий обʼєкт у тілі запиту — не привід. `null`, а не виняток: хендлер
    // відповість 404 і не підтвердить, що такий обʼєкт існує (інваріант 5).
    assert.strictEqual(
      await repo.createFee(A, { property_id: 'feeprop_b', name: 'Чуже', type: 'per_stay', amount: 1 }),
      null, 'збір на ЧУЖИЙ обʼєкт не створюється');

    assert.strictEqual((await repo.listFees(A)).length, 1);
  });

  await runWithOrganization(B, async () => {
    // Головне твердження. Порожній список у B доводить, що A не протікає.
    assert.deepStrictEqual(await repo.listFees(B), [],
      'у сусіда своїх зборів немає — і чужих він не бачить');
    assert.strictEqual(await repo.getFee(B, feeOfA), null, 'чужий id → нічого');
    assert.strictEqual(await repo.updateFee(B, feeOfA, { amount: 1 }), null,
      'чужий збір не змінюється за id з URL');
    assert.strictEqual(await repo.deleteFee(B, feeOfA), false,
      'і не видаляється');
  });

  // Рядок A після спроб B — незайманий.
  await runWithOrganization(A, async () => {
    const still = await repo.getFee(A, feeOfA);
    assert.strictEqual(Number(still?.amount), 500, 'сусід нічого не змінив');

    // `property_id` у тілі PATCH не має перекидати збір на інший обʼєкт:
    // список дозволених колонок, а не Object.keys(body).
    await repo.updateFee(A, feeOfA, { property_id: 'feeprop_b', amount: 600 } as never);
    const moved = await repo.getFee(A, feeOfA);
    assert.strictEqual(moved?.property_id, 'feeprop_a',
      'PATCH не сміє переставити збір на чужий обʼєкт');
    assert.strictEqual(Number(moved?.amount), 600, 'а дозволене поле змінилось');

    assert.strictEqual(await repo.deleteFee(A, feeOfA), true);
    assert.strictEqual(await repo.getFee(A, feeOfA), null);
  });
  console.log('  ok  свій бачить своє, чужий не бачить і не змінює нічого');

  // ── Двох турзборів не буває ────────────────────────────────────────────
  await sql.run("UPDATE properties SET city_tax_per_night = 20 WHERE id = 'feeprop_a'", []);
  assert.strictEqual(await repo.cityTaxRateOf('feeprop_a'), 20);
  await sql.run("UPDATE properties SET city_tax_per_night = 0 WHERE id = 'feeprop_a'", []);
  assert.strictEqual(await repo.cityTaxRateOf('feeprop_a'), 0);
  assert.strictEqual(await repo.cityTaxRateOf('feeprop_нема'), 0,
    'обʼєкта немає — нуль, а не виняток: це перевірка, а не читання');
  console.log('  ok  ставка турзбору обʼєкта читається для перевірки на дубль');
} finally {
  await cleanup();
}

console.log('збори: обʼєктна область тримається, дублю турзбору є чим запобігти');
