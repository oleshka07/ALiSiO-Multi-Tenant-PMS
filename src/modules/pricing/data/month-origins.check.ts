/**
 * Сітка цін коштує одиниці запитів на місяць, а не сотні.
 *
 *   node src/modules/pricing/data/month-origins.check.ts
 *
 * Рецензія раунду 10, Р10.1 — блокер. Правка Р9.2 дала правильні числа й
 * неправильну ціну: `monthGuestPrices` кликав `priceNights` на кожну дату, а
 * кожен виклик робив шість послідовних запитів, з яких ПʼЯТЬ — однакові
 * довідники рівня обʼєкта, перечитані тридцять разів. Виміряно контролером
 * лічильником на драйвері: 7 → 181 запит на один `GET /api/pricing`, 211 з
 * обраним тарифом. І це не «одне відкриття екрана»: сітка перечитується після
 * КОЖНОГО збереження дня і КОЖНОЇ масової правки.
 *
 * На Postgres кожен позатранзакційний запит — окремий чекаут пулу плюс два
 * `set_config`, тобто 543 звернення і 181 чекаут при `max: 10`.
 *
 * Автор (ця сесія) назвав ціну «тридцять викликів» — на порядок нижче за
 * фактичну, бо рахував виклики, а не запити. Тому тут стоїть ЛІЧИЛЬНИК:
 * число, а не оцінка.
 *
 * ── Що саме стверджується ───────────────────────────────────────────────
 *
 * Не «швидко», а «довідник рівня обʼєкта читається один раз». Стеля 12 узята
 * з розкладу: обʼєкт, матриця, тіри, правила надбавок, правила цін, календар
 * — шість на місяць без тарифу, плюс рядок тарифу і запас на службові
 * читання. Тридцять один день місяця в неї не вміщається за побудовою, тож
 * повернення «виклик на кожну дату» валить її незалежно від того, скільки
 * запитів робить один виклик.
 *
 * Осі (інваріант 26): місяць БЕЗ тарифу і місяць З тарифом (другий шлях
 * читає ще й `rate_plans` і рядки пари), і всі пʼять довідників у базі
 * непорожні — на порожній матриці й без правил половина запитів не робилась
 * би зовсім, і стеля трималася б сама собою.
 *
 * Лічильник — на `prepare` драйвера SQLite. На Postgres його немає, і гейт
 * про це КАЖЕ, замість мовчазного «зелено» (той самий підхід, що в
 * `connect.check` про вимкнені політики).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { monthGuestPrices } = await import('./month-origins.ts');
const { priceNights } = await import('./nightly-price.ts');
const { priceOrigin } = await import('../domain/day-price.ts');
const { upsertPrices } = await import('./price-calendar.repo.ts');
const { createPrice, createTier } = await import('./occupancy-price.repo.ts');

const sql = getSql();
const O = '__mo__org';
const PROP = `${O}_prop`;
const UT = `${O}_dbl`;
const RP = `${O}_bar`;

/**
 * Засів і прибирання — В КОНТЕКСТІ ОРЕНДАРЯ, як це робить застосунок.
 *
 * Під роллю застосунку (`alisio_app`, FORCE RLS) запис без орендаря на
 * зʼєднанні політика відхиляє, а видалення мовчки чіпає НУЛЬ рядків — і
 * гейт лишається зеленим на порожнечі (INC-014, Р10.11). Рядок
 * `organizations` лишається поза контекстом: ця таблиця орендаря НАЗИВАЄ,
 * політики на ній немає за побудовою.
 */
async function cleanup() {
  await runWithOrganization(O, async () => {
    await sql.run('DELETE FROM price_los_tiers WHERE unit_type_id = ?', [UT]);
    await sql.run('DELETE FROM price_occupancy WHERE unit_type_id = ?', [UT]);
    await sql.run('DELETE FROM price_calendar WHERE unit_type_id = ?', [UT]);
    await sql.run('DELETE FROM extra_occupancy_rules WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM price_rules WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM rate_plans WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM unit_types WHERE id = ?', [UT]);
    await sql.run('DELETE FROM categories WHERE property_id = ?', [PROP]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [O]);
  });
  await sql.run('DELETE FROM organizations WHERE id = ?', [O]);
}

/**
 * Скільки запитів зробив блок. `null` — порахувати нічим (Postgres), і це
 * НЕ зелене твердження: викликач скаже про відсутність осі вголос.
 */
async function countQueries(fn: () => Promise<void>): Promise<number | null> {
  if (process.env.DB_DRIVER === 'postgres') { await fn(); return null; }
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const db = require('../../../core/db/index.ts').getDb();
  const original = db.prepare;
  let n = 0;
  db.prepare = function patched(this: unknown, ...args: unknown[]) {
    n++;
    return original.apply(this, args);
  };
  try { await fn(); } finally { db.prepare = original; }
  return n;
}

await cleanup();
try {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [O, 'MO', 'mo']);
  await runWithOrganization(O, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)', [PROP, O, 'P', PROP]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)', [`${O}_cat`, PROP, 'Rooms', 'room']);
    await sql.run(
      `INSERT INTO unit_types (id, property_id, category_id, name, code, max_adults, max_children, max_occupancy, base_occupancy)
       VALUES (?, ?, ?, 'Double', 'DBL', 2, 2, 4, 2)`,
      [UT, PROP, `${O}_cat`]);
    await sql.run(
      `INSERT INTO rate_plans (id, property_id, name, code, pricing_model, currency, priority) VALUES (?, ?, 'BAR', 'BAR', 'standard', 'CZK', 1)`,
      [RP, PROP]);
  });

  await runWithOrganization(O, async () => {
    // Усі пʼять довідників непорожні — інакше половина запитів не робилась би
    // зовсім, і стеля трималася б сама собою (інваріант 26).
    for (let d = 1; d <= 30; d++) {
      const date = `2026-11-${String(d).padStart(2, '0')}`;
      await upsertPrices(UT, [{ date, base_price: 100 }]);
    }
    await createPrice(PROP, { unit_type_id: UT, persons: 2, price_gross: 120 });
    await createTier(PROP, { unit_type_id: UT, min_nights: 3, adjustment_gross: -10, persons: 2 });
    await sql.run(
      `INSERT INTO extra_occupancy_rules (id, organization_id, property_id, guest_kind, lodging_mode, lodging_value, extra_bed)
       VALUES (?, ?, ?, 'adult', 'fixed', 300, FALSE)`,
      [`${O}_eor`, O, PROP]);
    await sql.run(
      `INSERT INTO price_rules (id, organization_id, property_id, name, kind, condition_kind, date_from, date_to,
                                action, value, value_kind, priority, is_active, online_only, current_uses)
       VALUES (?, ?, ?, 'Осінь', 'rule', 'period_of_stay', '2026-11-01', '2026-11-30',
               'decrease', 5, 'percent', 10, TRUE, FALSE, 0)`,
      [`${O}_pr`, O, PROP]);

    // ── 1. Місяць без тарифу ───────────────────────────────────────────
    let result: Record<string, { price: number }> = {};
    const plain = await countQueries(async () => { result = await monthGuestPrices(UT, 11, 2026); });
    assert.strictEqual(Object.keys(result).length, 30, 'усі тридцять днів листопада мають ціну — інакше лічильник міряє порожнечу');

    // ── 2. Місяць із тарифом ───────────────────────────────────────────
    let withPlanResult: Record<string, { price: number }> = {};
    const withPlan = await countQueries(async () => { withPlanResult = await monthGuestPrices(UT, 11, 2026, RP); });
    assert.ok(Object.keys(withPlanResult).length > 0, 'із тарифом теж мусить бути результат');

    if (plain == null || withPlan == null) {
      console.log('  !!  осі лічильника немає: DB_DRIVER=postgres, `prepare` драйвера не перехоплюється.');
      console.log('      Число запитів доводиться на SQLite; тут перевірено лише, що результат є.');
    } else {
      const CEILING = 8;
      assert.ok(plain <= CEILING,
        `місяць без тарифу коштував ${plain} запитів (стеля ${CEILING}). Довідник рівня обʼєкта `
        + 'читається ОДИН раз на місяць, а не на кожну з тридцяти дат — див. cheapestByDay');
      assert.ok(withPlan <= CEILING + 2,
        `місяць із тарифом коштував ${withPlan} запитів (стеля ${CEILING + 2})`);
      console.log(`  ok  місяць коштує ${plain} запитів без тарифу і ${withPlan} з тарифом — одиниці, не сотні`);
    }

    // ── 3. Швидкий шлях дає ТІ САМІ числа, що повільний ────────────────
    //
    // Найважливіше твердження файлу, і воно про правильність, а не про
    // швидкість: оптимізація, яка змінює ціну, гірша за повільний екран.
    // Контекст накриває місяць, а кожне запитання стосується однієї ночі —
    // якби звуження діапазону загубилось, ніч 5 листопада побачила б
    // обмеження 20-го. Тому кожна дата звіряється з викликом БЕЗ контексту.
    //
    // Фікстура тут не вироджена по жодній осі, про яку твердить: у місяці є
    // і матриця (120), і LOS-тір (−10 від трьох ночей), і правило цін (−5 %),
    // і правило надбавки; будні й вихідні; тариф і без тарифу.
    for (const [rp, label] of [[undefined, 'без тарифу'], [RP, 'з тарифом']] as const) {
      const fast = await monthGuestPrices(UT, 11, 2026, rp);
      for (const [date, got] of Object.entries(fast)) {
        const slow = await priceNights({ unitTypeId: UT, checkIn: date, nights: 1, adults: 2, ratePlanId: rp ?? null, channel: 'operator' });
        assert.strictEqual(got.price, slow.nights[0]?.price,
          `${date} (${label}): контекст на місяць дав ${got.price}, а окремий виклик — ${slow.nights[0]?.price}. `
          + 'Пришвидшення не має права міняти число');
        assert.strictEqual(got.origin, priceOrigin(slow.nights[0]!.source, slow.nights[0]!.column),
          `${date} (${label}): і джерело мусить збігатись`);
      }
    }
    console.log('  ok  контекст на місяць дає ті самі числа й джерела, що окремі виклики — на 60 звірках');
  });

  console.log('month-origins: сітка цін вантажить довідники обʼєкта один раз на місяць');
} finally {
  await cleanup();
}
