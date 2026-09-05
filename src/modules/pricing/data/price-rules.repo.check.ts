/**
 * Правила цін і промо — писач (Блок 2 крок 4, Ц31).
 *
 *   node src/modules/pricing/data/price-rules.repo.check.ts
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 *   * правило пишеться й читається; списки (дні тижня, тарифи, типи) — назад
 *     тими самими списками; запис іде через двері `@channels/outbox` (Ц16):
 *     координата на пари названих тарифів (або всі пари обʼєкта), маска «ціна»;
 *   * промо канал не чує (код там нема кому назвати);
 *   * невалідне — відмова з назвою: без назви, нуль чи відʼємне значення,
 *     −100 % і більше, невідомий словник, межі навпаки, тариф чи тип чужого
 *     обʼєкта, промо без коду, зайнятий код (без регістру);
 *   * звичайне правило коду не носить, навіть коли його надіслали;
 *   * зміна правила — канал чує старі й нові тарифи;
 *   * використання промокоду лічиться до ліміту й не далі;
 *   * чужий орендар не бачить і не пише (інваріант 5).
 *
 * Осі (інваріант 26): обидві дії (мінус і плюс), обидва види значення (10 % і
 * 20 сумою), два роди (правило і промо), два тарифи в списку проти одного.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { createRule, updateRule, deleteRule, listRules, redeemPromoCode, rulesForProperty } = await import('./price-rules.repo.ts');
const { queuedChannelChanges: queuedChanges } = await import('@channels');

const sql = getSql();
const A = '__prr__a';
const B = '__prr__b';
const PROP = `${A}_prop`;
const DBL = `${A}_dbl`;
const TRI = `${A}_tri`;
const BAR = `${A}_bar`;
const BB = `${A}_bb`;
const CONN = `${A}_conn`;

async function cleanup() {
  for (const org of [A, B]) {
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM price_rules WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM rate_plans WHERE property_id = ?', [`${org}_prop`]);
    await sql.run('DELETE FROM unit_types WHERE property_id = ?', [`${org}_prop`]);
    await sql.run('DELETE FROM categories WHERE property_id = ?', [`${org}_prop`]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
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
    // Дзеркало: BAR і BB на DBL, лише BAR на TRI — три пари.
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
    // ── 1. Правило пишеться; списки повертаються; канал чує пари тарифу ───
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);
    const weekend = await createRule(PROP, {
      name: 'Вихідні +20', kind: 'rule', action: 'increase', value: 20, valueKind: 'fixed', weekDays: [6, 5], ratePlanIds: [BAR], unitTypeIds: [DBL, TRI], priority: 10,
    });
    assert.ok(weekend.id, 'правило має id');
    assert.deepStrictEqual(weekend.weekDays, [5, 6], 'дні тижня — впорядкованим списком');
    assert.deepStrictEqual(weekend.ratePlanIds, [BAR]);
    assert.strictEqual(weekend.code, null, 'звичайне правило коду не носить');
    const listed = await listRules(PROP);
    assert.strictEqual(listed.length, 1);
    assert.deepStrictEqual(listed[0].unitTypeIds, [DBL, TRI], 'списки читаються назад тими самими');
    let queued = await queuedChanges(CONN);
    assert.deepStrictEqual(queued.map((q) => [q.ratePlanId, q.unitTypeId]).sort(), [[BAR, DBL], [BAR, TRI]].sort(),
      `правило на BAR × (DBL, TRI) — координата на кожну його пару, а не ${JSON.stringify(queued.map((q) => [q.ratePlanId, q.unitTypeId]))}`);
    assert.ok(queued.every((q) => q.kind === 'rate' && q.fields?.length === 1 && q.fields[0] === 'prices'), 'маска — лише «ціна»');
    console.log('  ok  правило пишеться зі списками; канал чує пари названих тарифів маскою «ціна»');

    // ── 2. Правило без тарифів і типів — усі пари обʼєкта ─────────────────
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);
    const los = await createRule(PROP, { name: 'Від 3 ночей −10 %', action: 'decrease', value: 10, valueKind: 'percent', minLos: 3 });
    queued = await queuedChanges(CONN);
    assert.strictEqual(queued.length, 3, `правило на всі тарифи й типи — три пари обʼєкта, а не ${queued.length}`);
    console.log('  ok  правило без списків — координата на всі пари обʼєкта');

    // ── 3. Промо — з кодом, канал не чує ──────────────────────────────────
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);
    const promo = await createRule(PROP, { name: 'Літо', kind: 'promo', code: ' summer10 ', action: 'decrease', value: 10, valueKind: 'percent', maxUses: 2, onlineOnly: true });
    assert.strictEqual(promo.code, 'SUMMER10', 'код — без пробілів, у верхньому регістрі');
    assert.strictEqual(promo.onlineOnly, true);
    assert.strictEqual((await queuedChanges(CONN)).length, 0, 'промо в канал не їде: код там нема кому назвати');
    await assert.rejects(() => createRule(PROP, { name: 'Дубль', kind: 'promo', code: 'Summer10', action: 'decrease', value: 5, valueKind: 'percent' }), /promo_code_taken/,
      'той самий код без регістру — зайнятий');
    await assert.rejects(() => createRule(PROP, { name: 'Без коду', kind: 'promo', action: 'decrease', value: 5, valueKind: 'percent' }), /promo_code_required/);
    const plain = await createRule(PROP, { name: 'Не промо', code: 'IGNORED', action: 'decrease', value: 5, valueKind: 'fixed' });
    assert.strictEqual(plain.code, null, 'код у звичайному правилі відкидається — інакше воно вдавало б промо');
    console.log('  ok  промо: код нормалізовано й унікальний без регістру; канал промо не чує');

    // ── 4. Невалідне — відмова з назвою ───────────────────────────────────
    const base = { action: 'decrease' as const, value: 10, valueKind: 'percent' as const };
    await assert.rejects(() => createRule(PROP, { ...base, name: '  ' }), /rule_name_required/);
    await assert.rejects(() => createRule(PROP, { ...base, name: 'нуль', value: 0 }), /rule_value_invalid/, 'нуль — не правило');
    await assert.rejects(() => createRule(PROP, { ...base, name: 'мінус', value: -5 }), /rule_value_invalid/);
    await assert.rejects(() => createRule(PROP, { ...base, name: 'усе', value: 100 }), /rule_value_invalid/, '−100 % — ціни немає, це не знижка');
    await assert.rejects(() => createRule(PROP, { ...base, name: 'дія', action: 'halve' as any }), /rule_invalid/);
    await assert.rejects(() => createRule(PROP, { ...base, name: 'межі', minLos: 5, maxLos: 2 }), /rule_invalid/, 'мінімум більший за максимум');
    await assert.rejects(() => createRule(PROP, { ...base, name: 'дати', dateFrom: '2027-08-01', dateTo: '2027-07-01' }), /rule_invalid/);
    await assert.rejects(() => createRule(PROP, { ...base, name: 'день', weekDays: [0] }), /rule_invalid/, 'день тижня 0 — не день');
    await assert.rejects(() => createRule(PROP, { ...base, name: 'чужий тариф', ratePlanIds: [`${B}_bar`] }), /rate_plan_not_found/, 'тариф чужого обʼєкта — не знайдено');
    await assert.rejects(() => createRule(PROP, { ...base, name: 'чужий тип', unitTypeIds: [`${B}_dbl`] }), /unit_type_not_found/);
    console.log('  ok  невалідне правило — відмова з назвою');

    // ── 5. Зміна — канал чує старі й нові тарифи ──────────────────────────
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);
    const moved = await updateRule(weekend.id, { name: 'Вихідні +25', action: 'increase', value: 25, valueKind: 'fixed', weekDays: [5, 6], ratePlanIds: [BB], priority: 10 });
    assert.strictEqual(moved.value, 25);
    assert.deepStrictEqual(moved.ratePlanIds, [BB]);
    const pairs = (await queuedChanges(CONN)).map((q) => `${q.ratePlanId}|${q.unitTypeId}`);
    assert.ok(pairs.includes(`${BAR}|${DBL}`) && pairs.includes(`${BB}|${DBL}`), `старий тариф і новий — обидва в черзі: ${JSON.stringify(pairs)}`);
    console.log('  ok  зміна правила — канал чує старі й нові пари');

    // ── 6. Використання промокоду — до ліміту ─────────────────────────────
    assert.strictEqual(await redeemPromoCode(PROP, A, 'summer10'), true, 'перше використання');
    assert.strictEqual(await redeemPromoCode(PROP, A, 'SUMMER10'), true, 'друге — ліміт 2');
    assert.strictEqual(await redeemPromoCode(PROP, A, 'SUMMER10'), false, 'третє — вичерпано, лічильник не росте');
    assert.strictEqual((await rulesForProperty(PROP, A)).find((r) => r.id === promo.id)?.currentUses, 2);
    assert.strictEqual(await redeemPromoCode(PROP, A, 'NOPE'), false, 'невідомий код — нічого');
    console.log('  ok  промокод лічиться до ліміту й не далі');

    // ── 7. Видалення ──────────────────────────────────────────────────────
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);
    await deleteRule(los.id);
    assert.ok(!(await listRules(PROP)).some((r) => r.id === los.id));
    assert.strictEqual((await queuedChanges(CONN)).length, 3, 'знижка на всі пари зникла — канал чує всі три');
    console.log('  ok  видалення — правила немає, канал чує');
  });

  // ── 8. Чужий орендар ──────────────────────────────────────────────────
  const mine = await runWithOrganization(A, () => listRules(PROP));
  await runWithOrganization(B, async () => {
    await assert.rejects(() => listRules(PROP), /property_not_found/, 'чужий обʼєкт — не існує');
    await assert.rejects(() => updateRule(mine[0].id, { name: 'x', action: 'decrease', value: 1, valueKind: 'fixed' }), /rule_not_found/,
      'чуже правило для іншого орендаря не існує (інваріант 5)');
    await assert.rejects(() => deleteRule(mine[0].id), /rule_not_found/);
    const own = await createRule(`${B}_prop`, { name: 'Своє промо', kind: 'promo', code: 'SUMMER10', action: 'decrease', value: 5, valueKind: 'percent' });
    assert.strictEqual(own.code, 'SUMMER10', 'той самий код в іншій організації — вільний (інваріант 3)');
  });
  assert.strictEqual((await runWithOrganization(A, () => listRules(PROP))).length, mine.length, 'свої правила на місці');
  console.log('  ok  чужий орендар не бачить і не пише; код унікальний у межах організації');
} finally {
  await cleanup();
}

console.log('price-rules: правило пишеться через двері каналу, промо — з кодом і без каналу, невалідне відмовляє, чуже не існує');
