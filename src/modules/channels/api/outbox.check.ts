/**
 * Двері писачів: «змінилось» → координата в черзі кожного зʼєднання обʼєкта.
 *
 *   node src/modules/channels/api/outbox.check.ts
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 *   * ціна типу → по одній координаті на ЗМАПЛЕНУ пару тип × тариф, на
 *     кожному зʼєднанні обʼєкта, вимкненому теж;
 *   * незмаплений тип → нічого: нема кому адресувати, а через десять
 *     проходів це стало б «потребує уваги» ні за що;
 *   * без типу — усі пари обʼєкта; без кінця — до горизонту;
 *   * діапазон обрізається сьогоднішнім днем; цілком минулий — не пишеться;
 *   * та сама зміна двічі — один рядок (індекс злиття);
 *   * чужий обʼєкт — нічого, і чужа черга не чіпається (404, не 403);
 *   * `t` — транзакція писача: відкат забирає координату разом зі зміною.
 *
 * ── Про останнє чесно ───────────────────────────────────────────────────
 *
 * На SQLite одне зʼєднання, тож і «правильний» `t`, і забутий `getSql()`
 * усередині транзакції відкотяться однаково: ця вісь тут ВИРОДЖЕНА
 * (інваріант 26), і твердження доводить лише семантику відкату й форму
 * виклику. Розрізняє їх тільки справжній Postgres із пулом — стенд AGENTS §7;
 * саме там 01.09.2026 і побачено, що `applyRevision` під `deps.tx` писав
 * повз транзакцію. Мовчання цього гейта про пул — не доведеність.
 *
 * Перевірка була ЧЕРВОНОЮ — зламом дверей (вимкнене зʼєднання пропущене).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { noteAvailabilityChanged, noteRatesChanged, clipToHorizon } = await import('./outbox.ts');
const { queuedChanges, pendingCount, OUTBOX_HORIZON_DAYS } = await import('../data/outbox.repo.ts');

const sql = getSql();
const A = '__obdoor__a';
const B = '__obdoor__b';
const TODAY = '2026-11-01';
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

async function cleanup() {
  for (const org of [A, B]) {
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

/**
 * Обʼєкт із ДВОМА зʼєднаннями (друге вимкнене) і двома типами: UT1 змаплений
 * на обох, UT2 — ніде. Пари: RP1×UT1 на обох, RP2×UT1 лише на першому.
 * Типи й тарифи тут — самі ідентифікатори в дзеркалі: дверям потрібне
 * дзеркало, а не таблиці типів.
 */
async function seed(org: string, connections: { id: string; enabled: boolean; environment: string; pairs: [string, string][] }[]) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [`${org}_prop`, org, org, `${org}_prop`]);
    for (const c of connections) {
      // Два зʼєднання одного обʼєкта — у РІЗНИХ середовищах: одна пара
      // «провайдер × середовище» на обʼєкт тримається UNIQUE (0052).
      // Прапорець — літералом TRUE/FALSE, не параметром 1/0: колонка BOOLEAN на
      // Postgres відхиляє ціле число, і ця перевірка ганяється на обох двигунах.
      await sql.run(
        `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment, webhook_token, webhook_secret, is_enabled, remote_property_id)
         VALUES (?, ?, ?, 'probe', ?, ?, ?, ${c.enabled ? 'TRUE' : 'FALSE'}, 'remote')`,
        [c.id, org, `${org}_prop`, c.environment, `tok_${c.id}`, `sec_${c.id}`],
      );
      await sql.run(
        `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
         VALUES (?, ?, ?, 'unit_type', 'UT1', '', 0, ?)`,
        [`${c.id}_m_ut1`, org, c.id, `${c.id}-ut1`],
      );
      for (const [rp, ut] of c.pairs) {
        await sql.run(
          `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id)
           VALUES (?, ?, ?, 'rate_plan', ?, ?, 0, ?)`,
          [`${c.id}_m_${rp}_${ut}`, org, c.id, rp, ut, `${c.id}-${rp}-${ut}`],
        );
      }
    }
  });
}

await cleanup();
await seed(A, [
  { id: `${A}_c1`, enabled: true, environment: 'staging', pairs: [['RP1', 'UT1'], ['RP2', 'UT1']] },
  { id: `${A}_c2`, enabled: false, environment: 'production', pairs: [['RP1', 'UT1']] },
]);
await seed(B, [{ id: `${B}_c1`, enabled: true, environment: 'staging', pairs: [['RP1', 'UT1']] }]);
const PROP = `${A}_prop`;
const C1 = `${A}_c1`;
const C2 = `${A}_c2`;

try {
  await runWithOrganization(A, async () => {
    // ── Ціна типу → кожна змаплена пара, на кожному зʼєднанні ─────────────
    const n = await noteRatesChanged(sql, { propertyId: PROP, unitTypeId: 'UT1', from: '2026-11-10', to: '2026-11-12' }, TODAY);
    assert.strictEqual(n, 3, 'RP1×UT1 і RP2×UT1 на першому, RP1×UT1 на другому — три координати');
    const c1 = await queuedChanges(C1);
    assert.deepStrictEqual(c1.map((r) => `${r.ratePlanId}×${r.unitTypeId}`).sort(), ['RP1×UT1', 'RP2×UT1']);
    assert.strictEqual(c1[0].date, '2026-11-10');
    assert.strictEqual(c1[0].dateTo, '2026-11-12', 'три ночі мали лягти одним діапазоном, а не однією ніччю');
    const c2 = await queuedChanges(C2);
    assert.strictEqual(c2.length, 1, 'ВИМКНЕНЕ зʼєднання теж отримує чергу — після вмикання канал має дістати поточний стан');
    console.log('  ok  ціна типу → координата на кожну змаплену пару, вимкненому зʼєднанню теж');

    // ── Та сама зміна двічі — один рядок ──────────────────────────────────
    await noteRatesChanged(sql, { propertyId: PROP, unitTypeId: 'UT1', from: '2026-11-10', to: '2026-11-12' }, TODAY);
    assert.strictEqual(await pendingCount(C1, 'rate'), 2, 'повтор тієї самої зміни здвоїв чергу — це зайві виклики з ліміту');

    // ── Незмаплений тип — нічого ──────────────────────────────────────────
    assert.strictEqual(await noteRatesChanged(sql, { propertyId: PROP, unitTypeId: 'UT2', from: '2026-11-10', to: '2026-11-12' }, TODAY), 0,
      'незмаплений тип отримав координату — її нема кому адресувати, і вона застрягне ні за що');
    assert.strictEqual(await noteAvailabilityChanged(sql, { propertyId: PROP, unitTypeId: 'UT2', from: '2026-11-10', to: '2026-11-12' }, TODAY), 0);
    console.log('  ok  незмаплений тип не отримує координати');

    // ── Ціна ТАРИФУ на дату — лише його пара (Ц10, П2 карти сертифікації) ──
    //
    // Писач календаря передає `ratePlanId`; двері мають покласти координату
    // на пару саме цього тарифу і жодну іншу — інакше ціна B&B поїхала б і
    // на BAR. Діапазон інший, ніж вище, щоб не злитись із наявним рядком.
    const only = await noteRatesChanged(sql, { propertyId: PROP, unitTypeId: 'UT1', ratePlanId: 'RP2', from: '2026-11-20', to: '2026-11-21' }, TODAY);
    assert.strictEqual(only, 1, 'RP2×UT1 є лише на першому зʼєднанні — одна координата');
    const scoped = (await queuedChanges(C1)).filter((r) => r.date === '2026-11-20');
    assert.deepStrictEqual(scoped.map((r) => `${r.ratePlanId}×${r.unitTypeId}`), ['RP2×UT1'], 'ціна тарифу — координата ЛИШЕ його пари, не сусіднього тарифу');
    console.log('  ok  ціна тарифу на дату → координата лише його пари');

    // ── Без типу — усі пари; без кінця — до горизонту ─────────────────────
    const all = await noteRatesChanged(sql, { propertyId: PROP, from: '2027-01-01', to: null }, TODAY);
    assert.strictEqual(all, 3, 'матриця без типу — це всі пари обʼєкта');
    const open = (await queuedChanges(C1)).find((r) => r.date === '2027-01-01')!;
    assert.strictEqual(open.dateTo, addDays(TODAY, OUTBOX_HORIZON_DAYS - 1),
      'кінець без дати мав стати горизонтом — далі ночі не існує ні для кого');
    console.log('  ok  без типу — усі пари; без кінця — до горизонту');

    // ── Обрізання сьогоднішнім днем; цілком минуле не пишеться ────────────
    const straddle = await noteAvailabilityChanged(sql, { propertyId: PROP, unitTypeId: 'UT1', from: addDays(TODAY, -2), to: addDays(TODAY, 1) }, TODAY);
    assert.strictEqual(straddle, 2, 'наявність — по одній на зʼєднання');
    const av = (await queuedChanges(C1)).find((r) => r.kind === 'availability')!;
    assert.strictEqual(av.date, TODAY, 'початок у минулому мав обрізатись сьогоднішнім днем');
    assert.strictEqual(av.dateTo, addDays(TODAY, 1));
    assert.strictEqual(await noteAvailabilityChanged(sql, { propertyId: PROP, unitTypeId: 'UT1', from: addDays(TODAY, -5), to: addDays(TODAY, -1) }, TODAY), 0,
      'зміна цілком у минулому лягла в чергу — вона не поїде ніколи');
    console.log('  ok  діапазон обрізається сьогоднішнім днем, минуле не пишеться');

    // ── Відкат транзакції забирає координату разом зі зміною ──────────────
    const before = await pendingCount(C1);
    // Дати всередині горизонту — інакше двері нічого не пишуть і відкат «доводиться» порожнечею.
    assert.ok(clipToHorizon('2027-05-01', '2027-05-02', TODAY), 'сцена відкату мусить лежати в горизонті');
    await assert.rejects(() => sql.tx(async (t) => {
      await noteRatesChanged(t, { propertyId: PROP, unitTypeId: 'UT1', ratePlanId: 'RP1', from: '2027-05-01', to: '2027-05-02' }, TODAY);
      throw new Error('зміна не вдалась');
    }));
    assert.strictEqual(await pendingCount(C1), before, 'координата пережила відкат зміни — черга розійшлась зі станом');
    console.log('  ok  відкат транзакції писача забирає координату (вісь пулу — лише на Postgres, див. шапку)');

    // ── Пара, названа повністю — лише вона ────────────────────────────────
    assert.strictEqual(await noteRatesChanged(sql, { propertyId: PROP, unitTypeId: 'UT1', ratePlanId: 'RP2', from: '2027-06-01', to: '2027-06-01' }, TODAY), 1,
      'RP2×UT1 змаплена лише на першому зʼєднанні');
  });

  // ── Чужий обʼєкт — нічого, і чужа черга ціла ────────────────────────────
  await runWithOrganization(B, async () => {
    assert.strictEqual(await noteAvailabilityChanged(sql, { propertyId: PROP, unitTypeId: 'UT1', from: '2026-11-10', to: '2026-11-12' }, TODAY), 0,
      'чужий обʼєкт отримав координати — зміни сусіда поїхали б чужим ключем');
    assert.strictEqual(await pendingCount(`${B}_c1`), 0, 'своя черга сусіда не мала зʼявитись від чужої зміни');
  });
  await runWithOrganization(A, async () => {
    assert.ok(await pendingCount(C1) > 0, 'своя черга зникла');
  });
  console.log('  ok  чужий обʼєкт не отримує координат, чужа черга ціла');

  // ── clipToHorizon окремо: межі включно ────────────────────────────────
  assert.deepStrictEqual(clipToHorizon('2026-10-30', '2026-11-03', TODAY), { from: TODAY, to: '2026-11-03' });
  assert.strictEqual(clipToHorizon('2026-10-01', '2026-10-31', TODAY), null, 'жодної ночі не лишилось');
  assert.deepStrictEqual(clipToHorizon(TODAY, TODAY, TODAY), { from: TODAY, to: TODAY }, 'одна ніч сьогодні — не порожньо');
  assert.strictEqual(clipToHorizon(TODAY, null, TODAY)!.to, addDays(TODAY, OUTBOX_HORIZON_DAYS - 1));
} finally {
  await cleanup();
}

console.log('outbox door: зміна обʼєкта стає координатою кожного змапленого зʼєднання, у транзакції писача');
