/**
 * Надбавки за заселеність — писач (Блок 2 крок 3, Ц30).
 *
 *   node src/modules/pricing/data/extra-occupancy.repo.check.ts
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 *   * правило пишеться і читається; запис іде через двері `@channels/outbox`
 *     (Ц16): координата на пари тарифу (або всі пари обʼєкта, коли тариф не
 *     названо) від сьогодні до горизонту, маска «ціна»;
 *   * дві клітинки однакової точності (тариф × тип × гість × вилка) — відмова
 *     `rule_conflict`; точніше правило поруч із загальним — можна;
 *   * правило без проживання й харчування, відʼємне значення, невідомий
 *     режим, вилка поза межами — `rule_invalid`; тариф чужого обʼєкта —
 *     `rate_plan_not_found`;
 *   * зміна правила переносить клітинку, і канал чує обидва місця;
 *   * видалення — правила немає, канал чує;
 *   * вікові межі організації: «3, 12» → `[3, 12]`, дублікати й порядок
 *     прибираються, 0 і 18 — відмова; вилки читаються з організації;
 *   * чужий орендар не бачить і не пише (інваріант 5).
 *
 * Осі (інваріант 26): два гості (дорослий і дитина), два режими (сума 30 і
 * відсоток 10) з різними числами, два типи (усі й DBL).
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { createRule, updateRule, deleteRule, listRules, ageBandsOf, normalizeBoundaries } = await import('./extra-occupancy.repo.ts');
const { queuedChannelChanges: queuedChanges } = await import('@channels');

const sql = getSql();
const A = '__eor__a';
const B = '__eor__b';
const PROP = `${A}_prop`;
const DBL = `${A}_dbl`;
const TRI = `${A}_tri`;
const BAR = `${A}_bar`;
const BB = `${A}_bb`;
const CONN = `${A}_conn`;

async function cleanup() {
  for (const org of [A, B]) {
    // Прибирання — В КОНТЕКСТІ орендаря (Р10.11). Під роллю застосунку
    // тенантний `DELETE` без орендаря не падає: він чіпає НУЛЬ рядків, і
    // зелене тримається на каскаді від `DELETE FROM organizations`, а не на
    // самому прибиранні. Тобто перевірка прибирала не так, як застосунок.
    await runWithOrganization(org, async () => {
      await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM extra_occupancy_rules WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM rate_plans WHERE property_id = ?', [`${org}_prop`]);
      await sql.run('DELETE FROM unit_types WHERE property_id = ?', [`${org}_prop`]);
      await sql.run('DELETE FROM categories WHERE property_id = ?', [`${org}_prop`]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    });
    // На `organizations` політики немає за побудовою — цей рядок знімається
    // поза контекстом, і саме він тягне каскад.
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

async function seed(org: string) {
  const prop = `${org}_prop`;
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [prop, org, org, prop]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [`${org}_cat`, prop, 'Rooms', 'room']);
    for (const [id, code, maxAdults] of [[`${org}_dbl`, 'DBL', 2], [`${org}_tri`, 'TRI', 3]] as const) {
      await sql.run(
        `INSERT INTO unit_types (id, property_id, category_id, name, code, max_adults, max_children, max_occupancy, base_occupancy)
         VALUES (?, ?, ?, ?, ?, ?, 2, ?, 2)`,
        [id, prop, `${org}_cat`, code, code, maxAdults, maxAdults + 2],
      );
    }
    for (const [id, code] of [[`${org}_bar`, 'BAR'], [`${org}_bb`, 'BB']]) {
      await sql.run(`INSERT INTO rate_plans (id, property_id, name, code, currency, is_active) VALUES (?, ?, ?, ?, 'EUR', TRUE)`, [id, prop, code, code]);
    }
    // Дзеркало: обидва тарифи змаплені на DBL, лише BAR — на TRI.
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment, webhook_token, webhook_secret, is_enabled, remote_property_id)
       VALUES (?, ?, ?, 'probe', 'staging', ?, ?, TRUE, 'remote')`,
      [`${org}_conn`, org, prop, `tok_${org}`, `sec_${org}`],
    );
    for (const ut of [`${org}_dbl`, `${org}_tri`]) {
      await sql.run(
        `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id) VALUES (?, ?, ?, 'unit_type', ?, '', 0, ?)`,
        [`${org}_m_${ut}`, org, `${org}_conn`, ut, `r-${ut}`],
      );
    }
    for (const [rp, ut] of [[`${org}_bar`, `${org}_dbl`], [`${org}_bb`, `${org}_dbl`], [`${org}_bar`, `${org}_tri`]]) {
      await sql.run(
        `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id) VALUES (?, ?, ?, 'rate_plan', ?, ?, 0, ?)`,
        [`${org}_m_${rp}_${ut}`, org, `${org}_conn`, rp, ut, `r-${rp}-${ut}`],
      );
    }
  });
}

await cleanup();
await seed(A);
await seed(B);

try {
  await runWithOrganization(A, async () => {
    // ── 1. Правило пишеться; канал чує пари тарифу ────────────────────────
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);
    const adult = await createRule(PROP, { ratePlanId: BAR, unitTypeId: null, guestKind: 'adult', lodgingMode: 'fixed', lodgingValue: 30 });
    assert.ok(adult.id, 'правило має id');
    assert.strictEqual(adult.lodgingValue, 30);
    assert.strictEqual(adult.extraBed, false, 'без прапорця — не додаткове ліжко');
    const listed = await listRules(PROP);
    assert.deepStrictEqual(listed.map((r) => r.id), [adult.id], 'правило читається назад');
    let queued = await queuedChanges(CONN);
    assert.deepStrictEqual(queued.map((q) => [q.ratePlanId, q.unitTypeId]).sort(), [[BAR, DBL], [BAR, TRI]].sort(),
      `правило на тариф — координата на кожну його пару, а не ${JSON.stringify(queued.map((q) => [q.ratePlanId, q.unitTypeId]))}`);
    assert.ok(queued.every((q) => q.kind === 'rate' && q.fields && q.fields.length === 1 && q.fields[0] === 'prices'), 'маска — лише «ціна»');
    assert.ok(queued.every((q) => q.date >= new Date().toISOString().slice(0, 10)), 'від сьогодні');
    console.log('  ok  правило пишеться й читається; канал чує пари тарифу маскою «ціна»');

    // ── 2. Правило без тарифу — усі пари обʼєкта ──────────────────────────
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);
    const child = await createRule(PROP, { ratePlanId: null, unitTypeId: null, guestKind: 'child', lodgingMode: 'percent', lodgingValue: 10, mealMode: 'fixed', mealValue: 5 });
    queued = await queuedChanges(CONN);
    assert.strictEqual(queued.length, 3, `дитяче правило на всі тарифи — три пари обʼєкта, а не ${queued.length}`);
    console.log('  ok  правило без тарифу — координата на всі пари обʼєкта');

    // ── 3. Конфлікт — та сама клітинка; точніше поруч — можна ─────────────
    await assert.rejects(() => createRule(PROP, { ratePlanId: BAR, unitTypeId: null, guestKind: 'adult', lodgingMode: 'fixed', lodgingValue: 99 }), /rule_conflict/,
      'дві надбавки на одну клітинку — котра з них ціна?');
    const specific = await createRule(PROP, { ratePlanId: BAR, unitTypeId: DBL, guestKind: 'adult', lodgingMode: 'percent', lodgingValue: 15 });
    assert.ok(specific.id, 'точніше правило (тариф × тип) поруч із загальним (тариф) — не конфлікт');
    console.log('  ok  та сама клітинка — конфлікт; точніша — можна');

    // ── 4. Невалідне — відмова з назвою ───────────────────────────────────
    await assert.rejects(() => createRule(PROP, { ratePlanId: BB, unitTypeId: null, guestKind: 'adult' }), /rule_invalid/, 'без проживання й харчування — не правило');
    await assert.rejects(() => createRule(PROP, { ratePlanId: BB, unitTypeId: null, guestKind: 'adult', lodgingMode: 'fixed', lodgingValue: -1 }), /rule_invalid/, 'відʼємна надбавка');
    await assert.rejects(() => createRule(PROP, { ratePlanId: BB, unitTypeId: null, guestKind: 'adult', lodgingMode: 'half' as any, lodgingValue: 1 }), /rule_invalid/, 'невідомий режим');
    await assert.rejects(() => createRule(PROP, { ratePlanId: BB, unitTypeId: null, guestKind: 'child', ageBandIndex: 1, lodgingMode: 'fixed', lodgingValue: 1 }), /rule_invalid/,
      'вилка №1, коли в організації одна вилка — не існує');
    await assert.rejects(() => createRule(PROP, { ratePlanId: `${B}_bar`, unitTypeId: null, guestKind: 'adult', lodgingMode: 'fixed', lodgingValue: 1 }), /rate_plan_not_found/,
      'тариф чужого обʼєкта — не знайдено (інваріант 5)');
    await assert.rejects(() => createRule(PROP, { ratePlanId: null, unitTypeId: `${B}_dbl`, guestKind: 'adult', lodgingMode: 'fixed', lodgingValue: 1 }), /unit_type_not_found/);
    const zero = await createRule(PROP, { ratePlanId: BB, unitTypeId: null, guestKind: 'child', lodgingMode: 'fixed', lodgingValue: 0 });
    assert.strictEqual(zero.lodgingValue, 0, 'нуль — «безкоштовно», названий готелем, а не відмова');
    console.log('  ok  невалідне правило — відмова з назвою; нуль — дозволений');

    // ── 5. Вилки організації ──────────────────────────────────────────────
    assert.deepStrictEqual(normalizeBoundaries('3, 12'), [3, 12]);
    assert.deepStrictEqual(normalizeBoundaries('12,3,3'), [3, 12], 'порядок і дублікати прибираються');
    assert.deepStrictEqual(normalizeBoundaries(''), [], 'порожньо — одна вилка');
    assert.throws(() => normalizeBoundaries('0, 5'), /age_bands_invalid/, 'межа 0 — не межа');
    assert.throws(() => normalizeBoundaries('18'), /age_bands_invalid/, '18 — уже дорослий');
    await sql.run("UPDATE organizations SET child_age_bands = '[3,12]' WHERE id = ?", [A]);
    assert.deepStrictEqual(await ageBandsOf(A), [{ from: 0, to: 2 }, { from: 3, to: 11 }, { from: 12, to: 17 }], 'вилки читаються з організації');
    const banded = await createRule(PROP, { ratePlanId: BAR, unitTypeId: null, guestKind: 'child', ageBandIndex: 2, lodgingMode: 'percent', lodgingValue: 50 });
    assert.strictEqual(banded.ageBandIndex, 2, 'із трьома вилками третя існує');
    console.log('  ok  межі → вилки; правило на вилку — лише на наявну');

    // ── 6. Зміна переносить клітинку; канал чує обидва місця ──────────────
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);
    const moved = await updateRule(specific.id, { ratePlanId: BB, unitTypeId: DBL, guestKind: 'adult', lodgingMode: 'percent', lodgingValue: 15, extraBed: true });
    assert.strictEqual(moved.ratePlanId, BB);
    assert.strictEqual(moved.extraBed, true);
    queued = await queuedChanges(CONN);
    const pairs = queued.map((q) => `${q.ratePlanId}|${q.unitTypeId}`);
    assert.ok(pairs.includes(`${BAR}|${DBL}`) && pairs.includes(`${BB}|${DBL}`), `старе й нове місце — обидва в черзі: ${JSON.stringify(pairs)}`);
    await assert.rejects(() => updateRule(adult.id, { ratePlanId: BB, unitTypeId: DBL, guestKind: 'adult', lodgingMode: 'fixed', lodgingValue: 1 }), /rule_conflict/,
      'переїзд на зайняту клітинку — конфлікт');
    console.log('  ok  зміна переносить клітинку; канал чує старе й нове місце');

    // ── 7. Видалення ──────────────────────────────────────────────────────
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);
    await deleteRule(child.id);
    assert.ok(!(await listRules(PROP)).some((r) => r.id === child.id), 'правила більше немає');
    assert.ok((await queuedChanges(CONN)).length > 0, 'канал чує, що дитяча надбавка зникла');
    console.log('  ok  видалення — правила немає, канал чує');
  });

  // ── 8. Чужий орендар ──────────────────────────────────────────────────
  const mine = await runWithOrganization(A, () => listRules(PROP));
  await runWithOrganization(B, async () => {
    await assert.rejects(() => listRules(PROP), /property_not_found/, 'чужий обʼєкт — не існує');
    await assert.rejects(() => updateRule(mine[0].id, { ratePlanId: null, unitTypeId: null, guestKind: 'adult', lodgingMode: 'fixed', lodgingValue: 1 }), /rule_not_found/,
      'чуже правило для іншого орендаря не існує (інваріант 5)');
    await assert.rejects(() => deleteRule(mine[0].id), /rule_not_found/);
    await assert.rejects(() => createRule(PROP, { ratePlanId: null, unitTypeId: null, guestKind: 'adult', lodgingMode: 'fixed', lodgingValue: 1 }), /property_not_found/);
  });
  assert.strictEqual((await runWithOrganization(A, () => listRules(PROP))).length, mine.length, 'свої правила на місці');
  console.log('  ok  чужий орендар не бачить і не пише');
} finally {
  await cleanup();
}

console.log('extra-occupancy: правило пишеться через двері каналу, клітинка унікальна, невалідне відмовляє, чуже не існує');
