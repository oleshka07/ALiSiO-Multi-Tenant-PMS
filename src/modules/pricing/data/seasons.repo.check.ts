/**
 * Сезони (Блок 2 крок 1, Ц27): сутність, ціна сезон × тип × тариф, рендер у календар.
 *
 *   node src/modules/pricing/data/seasons.repo.check.ts
 *
 * ── Що стверджується ────────────────────────────────────────────────────
 *
 *   * сезони одного обʼєкта не перетинаються — перетин відмовляє з назвою;
 *     сусідні (кінець одного = день перед початком другого) — можна;
 *   * клітинка ціни РЕНДЕРИТЬСЯ в `price_calendar`: рядок на кожну ніч
 *     сезону з `source = 'season'`, тим самим писачем, що масовий редактор —
 *     тобто через двері `@channels/outbox` у тій самій транзакції (Ц16):
 *     ОДНА координата на пару тип × тариф на весь сезон (Ц15), не подобово,
 *     з маскою «ціна» (+ «закрито», коли ніч здобула джерело — Ц34 (б));
 *   * обмеження базового рядка (мінімум ночей) рендер не чіпає;
 *   * точкове перевизначення дати (`source = 'manual'`) перерендер НЕ
 *     затирає; «прибрати перевизначення» — окрема дія, і лише вона;
 *   * поділ сезону: ліва частина до дня перед датою, права — від дати;
 *     клітинки копіюються; сезони не перетинаються;
 *   * чужий орендар не бачить і не пише.
 *
 * Дві осі (інваріант 26): дві клітинки з РІЗНИМИ числами (100 і 120) на
 * одному типі — базова і тарифна; ціна вихідних у клітинці інша за буденну.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { createSeason, listSeasons, splitSeason, setSeasonPrice, seasonPrices, clearSeasonOverrides, deleteSeason } = await import('./seasons.repo.ts');
const { upsertPrices, bulkUpdatePrices } = await import('./price-calendar.repo.ts');
const { queuedChannelChanges: queuedChanges } = await import('@channels');

const sql = getSql();
const A = '__seasons__a';
const B = '__seasons__b';
const PROP = `${A}_prop`;
const DBL = `${A}_dbl`;
const BAR = `${A}_bar`;
const BB = `${A}_bb`;
const CONN = `${A}_conn`;

async function cleanup() {
  for (const org of [A, B]) {
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM season_prices WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM seasons WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM price_calendar WHERE unit_type_id = ?', [`${org}_dbl`]);
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
    await sql.run(
      `INSERT INTO unit_types (id, property_id, category_id, name, code, max_adults, max_children, max_occupancy, base_occupancy)
       VALUES (?, ?, ?, 'Double', 'DBL', 2, 0, 2, 2)`,
      [`${org}_dbl`, prop, `${org}_cat`],
    );
    for (const [id, code] of [[`${org}_bar`, 'BAR'], [`${org}_bb`, 'BB']]) {
      await sql.run(`INSERT INTO rate_plans (id, property_id, name, code, currency, is_active) VALUES (?, ?, ?, ?, 'EUR', TRUE)`, [id, prop, code, code]);
    }
    // Зʼєднання з дзеркалом: обидві пари змаплені — рендер має покласти по
    // координаті на кожну.
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment, webhook_token, webhook_secret, is_enabled, remote_property_id)
       VALUES (?, ?, ?, 'probe', 'staging', ?, ?, TRUE, 'remote')`,
      [`${org}_conn`, org, prop, `tok_${org}`, `sec_${org}`],
    );
    await sql.run(
      `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id) VALUES (?, ?, ?, 'unit_type', ?, '', 0, 'r-ut')`,
      [`${org}_m_ut`, org, `${org}_conn`, `${org}_dbl`],
    );
    for (const rp of [`${org}_bar`, `${org}_bb`]) {
      await sql.run(
        `INSERT INTO cm_mappings (id, organization_id, connection_id, entity_type, local_id, unit_type_id, occupancy, remote_id) VALUES (?, ?, ?, 'rate_plan', ?, ?, 0, ?)`,
        [`${org}_m_${rp}`, org, `${org}_conn`, rp, `${org}_dbl`, `r-${rp}`],
      );
    }
  });
}

const row = (date: string, ratePlanId: string | null) => sql.row<any>(
  `SELECT base_price, weekend_price, min_stay, source FROM price_calendar WHERE unit_type_id = ? AND date = ? AND ${ratePlanId ? 'rate_plan_id = ?' : 'rate_plan_id IS NULL'}`,
  ratePlanId ? [DBL, date, ratePlanId] : [DBL, date],
);

await cleanup();
await seed(A);
await seed(B);

try {
  await runWithOrganization(A, async () => {
    // ── 1. Перетин — відмова; сусідство — можна ─────────────────────────
    const summer = await createSeason({ propertyId: PROP, name: 'Літо', dateFrom: '2027-06-01', dateTo: '2027-08-31' });
    assert.ok(summer.id);
    await assert.rejects(() => createSeason({ propertyId: PROP, name: 'Перетин', dateFrom: '2027-08-15', dateTo: '2027-09-15' }), /season_overlap/,
      'сезони одного обʼєкта перетнулись — дві ціни на одну ніч');
    await assert.rejects(() => createSeason({ propertyId: PROP, name: 'Всередині', dateFrom: '2027-07-01', dateTo: '2027-07-10' }), /season_overlap/);
    await assert.rejects(() => createSeason({ propertyId: PROP, name: 'Навпаки', dateFrom: '2027-09-10', dateTo: '2027-09-01' }), /season_dates_invalid/, 'кінець раніше початку');
    const autumn = await createSeason({ propertyId: PROP, name: 'Осінь', dateFrom: '2027-09-01', dateTo: '2027-10-31' });
    assert.ok(autumn.id, 'сусідній сезон (з наступного дня) — не перетин');
    const listed = await listSeasons(PROP);
    assert.deepStrictEqual(listed.map((s) => s.name), ['Літо', 'Осінь'], 'сезони обʼєкта за датою початку');
    console.log('  ok  перетин сезонів — відмова з назвою; сусідні — можна');

    // ── 2. Клітинка рендериться в календар — через двері, одним діапазоном ─
    // Базовий рядок з мінімумом 3 на одну ніч ДО рендера: обмеження рендер не чіпає.
    await upsertPrices(DBL, [{ date: '2027-06-10', min_stay: 3 }]);
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);

    await setSeasonPrice(summer.id, { unitTypeId: DBL, ratePlanId: null, price: 100, weekendPrice: 130 });
    const first = await row('2027-06-01', null);
    const mid = await row('2027-07-15', null);
    const last = await row('2027-08-31', null);
    const after = await row('2027-09-01', null);
    assert.strictEqual(Number(first?.base_price), 100, 'перша ніч сезону отримала ціну клітинки');
    assert.strictEqual(Number(mid?.base_price), 100);
    assert.strictEqual(Number(last?.base_price), 100, 'остання ніч сезону включно');
    assert.strictEqual(after, undefined, 'ніч поза сезоном рядка не отримала');
    assert.strictEqual(Number(first?.weekend_price), 130, 'ціна вихідних клітинки рендериться разом');
    assert.strictEqual(first?.source, 'season', 'рядок з рендера позначений джерелом «сезон»');
    assert.strictEqual(Number((await row('2027-06-10', null))?.min_stay), 3, 'рендер не чіпає обмежень базового рядка');

    const queued = await queuedChanges(CONN);
    assert.strictEqual(queued.length, 2, `один діапазон на кожну змаплену пару (BAR×DBL, BB×DBL), а не ${queued.length} — базова ціна типу міняє кожен тариф`);
    assert.ok(queued.every((q) => q.kind === 'rate' && q.date === '2027-06-01' && q.dateTo === '2027-08-31'), 'координата — весь сезон одним діапазоном (Ц15), не подобово');
    assert.ok(queued.every((q) => q.fields && q.fields.includes('prices') && q.fields.includes('closed') && q.fields.length === 2),
      `ночі здобули джерело ціни — маска «ціна» + «закрито» (Ц34 (б)), а не ${JSON.stringify(queued.map((q) => q.fields))}`);
    console.log('  ok  клітинка рендериться в календар рядками «сезон», одна координата на пару, маска з різниці');

    // ── 3. Тарифна клітинка — інше число, окремий рядок тарифу ────────────
    await sql.run('DELETE FROM cm_outbox WHERE organization_id = ?', [A]);
    await setSeasonPrice(summer.id, { unitTypeId: DBL, ratePlanId: BB, price: 120, weekendPrice: null });
    assert.strictEqual(Number((await row('2027-07-15', BB))?.base_price), 120, 'клітинка тарифу — рядок тарифу');
    assert.strictEqual(Number((await row('2027-07-15', null))?.base_price), 100, 'базовий рядок при цьому цілий');
    const bbQueue = await queuedChanges(CONN);
    assert.deepStrictEqual(bbQueue.map((q) => q.ratePlanId), [BB], 'ціна тарифу — координата лише його пари (Ц10)');
    const cells = await seasonPrices(summer.id);
    assert.strictEqual(cells.length, 2, 'дві клітинки: базова і B&B');
    // Рецензія 07.09 п.3: клітинка ТАРИФУ не заводить базових рядків типу на
    // весь сезон (500 порожніх рядків із дефолтами обмежень). Осінь має лише
    // клітинку B&B — базових рядків на її дати не зʼявляється.
    await setSeasonPrice(autumn.id, { unitTypeId: DBL, ratePlanId: BB, price: 90, weekendPrice: null });
    const autumnBase = await sql.row<any>("SELECT COUNT(*) AS n FROM price_calendar WHERE unit_type_id = ? AND rate_plan_id IS NULL AND date >= '2027-09-01' AND date <= '2027-10-31'", [DBL]);
    assert.strictEqual(Number(autumnBase?.n ?? 0), 0, `клітинка тарифу завела ${autumnBase?.n} базових рядків типу — має нуль`);
    assert.strictEqual(Number((await row('2027-09-15', BB))?.base_price), 90, 'а рядок тарифу є');
    // Рецензія 07.09 п.4: клітинка сезону на ПОХІДНИЙ тариф — відмова: його
    // рядки рахує перерендер бази, сезон їх переписав би.
    await sql.run(
      `INSERT INTO rate_plans (id, property_id, name, code, currency, is_active, pricing_type, based_on_rate_plan_id, adjustment_kind, adjustment_value, adjustment_direction)
       VALUES (?, ?, 'Derived', 'DER', 'EUR', TRUE, 'derived', ?, 'percent', 10, 'decrease')`, [`${A}_der`, PROP, BAR]);
    await assert.rejects(() => setSeasonPrice(summer.id, { unitTypeId: DBL, ratePlanId: `${A}_der`, price: 100, weekendPrice: null }), /rate_plan_derived/,
      'клітинка сезону на похідний — відмова з назвою');
    console.log('  ok  клітинка тарифу рендериться у власний рядок, координата лише його пари; базових рядків не заводить; похідний — відмова');

    // ── 4. Перевизначення дати лишається; прибрати — окрема дія ──────────
    await upsertPrices(DBL, [{ date: '2027-07-04', base_price: 999 }]);
    assert.strictEqual((await row('2027-07-04', null))?.source, 'manual', 'ціна з редактора дня — «manual»');
    // Рецензія 07.09 п.5: сезон каже оператору, скільки ночей у нього мають
    // ручні перевизначення — інакше новий сезон у готелі з набраним календарем
    // «нічого не міняє», і ніхто не знає чому.
    assert.strictEqual((await listSeasons(PROP)).find((s) => s.id === summer.id)?.manualOverrides, 1, 'одна ніч з ручним перевизначенням названа в сезоні');
    await setSeasonPrice(summer.id, { unitTypeId: DBL, ratePlanId: null, price: 110, weekendPrice: 130 });
    assert.strictEqual(Number((await row('2027-07-04', null))?.base_price), 999, 'перерендер сезону затер точкове перевизначення дати');
    assert.strictEqual(Number((await row('2027-07-05', null))?.base_price), 110, 'сусідня ніч без перевизначення отримала нову ціну сезону');
    await clearSeasonOverrides(summer.id);
    const cleared = await row('2027-07-04', null);
    assert.strictEqual(Number(cleared?.base_price), 110, '«прибрати перевизначення» повертає ціну сезону');
    assert.strictEqual(cleared?.source, 'season');
    assert.strictEqual((await listSeasons(PROP)).find((s) => s.id === summer.id)?.manualOverrides, 0, 'після прибирання — жодного');
    console.log('  ok  перевизначення дати переживає перерендер; «прибрати перевизначення» — окрема дія');

    // ── 5. Масовий редактор і надалі пише «manual» ────────────────────────
    await bulkUpdatePrices({ unitTypeId: DBL, dateFrom: '2027-08-01', dateTo: '2027-08-03', applyTo: 'all', base_price: 150 });
    assert.strictEqual((await row('2027-08-02', null))?.source, 'manual', 'масовий редактор — теж перевизначення');
    assert.strictEqual((await row('2027-08-04', null))?.source, 'season', 'поза його діапазоном — сезон');

    // ── 6. Поділ сезону: клітинки копіюються, перетину немає ─────────────
    const { left, right } = await splitSeason(summer.id, '2027-07-15');
    assert.strictEqual(left.dateTo, '2027-07-14', 'ліва частина — до дня перед датою поділу');
    assert.strictEqual(right.dateFrom, '2027-07-15', 'права — від дати поділу');
    assert.strictEqual(right.dateTo, '2027-08-31');
    assert.strictEqual((await seasonPrices(right.id)).length, 2, 'клітинки скопійовано в праву частину');
    assert.strictEqual((await seasonPrices(left.id)).length, 2);
    await assert.rejects(() => splitSeason(right.id, '2027-07-15'), /season_split_invalid/, 'поділ на першому дні не робить порожньої частини');
    assert.strictEqual((await listSeasons(PROP)).length, 3);
    console.log('  ok  поділ сезону: дві частини без перетину, клітинки в обох');

    // ── 7. Видалення сезону лишає ціни в календарі ────────────────────────
    await deleteSeason(autumn.id);
    assert.ok(!(await listSeasons(PROP)).some((s) => s.id === autumn.id));
    assert.strictEqual(Number((await row('2027-08-31', null))?.base_price), 110, 'ціни в календарі після видалення сезону лишаються — сезон це конфігурація, не джерело');
  });

  // ── 8. Чужий орендар ──────────────────────────────────────────────────
  await runWithOrganization(B, async () => {
    assert.deepStrictEqual(await listSeasons(PROP), [], 'чужий обʼєкт — порожньо');
    const mine = await runWithOrganization(A, () => listSeasons(PROP));
    await assert.rejects(() => setSeasonPrice(mine[0].id, { unitTypeId: DBL, ratePlanId: null, price: 1, weekendPrice: null }), /season_not_found/,
      'чужий сезон для іншого орендаря не існує (інваріант 5)');
    await assert.rejects(() => createSeason({ propertyId: PROP, name: 'Чужий', dateFrom: '2028-01-01', dateTo: '2028-01-31' }), /property_not_found/);
  });
  console.log('  ok  чужий орендар не бачить і не пише');
} finally {
  await cleanup();
}

console.log('seasons: без перетинів, рендер у календар через двері одним діапазоном, перевизначення живе, поділ копіює клітинки');
