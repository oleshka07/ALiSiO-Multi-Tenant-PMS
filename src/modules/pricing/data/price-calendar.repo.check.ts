/**
 * Ціна тарифу на дату: два тарифи одного типу, одна дата, дві ціни — і обидва споживачі бачать обидві.
 *
 *   node src/modules/pricing/data/price-calendar.repo.check.ts
 *
 * П2 карти сертифікації, і це гроші (інваріант 29): BAR 100 і B&B 120 на
 * тому самому типі в той самий день. Рядок `price_calendar` з `rate_plan_id`
 * — власна ціна тарифу; базовий рядок (`rate_plan_id IS NULL`) — ціна типу,
 * яку тариф без власного рядка успадковує. Котирування читає рядок тарифу
 * першим (`nightly-price.ts`), батчер питає котирування — тож обидва
 * споживачі мають побачити ДВІ різні ціни, а не одну (інваріант 26: фікстура
 * з двома тарифами, і числа несумісні з «узяли базу»).
 *
 * Черга каналів тут НЕ читається: її таблиці належать модулю каналів, і те,
 * що ціна ТАРИФУ кладе координату лише на його пару, доводить гейт дверей у
 * тому модулі (`channels/api/outbox.check.ts`) через фасад `@pricing`.
 *
 * Перевірка написана ДО коду і була червоною (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { upsertPrices, bulkUpdatePrices, getPriceMonth } = await import('./price-calendar.repo.ts');
const { priceNights } = await import('./nightly-price.ts');

const sql = getSql();
const A = '__pc2__a';
const B = '__pc2__b';
const PROP = (o: string) => `${o}_prop`;
const UT = (o: string) => `${o}_dbl`;
const BAR = (o: string) => `${o}_bar`;
const BB = (o: string) => `${o}_bb`;
const D1 = '2026-11-25';
const D2 = '2026-11-26';

async function cleanup() {
  for (const o of [A, B]) {
    await sql.run('DELETE FROM price_calendar WHERE unit_type_id = ?', [UT(o)]);
    await sql.run('DELETE FROM rate_plans WHERE property_id = ?', [PROP(o)]);
    await sql.run('DELETE FROM unit_types WHERE id = ?', [UT(o)]);
    await sql.run('DELETE FROM categories WHERE property_id = ?', [PROP(o)]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [o]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [o]);
  }
}
async function seed(o: string) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [o, o, o]);
  await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP(o), o, o, PROP(o)]);
  await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [`${o}_cat`, PROP(o), 'Rooms', 'room']);
  await sql.run(
    `INSERT INTO unit_types (id, property_id, category_id, name, code, max_adults, max_children, max_occupancy, base_occupancy)
     VALUES (?, ?, ?, 'Double', 'DBL', 2, 0, 2, 2)`,
    [UT(o), PROP(o), `${o}_cat`],
  );
  for (const [id, code, name] of [[BAR(o), 'BAR', 'Best Available'], [BB(o), 'BB', 'Bed & Breakfast']]) {
    await sql.run(
      `INSERT INTO rate_plans (id, property_id, name, code, pricing_model, currency, priority) VALUES (?, ?, ?, ?, 'standard', 'USD', 1)`,
      [id, PROP(o), name, code],
    );
  }
}
const quote = (o: string, ratePlanId: string | undefined, date = D1) => runWithOrganization(o, () =>
  priceNights({ unitTypeId: UT(o), checkIn: date, nights: 1, adults: 2, children: 0, ratePlanId }));

await cleanup();
await seed(A);
await seed(B);

try {
  // ── 1. База 100 — обидва тарифи успадковують ──────────────────────────
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, base_price: 100 }, { date: D2, base_price: 100 }]));
  assert.strictEqual((await quote(A, BAR(A))).nights[0]?.price, 100, 'BAR без власного рядка — база');
  assert.strictEqual((await quote(A, BB(A))).nights[0]?.price, 100, 'B&B без власного рядка — база');
  console.log('  ok  база: обидва тарифи успадковують');

  // ── 2. Власна ціна B&B 120 на D1: BAR лишається 100, B&B стає 120 ────
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, base_price: 120 }], { ratePlanId: BB(A) }));
  assert.strictEqual((await quote(A, BAR(A))).nights[0]?.price, 100, 'ціна B&B не зачепила BAR');
  assert.strictEqual((await quote(A, BB(A))).nights[0]?.price, 120, 'B&B — власна ціна');
  assert.strictEqual((await quote(A, undefined)).nights[0]?.price, 100, 'без тарифу — база, не 120');
  assert.strictEqual((await quote(A, BB(A), D2)).nights[0]?.price, 100, 'на сусідній день B&B знову успадковує базу');
  const base = await runWithOrganization(A, () => getPriceMonth(UT(A), 11, 2026));
  assert.strictEqual(base.days.find((d) => d.date === D1)?.base_price, 100, 'сітка бази показує базу, не ціну тарифу');
  console.log('  ok  ціна тарифу на дату: два тарифи, одна дата, дві ціни');

  // ── 3. Сітка тарифу: власне число, де є, і успадковане, де немає ──────
  const plan = await runWithOrganization(A, () => getPriceMonth(UT(A), 11, 2026, BB(A)));
  const d1 = plan.days.find((d) => d.date === D1)!;
  const d2 = plan.days.find((d) => d.date === D2)!;
  assert.strictEqual(d1.base_price, 120);
  assert.strictEqual(d1.inherited, false, 'D1 — власна ціна тарифу');
  assert.strictEqual(d2.base_price, 100);
  assert.strictEqual(d2.inherited, true, 'D2 — успадкована від типу, і це названо');
  console.log('  ok  сітка тарифу відрізняє власну ціну від успадкованої');

  // ── 4. Масово на діапазон для тарифу ─────────────────────────────────
  await runWithOrganization(A, () => bulkUpdatePrices({ unitTypeId: UT(A), dateFrom: D1, dateTo: D2, base_price: 130, ratePlanId: BB(A) }));
  assert.strictEqual((await quote(A, BB(A), D2)).nights[0]?.price, 130, 'масово — власна ціна тарифу на кожен день діапазону');
  assert.strictEqual((await quote(A, BAR(A), D2)).nights[0]?.price, 100, 'BAR не зачеплений');
  console.log('  ok  масово: діапазон для тарифу');

  // ── 5. Чужий тариф — відмова, і нічого не записано ────────────────────
  await runWithOrganization(A, () => assert.rejects(() => upsertPrices(UT(A), [{ date: D1, base_price: 1 }], { ratePlanId: BB(B) }), /rate plan not found/i,
    'тариф іншого готелю на нашому типі — «not found»'));
  await runWithOrganization(B, () => assert.rejects(() => upsertPrices(UT(A), [{ date: D1, base_price: 1 }], { ratePlanId: BB(A) }), /not found/i,
    'чужий орендар не пише ціни на наш тип'));
  assert.strictEqual((await quote(A, BB(A))).nights[0]?.price, 130, 'ціна не змінилась');
  console.log('  ok  чужий тариф і чужий орендар — відмова без запису');

  // ── 6. Писач називає тариф дверям каналів — статично ─────────────────
  //
  // Куди лягає координата, доводить гейт дверей у модулі каналів (його
  // таблиці; `ari-adapter.check` сцена 12). Тут — друга половина: обидва
  // писачі йдуть через одні двері (`noteCalendarChanged`), і там ЦІНА
  // називає тариф (інакше ціна тарифу поїхала б на всі пари типу, Ц10), а
  // ОБМЕЖЕННЯ — не називає (вони на типі, П7/Ц32, і мають поїхати на кожну
  // пару; Блок 0.6 A1).
  {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./price-calendar.repo.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const calls = [...src.matchAll(/noteRatesChanged\(t, \{([^}]*)\}/g)].map((m) => m[1]);
    assert.strictEqual(calls.length, 2, 'двері каналів — рівно два виклики: ціна пари й обмеження типу');
    const price = calls.find((a) => /priceFields/.test(a));
    const restriction = calls.find((a) => /restrictionFields/.test(a));
    assert.ok(price && /ratePlanId:/.test(price), `координата ціни мусить називати тариф: {${price?.trim()}}`);
    assert.ok(restriction && !/ratePlanId:/.test(restriction), `координата обмежень НЕ називає тариф — вона на всі пари типу: {${restriction?.trim()}}`);
    assert.strictEqual([...src.matchAll(/noteCalendarChanged\(t, \{/g)].length, 2, 'обидва писачі календаря йдуть через ті самі двері');
  }
  console.log('  ok  двері каналів: ціна називає тариф, обмеження — тип');

  // ── 7. Обмеження без ціни — рядок без ціни, а не ціна нуль (2.0) ─────
  //
  // 05.09.2026, бета: оператор поставив «мін. 2 ночі» на день без ціни, і
  // редактор дня записав `base_price = 0`. Нуль — це ціна, не її
  // відсутність: котирування продало ніч за 0, батчер відправив 0 у канал,
  // звірка сказала «збігається». Інваріант 17 читається так: ціни немає —
  // це NULL, ніч у `missing`, обмеження при цьому лишається.
  const D3 = '2026-11-27';
  const D4 = '2026-11-28';
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D3, min_stay: 2 }]));
  const bare = await sql.row<any>('SELECT base_price FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id IS NULL', [UT(A), D3]);
  assert.ok(bare, 'рядок обмеження існує');
  assert.strictEqual(bare.base_price, null, `ціни немає — NULL, не ${bare.base_price}`);
  const unpriced = await quote(A, BAR(A), D3);
  assert.deepStrictEqual(unpriced.missing, [D3], 'ніч без ціни — у missing, не продана за 0');
  assert.strictEqual(unpriced.restrictions.minStay, 2, 'обмеження при цьому діє');
  const grid = await runWithOrganization(A, () => getPriceMonth(UT(A), 11, 2026));
  const g3 = grid.days.find((d) => d.date === D3)!;
  assert.strictEqual(g3.hasData, true, 'сітка знає про рядок');
  assert.strictEqual(g3.effective_price, null, 'і показує «ціни немає», а не 0');
  console.log('  ok  обмеження на день без ціни лишає ціну порожньою, ніч не продається');

  // ── 8. Нуль і відʼємне — відмова з назвою ─────────────────────────────
  await runWithOrganization(A, () => assert.rejects(() => upsertPrices(UT(A), [{ date: D3, base_price: 0 }]), /price_not_positive/, 'нуль — відмова'));
  await runWithOrganization(A, () => assert.rejects(() => upsertPrices(UT(A), [{ date: D3, base_price: -5 }]), /price_not_positive/, 'відʼємне — відмова'));
  await runWithOrganization(A, () => assert.rejects(() => bulkUpdatePrices({ unitTypeId: UT(A), dateFrom: D3, dateTo: D4, base_price: 0 }), /price_not_positive/, 'масово нуль — відмова'));
  assert.deepStrictEqual((await quote(A, BAR(A), D3)).missing, [D3], 'після відмови ніч так само без ціни');
  console.log('  ok  нуль і відʼємне не записуються, а відмовляють з назвою');

  // ── 9. Обмеження на день З ціною не стирає ціну ──────────────────────
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, closed: true }]));
  const closedQuote = await quote(A, BAR(A), D1);
  assert.deepStrictEqual(closedQuote.closed, [D1], 'день закрито');
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, closed: false }]));
  assert.strictEqual((await quote(A, BAR(A), D1)).nights[0]?.price, 100, 'ціна 100 пережила два збереження без поля ціни');
  // Ціна вихідних — теж ціна (рецензія 2.0, 05.09.2026): `base_price` без
  // поля не чіпалась, а `weekend_price` без поля затиралась NULL — і з
  // пʼятниці по неділю продавалась буденна ціна без жодної помилки. Дві осі
  // (інваріант 26): 100 і 130 — різні числа, і після збереження обмеження
  // без жодного з полів ціни рядок має тримати обидва.
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, base_price: 100, weekend_price: 130 }]));
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, min_stay: 2 }]));
  const kept = await sql.row<any>('SELECT base_price, weekend_price, min_stay FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id IS NULL', [UT(A), D1]);
  assert.strictEqual(Number(kept.base_price), 100, 'базова ціна пережила збереження обмеження');
  assert.strictEqual(kept.weekend_price == null ? null : Number(kept.weekend_price), 130, `ціна вихідних затерлась збереженням обмеження без поля ціни: ${kept.weekend_price}`);
  assert.strictEqual(Number(kept.min_stay), 2, 'а обмеження записане');
  // Явний `null` — це «прибрати ціну вихідних», і його треба вміти сказати.
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, weekend_price: null }]));
  const cleared = await sql.row<any>('SELECT weekend_price FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id IS NULL', [UT(A), D1]);
  assert.strictEqual(cleared.weekend_price, null, 'явний null прибирає ціну вихідних');
  console.log('  ok  збереження обмеження без поля ціни не чіпає ні базову ціну, ні ціну вихідних; явний null прибирає');

  // ── 10. Масово обмеження на діапазон без цін — рядки без ціни ────────
  await runWithOrganization(A, () => bulkUpdatePrices({ unitTypeId: UT(A), dateFrom: D3, dateTo: D4, min_stay: 3 }));
  const bulkQuote = await quote(A, BAR(A), D4);
  assert.deepStrictEqual(bulkQuote.missing, [D4], 'масове обмеження не вигадує ціни');
  assert.strictEqual(bulkQuote.restrictions.minStay, 3, 'а обмеження записане');
  console.log('  ok  масове обмеження на діапазон без цін — рядки без ціни');

  // ── 11. Обмеження з екрана ТАРИФУ — на тип: котирування іншого тарифу й обидві сітки бачать його ──
  //
  // Блок 0.6 A1. Обмеження живуть у базовому рядку (П7, Ц32); редактор дня з
  // вибраним тарифом писав їх у рядок тарифу — котирування BAR і канал їх не
  // бачили, а сітка B&B показувала. Осі: мінімум 3 проти 1; ціна B&B (130)
  // при цьому лишається своєю, а BAR — базовою (100), тобто «усе на базу»
  // не пройде.
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D2, min_stay: 3 }], { ratePlanId: BB(A) }));
  assert.strictEqual((await quote(A, BAR(A), D2)).restrictions.minStay, 3, 'мінімум, поставлений з екрана B&B, діє на BAR — він на типі');
  assert.strictEqual((await quote(A, BB(A), D2)).nights[0]?.price, 130, 'ціна B&B при цьому не зачеплена');
  assert.strictEqual((await quote(A, BAR(A), D2)).nights[0]?.price, 100, 'і базова — теж');
  const baseGrid = await runWithOrganization(A, () => getPriceMonth(UT(A), 11, 2026));
  const planGrid = await runWithOrganization(A, () => getPriceMonth(UT(A), 11, 2026, BB(A)));
  assert.strictEqual(baseGrid.days.find((d) => d.date === D2)?.min_stay, 3, 'сітка бази показує мінімум');
  assert.strictEqual(planGrid.days.find((d) => d.date === D2)?.min_stay, 3, 'сітка тарифу показує той самий мінімум — з базового рядка');
  assert.strictEqual(planGrid.days.find((d) => d.date === D2)?.base_price, 130, 'а ціну — свою');
  const planRow = await sql.row<any>('SELECT min_stay FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id = ?', [UT(A), D2, BB(A)]);
  assert.strictEqual(Number(planRow?.min_stay ?? 1), 1, 'рядок тарифу обмеження не несе');
  console.log('  ok  обмеження з екрана тарифу — на тип: котирування, сітка бази й сітка тарифу бачать одне число');

  console.log('price-calendar: ціна тарифу на дату — своя, успадкована названа, чуже — відмова; ціни немає — NULL, нуль — відмова');
} finally {
  await cleanup();
}
