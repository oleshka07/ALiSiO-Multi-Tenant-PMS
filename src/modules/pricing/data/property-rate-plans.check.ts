/**
 * Шов між модулем каналів і тарифами: `propertyRatePlans()`.
 *
 *   node src/modules/pricing/data/property-rate-plans.check.ts
 *
 * Модуль каналів не читає тарифні таблиці навпростець — він питає цю
 * функцію. Сенс шва: коли тарифи переїдуть (рішення §3.5 ТЗ свідомо не
 * ухвалене, бо невідомо, скільки їх реально продає готель), змінюється вона
 * одна, а мапінг, батчер і адаптер цього не помічають.
 *
 * ── Чому `rate_plans`, а не `site_rate_plans` ───────────────────────────
 *
 * ТЗ §3.5 каже «перша реалізація збирає тарифи з `site_rate_plans` головного
 * сайту». Написано 30.08, ДО міграції 0048 — а вона поставила цінову вісь на
 * `rate_plans`: саме туди вказують `price_calendar.rate_plan_id` і
 * `reservations.rate_plan_id`, а `site_rate_plans` не звʼязана з ними
 * жодною колонкою (її `derived_from_plan_id` вказує сама на себе).
 *
 * Тобто буквальне слідування §3.5 віддало б каналу тарифи, чиїх id немає в
 * `price_calendar`: кожен пошук ціни промахується, `cm_mappings.local_id`
 * тримає ідентифікатори, які нічого не коштують, і CP1 ламається рівно на
 * шві. Документ виправлено разом із цим кодом.
 *
 * ── Три речі, які тут легко зробити неправильно ─────────────────────────
 *
 * 1. **Тариф без ціни не продається.** Інваріант 17. Тариф, у якого немає
 *    жодного типу номера з ціною, — це не «тариф на нуль», це тариф, якого
 *    не існує; віддати його каналу означає продати ніч за ціною, якої готель
 *    не називав.
 *
 * 2. **Вісь заселеності належить ТИПУ номера, а не тарифу.** У нас
 *    `price_occupancy` ключується `unit_type_id`; у менеджера каналів
 *    `options[]` висять на тарифі. Тобто наша пара «тип × тариф» стає ОДНИМ
 *    їхнім тарифом — і саме тому шов віддає типи, а не приховує їх.
 *
 * 3. **Заселеність вище місткості типу відхиляється при створенні.**
 *    Виміряно у Property Size Limits: `occupancy` тарифу > місткості типу —
 *    помилка. А помилка на одному тарифі валить увесь синк каталогу, тобто
 *    один зайвий рядок `price_occupancy` лишає готель без інтеграції.
 *
 * Перевірка написана ДО реалізації і **була червоною** (інваріант 24).
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { propertyRatePlans } = await import('./property-rate-plans.ts');

const sql = getSql();
const A = '__rp_check__a';
const B = '__rp_check__b';

async function cleanup() {
  for (const org of [A, B]) {
    await sql.run("DELETE FROM price_calendar WHERE unit_type_id LIKE ?", [`${org}%`]);
    await sql.run("DELETE FROM price_occupancy WHERE unit_type_id LIKE ?", [`${org}%`]);
    await sql.run("DELETE FROM rate_plans WHERE property_id LIKE ?", [`${org}%`]);
    await sql.run("DELETE FROM unit_types WHERE property_id LIKE ?", [`${org}%`]);
    await sql.run("DELETE FROM categories WHERE property_id LIKE ?", [`${org}%`]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

/** Готель із двома типами номерів і тарифами. Двох треба: один не доводить нічого. */
async function seed(org: string) {
  const prop = `${org}_prop`;
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
      [prop, org, org, prop]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)',
      [`${org}_cat`, prop, 'Rooms', 'room']);
    // Двомісний і тримісний: стеля заселеності в них різна, і це важливо.
    await sql.run(
      `INSERT INTO unit_types (id, property_id, category_id, name, code, max_adults, max_occupancy, base_occupancy)
       VALUES (?, ?, ?, ?, ?, 2, 2, 2)`,
      [`${org}_dbl`, prop, `${org}_cat`, 'Double', 'DBL'],
    );
    await sql.run(
      `INSERT INTO unit_types (id, property_id, category_id, name, code, max_adults, max_occupancy, base_occupancy)
       VALUES (?, ?, ?, ?, ?, 3, 3, 2)`,
      [`${org}_tri`, prop, `${org}_cat`, 'Triple', 'TRI'],
    );
    // Три тарифи: звичайний, вимкнений і той, під який ніхто не поставив ціни.
    for (const [id, code, name, active] of [
      [`${org}_bar`, 'BAR', 'Best Available', 1],
      [`${org}_off`, 'OFF', 'Вимкнений', 0],
      [`${org}_nop`, 'NOP', 'Без цін', 1],
    ] as const) {
      await sql.run(
        `INSERT INTO rate_plans (id, property_id, name, code, currency, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, prop, name, code, 'EUR', active],
      );
    }
    // Ціни: BAR має ціни на обидва типи; OFF — теж (щоб довести, що відсіює
    // саме вимкненість, а не відсутність цін); NOP — жодної.
    for (const plan of [`${org}_bar`, `${org}_off`]) {
      for (const ut of [`${org}_dbl`, `${org}_tri`]) {
        await sql.run(
          `INSERT INTO price_calendar (id, unit_type_id, rate_plan_id, date, base_price)
           VALUES (?, ?, ?, ?, ?)`,
          [`${plan}_${ut}`.slice(0, 60), ut, plan, '2026-10-10', 100],
        );
      }
    }
    // Заселеність: у двомісного дві опції, у тримісного три — і ще одна
    // ЗАЙВА на чотирьох, якої тип не вміщає.
    const occ = [
      [`${org}_dbl`, 1], [`${org}_dbl`, 2],
      [`${org}_tri`, 1], [`${org}_tri`, 2], [`${org}_tri`, 3],
      [`${org}_tri`, 4],
    ] as const;
    for (const [ut, persons] of occ) {
      await sql.run(
        `INSERT INTO price_occupancy (id, organization_id, property_id, unit_type_id, persons, price_gross)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [`${ut}_${persons}`, org, prop, ut, persons, 50 + persons * 10],
      );
    }
  });
}

await cleanup();
await seed(A);
await seed(B);

try {
  await runWithOrganization(A, async () => {
    const plans = await propertyRatePlans(`${A}_prop`);

    // ── Ідентичність: id ті самі, якими ключується ціна ──────────────────
    const bar = plans.find((p) => p.code === 'BAR');
    assert.ok(bar, 'звичайний тариф не повернувся');
    assert.strictEqual(bar.id, `${A}_bar`,
      'id тарифу не збігається з тим, яким ключується price_calendar — жодна ціна не знайдеться');
    console.log('  ok  тариф приходить під тим id, яким ключується ціна');

    // ── Вимкнений тариф каналу не віддається ─────────────────────────────
    //
    // Ціни в нього є, тобто відсіює саме вимкненість. Продати через канал
    // те, що готель вимкнув, — це бронь, якої він не чекає.
    assert.ok(!plans.some((p) => p.code === 'OFF'),
      'вимкнений тариф пішов у канал — готель продаватиме те, що сам вимкнув');
    console.log('  ok  вимкнений тариф не потрапляє в канал, хоч ціни в нього є');

    // ── Тариф без жодної ціни — НАЗВАНИЙ, а не мовчки проданий ───────────
    //
    // Інваріант 17. Віддати його каналу означає продати ніч за ціною, якої
    // готель ніколи не називав; мовчки викинути — лишити оператора з
    // тарифом, який він завів і не розуміє, чому той не працює.
    const nop = plans.find((p) => p.code === 'NOP');
    assert.ok(nop, 'тариф без цін зник мовчки — оператор не дізнається, чому він не продається');
    assert.deepStrictEqual(nop.unitTypes, [],
      'тариф без цін отримав типи номерів нізвідки');
    assert.strictEqual(nop.sellable, false, 'тариф без жодної ціни оголошено придатним до продажу');
    assert.strictEqual(bar.sellable, true);
    console.log('  ok  тариф без цін названо непридатним, а не викинуто й не продано');

    // ── Типи номерів беруться звідти, де СПРАВДІ є ціни ──────────────────
    assert.deepStrictEqual(
      bar.unitTypes.map((u) => u.code).sort(),
      ['DBL', 'TRI'],
      'типи номерів тарифу взяті не з цінової таблиці');
    console.log('  ok  типи номерів тарифу — це ті, на які є ціна');

    // ── Заселеність: вісь типу, і не вища за місткість типу ──────────────
    //
    // `price_occupancy` дозволяє завести четверту особу двомісному номеру —
    // база цього не забороняє. Менеджер каналів забороняє: заселеність
    // тарифу понад місткість типу відхиляється ПРИ СТВОРЕННІ, і одна така
    // помилка валить синк усього каталогу.
    const dbl = bar.unitTypes.find((u) => u.code === 'DBL')!;
    const tri = bar.unitTypes.find((u) => u.code === 'TRI')!;
    assert.deepStrictEqual(dbl.occupancies, [1, 2], 'вісь заселеності двомісного номера');
    assert.deepStrictEqual(tri.occupancies, [1, 2, 3],
      'заселеність на 4 особи пройшла в тримісний номер — синк каталогу впаде цілком');
    console.log('  ok  заселеність обрізається місткістю типу, а не приймається як є');

    // ── Валюта — з тарифу, не вгадана ────────────────────────────────────
    assert.strictEqual(bar.currency, 'EUR', 'валюта тарифу підмінена');
  });

  // ── Чужий готель ─────────────────────────────────────────────────────
  //
  // `property_id` приходить із URL або з рядка зʼєднання, тож запит без
  // орендаря на Postgres рятує політика, а на SQLite не рятує ніщо.
  await runWithOrganization(B, async () => {
    const stolen = await propertyRatePlans(`${A}_prop`);
    assert.deepStrictEqual(stolen, [],
      'чужий готель прочитав тарифи сусіда — це його цінник');
  });
  await runWithOrganization(A, async () => {
    const mine = await propertyRatePlans(`${A}_prop`);
    assert.ok(mine.length > 0, 'свої тарифи зникли');
    console.log('  ok  чужі тарифи не читаються, свої на місці');
  });

  // ── Обʼєкт без тарифів — порожньо, не виняток ────────────────────────
  await runWithOrganization(A, async () => {
    assert.deepStrictEqual(await propertyRatePlans('__no_such_property__'), []);
    console.log('  ok  обʼєкт без тарифів дає порожній список, а не падіння');
  });
} finally {
  await cleanup();
}

console.log('rate-plans: шов віддає тарифи, якими ключується ціна, і лише продавані');
