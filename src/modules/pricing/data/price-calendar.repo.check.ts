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
  // таблиці). Тут — друга половина: обидва писачі передають `ratePlanId`
  // у двері, інакше ціна тарифу поїхала б на всі пари типу (Ц10).
  {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./price-calendar.repo.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const calls = [...src.matchAll(/noteRatesChanged\(t, \{([^}]*)\}/g)].map((m) => m[1]);
    assert.strictEqual(calls.length, 2, 'два писачі календаря — два виклики дверей');
    for (const args of calls) assert.ok(/ratePlanId:/.test(args), `двері кличуться без тарифу: {${args.trim()}}`);
  }
  console.log('  ok  обидва писачі називають тариф дверям каналів');

  console.log('price-calendar: ціна тарифу на дату — своя, успадкована названа, чуже — відмова');
} finally {
  await cleanup();
}
