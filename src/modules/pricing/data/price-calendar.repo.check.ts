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
const D3 = '2026-11-27';
const D4 = '2026-11-28';

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

  // ── 6. Писач іде дверима каналів — статично ──────────────────────────
  //
  // Куди лягає координата, доводить гейт дверей у модулі каналів (його
  // таблиці; `ari-adapter.check` сцени 12 і 14). Тут — друга половина: обидва
  // писачі йдуть через одні двері (`noteCalendarChanged`); ціна пари називає
  // тариф (Ц10); обмеження називають тариф, коли записані в рядок ПАРИ, і не
  // називають, коли в базовий рядок типу (Ц32 переглянуто 07.09).
  //
  // ОХОПЛЕННЯ координати обмежень у цьому файлі більше не стверджується
  // статично: до 07.09 тут стояло «координата обмежень тарифу не називає»,
  // і після Ц32 це твердження стало хибним. Замінити його рядком про
  // протилежне не можна — обидва варіанти правильні, вибір робить область
  // (`restrictionsScope`), а її наслідок видно лише на живих таблицях черги.
  // Тому охоплення доводять сцени 12 і 14 `ari-adapter.check`, а сцена 13
  // нижче — те, що екран не називає області, якої оператор не просив.
  {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./price-calendar.repo.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const calls = [...src.matchAll(/noteRatesChanged\(t, \{([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(calls.length >= 2, 'двері каналів — щонайменше два виклики: ціна пари й обмеження');
    const price = calls.find((a) => /priceFields/.test(a));
    assert.ok(price && /ratePlanId:/.test(price), `координата ціни мусить називати тариф: {${price?.trim()}}`);
    assert.strictEqual([...src.matchAll(/noteCalendarChanged\(t, \{/g)].length, 2, 'обидва писачі календаря йдуть через ті самі двері');
  }
  console.log('  ok  двері каналів: обидва писачі через одні двері, ціна називає тариф');

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

  // ── 11. Обмеження на ТАРИФІ: своє в пари, успадковане від типу (Ц32 переглянуто 07.09) ──
  //
  // Тести 5/7/8 сертифікації ставлять різні обмеження на різні тарифи одного
  // типу; Hoteliera тримає min/max на тарифі, Channex — на тарифі за
  // означенням. Ефективне обмеження пари = значення на рядку пари, якщо
  // задане (NOT NULL), інакше базовий рядок типу. Тип — зручність запису «на
  // всі тарифи»; власне значення пари він не затирає.
  //
  // Осі (інваріант 26): дві пари одного типу (BAR і B&B); мінімум 3 на парі
  // проти 1 у типу; потім тип 2 — B&B бере 2, BAR тримає своє 3; `null` на
  // парі — назад до типу (2). Ціна при цьому не зачеплена (130 і 100).
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D2, min_stay: 3 }], { ratePlanId: BB(A) }));
  assert.strictEqual((await quote(A, BB(A), D2)).restrictions.minStay, 3, 'мінімум на B&B — діє на B&B');
  assert.strictEqual((await quote(A, BAR(A), D2)).restrictions.minStay, 1, 'а BAR його не бачить: обмеження — на тарифі, не на типі');
  assert.strictEqual((await quote(A, BB(A), D2)).nights[0]?.price, 130, 'ціна B&B при цьому не зачеплена');
  assert.strictEqual((await quote(A, BAR(A), D2)).nights[0]?.price, 100, 'і базова — теж');
  const baseGrid = await runWithOrganization(A, () => getPriceMonth(UT(A), 11, 2026));
  const planGrid = await runWithOrganization(A, () => getPriceMonth(UT(A), 11, 2026, BB(A)));
  assert.strictEqual(baseGrid.days.find((d) => d.date === D2)?.min_stay, 1, 'сітка типу — мінімум типу (1)');
  assert.strictEqual(planGrid.days.find((d) => d.date === D2)?.min_stay, 3, 'сітка тарифу — ефективний мінімум пари (3)');
  assert.strictEqual(planGrid.days.find((d) => d.date === D2)?.restrictionsOwn, true, 'і каже, що це ВЛАСНЕ значення пари');
  assert.strictEqual(planGrid.days.find((d) => d.date === D2)?.base_price, 130, 'а ціну — свою');
  // «На всі тарифи типу» — базовий рядок: B&B успадковує 2, BAR (без свого) — 2, власне 3 у B&B… ні:
  // власне значення пари лишається — це те, заради чого воно на парі.
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D2, min_stay: 2 }]));
  assert.strictEqual((await quote(A, BAR(A), D2)).restrictions.minStay, 2, 'BAR без свого — від типу, 2');
  assert.strictEqual((await quote(A, BB(A), D2)).restrictions.minStay, 3, 'B&B зі своїм — тримає 3, тип його не затирає');
  assert.strictEqual((await runWithOrganization(A, () => getPriceMonth(UT(A), 11, 2026, BAR(A)))).days.find((d) => d.date === D2)?.restrictionsOwn, false, 'сітка BAR: успадковане, не власне');
  // Скинути власне пари — явний null: далі як у типу.
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D2, min_stay: null }], { ratePlanId: BB(A) }));
  assert.strictEqual((await quote(A, BB(A), D2)).restrictions.minStay, 2, 'null на парі — успадкувати від типу (2), а не дефолт 1');
  // Закрито: пара закрита при відкритому типі; тип закритий — усі пари.
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D2, closed: true }], { ratePlanId: BB(A) }));
  assert.deepStrictEqual((await quote(A, BB(A), D2)).closed, [D2], 'закрита пара — ніч закрита для B&B');
  assert.deepStrictEqual((await quote(A, BAR(A), D2)).closed, [], 'а BAR відкритий: тип відкритий');
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D2, closed: true }]));
  assert.deepStrictEqual((await quote(A, BAR(A), D2)).closed, [D2], 'тип закритий — закрита й пара без свого');
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D2, closed: false }]));
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D2, closed: false }], { ratePlanId: BB(A) }));
  assert.deepStrictEqual((await quote(A, BB(A), D2)).closed, [], 'відкрито назад — обидва');
  console.log('  ok  обмеження на тарифі: своє на парі, успадковане від типу, тип не затирає власне, null — успадкувати; закрита пара при відкритому типі');

  // ── 12. Одна семантика `null` на всі поля (Блок 0.6 B4) ────────────────
  //
  // Було три: `weekend_price` — поля немає → не чіпати, `null` → прибрати;
  // `base_price` — COALESCE, тобто `null` НЕ прибирав (а маска вже казала
  // «ціна зникла»); обмеження — завжди перезапис дефолтами, тобто «поля
  // немає» = «скинь». Тепер одна на всі: поля немає — не чіпати; `null` —
  // прибрати (дефолт); значення — записати. Осі: явний `null` ціни прибирає
  // її (рядок NULL, ніч у missing); мінімум 2, якого в запиті немає, лишається
  // 2, а не стає 1; явний `null` максимуму прибирає його, ціна при цьому ціла.
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, base_price: 100, min_stay: 2, max_stay: 5 }]));
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, base_price: null }]));
  const nulled = await sql.row<any>('SELECT base_price, min_stay, max_stay FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id IS NULL', [UT(A), D1]);
  assert.strictEqual(nulled.base_price, null, `явний null ціни мав прибрати її, а лишилось ${nulled.base_price} — маска каже «зникла», база тримає`);
  assert.deepStrictEqual((await quote(A, BAR(A), D1)).missing, [D1], 'ніч без ціни — у missing');
  assert.strictEqual(Number(nulled.min_stay), 2, `мінімум, якого в запиті немає, лишається 2, а не ${nulled.min_stay}`);
  assert.strictEqual(Number(nulled.max_stay), 5, 'максимум, якого в запиті немає, лишається');
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, base_price: 100, max_stay: null }]));
  const cleared2 = await sql.row<any>('SELECT base_price, min_stay, max_stay FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id IS NULL', [UT(A), D1]);
  assert.strictEqual(cleared2.max_stay, null, 'явний null максимуму прибирає його');
  assert.strictEqual(Number(cleared2.base_price), 100, 'ціна записана');
  assert.strictEqual(Number(cleared2.min_stay), 2, 'мінімум не зачеплений');
  // Те саме з вибраним тарифом: ціна тарифу — у його рядок, `null` прибирає її.
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, base_price: 140 }], { ratePlanId: BB(A) }));
  assert.strictEqual((await quote(A, BB(A))).nights[0]?.price, 140);
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, base_price: null }], { ratePlanId: BB(A) }));
  assert.strictEqual((await quote(A, BB(A))).nights[0]?.price, 100, 'null на ціні тарифу прибирає її — тариф знову успадковує базу');
  assert.strictEqual(Number(cleared2.min_stay), 2);
  console.log('  ok  null — прибрати, відсутнє — не чіпати, на всіх полях і в обох рядках');

  // ── 13. Редактор дня не переказує в тип того, чого оператор не міняв ──
  //
  // Рецензія 07.09 раунд 2, правка 1. Модалка засівається ЕФЕКТИВНИМИ
  // значеннями пари (`getPriceMonth`), а прапорець «на всі тарифи типу»
  // увімкнений за замовчуванням. Форма, яка шле всі поля, перетворювала
  // «змінив ціну B&B» на «записав власний мінімум B&B у тип» — і сусідній
  // BAR продавався за чужим числом, а координата лягала на кожну пару
  // («Unexpected rate plan in update»). Тіло тепер будує `changedDayFields`.
  //
  // Осі (інваріант 26): мінімум пари 10 проти мінімуму типу 1 — числа
  // несумісні, «просочилось» від «не просочилось» не відрізнити не можна;
  // два тарифи одного типу; і два тіла — від екрана і давнє повне — на двох
  // датах, тож сцена показує РІЗНИЦЮ, а не саму лише зелень.
  {
    const { changedDayFields, hasRestrictionField } = await import('../ui/day-edit.ts');
    // Тип: мінімум 1. Пара B&B: власний мінімум 10 і своя ціна.
    for (const date of [D3, D4]) {
      await runWithOrganization(A, () => upsertPrices(UT(A), [{ date, base_price: 100, min_stay: 1 }]));
      await runWithOrganization(A, () => upsertPrices(UT(A), [{ date, base_price: 130, min_stay: 10 }], { ratePlanId: BB(A) }));
    }
    // Так день виглядає в сітці тарифу — саме цим засівається модалка.
    const grid = await runWithOrganization(A, () => getPriceMonth(UT(A), 11, 2026, BB(A)));
    const shown = grid.days.find((d) => d.date === D3)!;
    assert.strictEqual(shown.min_stay, 10, 'сітка показує ефективний мінімум пари');
    const opened = {
      base_price: shown.base_price, weekend_price: shown.weekend_price,
      min_stay: shown.min_stay, closed: Boolean(shown.closed), cta: Boolean(shown.cta), ctd: Boolean(shown.ctd),
    };

    // Оператор змінив ЛИШЕ ціну і не чіпав прапорця «на всі тарифи типу».
    const body = changedDayFields(opened, { ...opened, base_price: 155 });
    await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D3, ...body }], {
      ratePlanId: BB(A), restrictionsScope: hasRestrictionField(body) ? 'type' : undefined,
    }));
    assert.strictEqual((await quote(A, BB(A), D3)).nights[0]?.price, 155, 'ціна тарифу записана');
    assert.strictEqual((await quote(A, BAR(A), D3)).restrictions.minStay, 1,
      'сусідній тариф мусить лишитись на мінімумі ТИПУ (1): зміна ціни одного тарифу не переносить чуже обмеження на всі');
    assert.strictEqual((await quote(A, BB(A), D3)).restrictions.minStay, 10, 'а власний мінімум пари лишається її власним');
    const typeRow = await sql.row<any>('SELECT min_stay FROM price_calendar WHERE unit_type_id = ? AND date = ? AND rate_plan_id IS NULL', [UT(A), D3]);
    assert.strictEqual(Number(typeRow.min_stay), 1, `у базовому рядку типу мусить лишитись 1, а лежить ${typeRow.min_stay}`);

    // А ось що робило давнє тіло «вся форма»: те саме значення, названий тип
    // — і мінімум пари стає мінімумом типу. Це те, що гейт ловить.
    await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D4, ...opened, base_price: 155 }], {
      ratePlanId: BB(A), restrictionsScope: 'type',
    }));
    assert.strictEqual((await quote(A, BAR(A), D4)).restrictions.minStay, 10,
      'повна форма переносить власний мінімум пари в тип — сцена мусить бачити цю різницю, інакше вона нічого не стверджує');
  }
  console.log('  ok  редактор дня: незмінене не називається, власне обмеження пари не витікає в тип і на сусідній тариф');

  // ── 14. Мінімум ночей менший за одиницю — не число, а відмова ─────────
  //
  // Рецензія 07.09 раунд 3, правка 1.1. Очищене поле «Мін. ночей» дає
  // `Number('') === 0`, а `min={1}` стереже лише стрілки; ні хендлер, ні
  // писач нуля не відкидали — у тіло до каналу поїхав би
  // `min_stay_arrival: 0`, число, якого готель не називав. Це той самий
  // клас, що нуль у ціні (05.09, бета): «не продавати» — це «Закрито».
  //
  // Осі (інваріант 26): 0 відмовляє, 1 записується — і числа несумісні,
  // «відмовляє завжди» вбило б другу половину сцени.
  await runWithOrganization(A, () => assert.rejects(
    () => upsertPrices(UT(A), [{ date: D1, min_stay: 0 }]),
    /min_stay_invalid/, 'нуль ночей — відмова з назвою, а не запис',
  ));
  await runWithOrganization(A, () => assert.rejects(
    () => bulkUpdatePrices({ unitTypeId: UT(A), dateFrom: D1, dateTo: D2, min_stay: 0 }),
    /min_stay_invalid/, 'масовий редактор — так само',
  ));
  await runWithOrganization(A, () => assert.rejects(
    () => upsertPrices(UT(A), [{ date: D1, min_stay: -3 }], { ratePlanId: BB(A) }),
    /min_stay_invalid/, 'відʼємне на парі — теж відмова',
  ));
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, min_stay: 1 }]));
  assert.strictEqual((await quote(A, BAR(A), D1)).restrictions.minStay, 1, 'одиниця — законне значення й записується');
  // `null` — це «як у типу», не «нуль»: скидання власного обмеження пари
  // мусить проходити повз варту.
  await runWithOrganization(A, () => upsertPrices(UT(A), [{ date: D1, min_stay: null }], { ratePlanId: BB(A) }));
  assert.strictEqual((await quote(A, BB(A), D1)).restrictions.minStay, 1, 'null на парі — успадкувати, а не відмова');
  // Друга половина (правка 5.3 раунду 5): відмову писача видно НА ЕКРАНІ як
  // 400 з назвою. Без цього звʼязок «кинув → показали» тримався на читанні:
  // перейменування помилки лишило б гейт вище зеленим, а оператор побачив би
  // «Не вдалося зберегти» замість причини.
  {
    const fs = await import('node:fs');
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of ['../api/pricing.handlers.ts', '../api/bulk.handlers.ts']) {
      const src = strip(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
      assert.ok(/min_stay_invalid/.test(src), `${f}: відмова писача мусить мати відображення в хендлері`);
      assert.ok(/min_stay_invalid[\s\S]{0,160}status:\s*400/.test(src), `${f}: і саме 400, а не 500`);
    }
    const page = strip(fs.readFileSync(new URL('../../../app/app/(dashboard)/pricing/page.tsx', import.meta.url), 'utf8'));
    assert.strictEqual((page.match(/min_stay_invalid/g) || []).length, 2,
      'обидва екрани (день і масовий) перекладають цю відмову, інакше оператор бачить «Не вдалося зберегти»');
  }
  console.log('  ok  мінімум ночей: нуль і відʼємне — відмова з назвою, одиниця пишеться, null скидає; хендлери й екрани її називають');

  console.log('price-calendar: ціна тарифу на дату — своя, успадкована названа, чуже — відмова; ціни немає — NULL, нуль — відмова');
} finally {
  await cleanup();
}
