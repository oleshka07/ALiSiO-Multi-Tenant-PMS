/**
 * Зміна обʼєкта видима як «каталог розійшовся» — і зникає після синку.
 *
 *   node src/modules/channels/data/catalog-stale.check.ts
 *
 * ── Що стережеться ──────────────────────────────────────────────────────
 *
 * Р15.1. Шлях оновлення обʼєкта у вендора існує (`propertyDrift` →
 * `updateProperty`, П1), але живе ВСЕРЕДИНІ `syncConnectionCatalog`, і ніщо
 * не запускає його після того, як готель змінив рід житла. Оператор міняє
 * поле, яке вендор бере за ОСНОВУ РАХУНКУ, бачить успішне збереження — і у
 * вендора лишається старий рід доти, доки хтось не зробить синк з іншої
 * причини. Мовчазна розбіжність, яка коштує грошей готелю (інваріант 29).
 *
 * Тому стверджується ВЛАСТИВІСТЬ, а не наявність поля (§3.2.1):
 *
 *   1. свіжозаведене зʼєднання без синку — НЕ розійдене (обʼєкта у вендора
 *      ще немає, розходитись нема з чим);
 *   2. після синку — не розійдене;
 *   3. після зміни роду житла — РОЗІЙДЕНЕ;
 *   4. після наступного синку — знову не розійдене.
 *
 * Крок 1 не формальність: без нього твердження задовольнялося б кодом, який
 * завжди каже «розійшлося», і попередження висіло б у кожного готелю
 * назавжди — тобто перестало б щось означати.
 *
 * ── Фікстура не вироджена по осі (інваріант 26) ─────────────────────────
 *
 * Два орендарі, і зміна в одного НЕ робить розійденим другого: інакше
 * твердження було б зеленим і на коді, який ігнорує `property_id` та
 * `organization_id` і відповідає «розійшлося» на будь-що.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { propertyCatalogStale, rememberCatalogSync } = await import('./connections.repo.ts');

const sql = getSql();
const A = '__stale__a';
const B = '__stale__b';

async function cleanup() {
  for (const org of [A, B]) {
    await runWithOrganization(org, async () => {
      await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
      await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

async function seed(org: string) {
  await sql.run('INSERT INTO organizations (id, name, slug, timezone) VALUES (?, ?, ?, ?)',
    [org, org, org, 'Europe/Kyiv']);
  await runWithOrganization(org, async () => {
    await sql.run(
      'INSERT INTO properties (id, organization_id, name, slug, property_type) VALUES (?, ?, ?, ?, ?)',
      [`${org}_prop`, org, org, `${org}_prop`, 'hotel']);
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider,
                                   webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, 'probe', ?, ?, TRUE)`,
      [`${org}_conn`, org, `${org}_prop`, `tok_${org}`, `sec_${org}`]);
  });
}

/**
 * Мітки — секундами, і час рухається ВПЕРЕД між кроками.
 *
 * Обидві сторони порівняння (`properties.updated_at` і
 * `cm_connections.catalog_synced_at`) — рядки ISO з секундною точністю. Два
 * записи в межах однієї секунди дали б рівні мітки, а `>` на рівних —
 * false: твердження «після зміни розійшлося» стало б зеленим від
 * швидкодії, а не від коду. Тому кроки розводяться явними мітками, а не
 * `Date.now()` у той самий момент.
 */
const T = (s: number) => new Date(Date.UTC(2026, 8, 9, 12, 0, s)).toISOString().replace(/\.\d{3}Z$/, 'Z');

await cleanup();
await seed(A);
await seed(B);

try {
  // ── 1. Зʼєднання без жодного синку — не розійдене ─────────────────────
  await runWithOrganization(A, async () => {
    assert.strictEqual(
      await propertyCatalogStale(`${A}_prop`), false,
      'зʼєднання без жодного синку вважається розійденим — попередження висітиме в кожного готелю назавжди',
    );
  });
  console.log('  ok  до першого синку каталог не «розійшовся»: розходитись нема з чим');

  // ── 2. Каталог поїхав ─────────────────────────────────────────────────
  await runWithOrganization(A, async () => {
    await sql.run('UPDATE properties SET updated_at = ? WHERE id = ?', [T(10), `${A}_prop`]);
    await rememberCatalogSync(`${A}_conn`, T(20));
    assert.strictEqual(
      await propertyCatalogStale(`${A}_prop`), false,
      'одразу після синку каталог показано розійденим',
    );
  });
  console.log('  ok  після синку — не розійшовся');

  // ── 3. Готель змінив рід житла ────────────────────────────────────────
  //
  // Саме те поле, за яким вендор виставляє рахунок.
  await runWithOrganization(A, async () => {
    await sql.run('UPDATE properties SET property_type = ?, updated_at = ? WHERE id = ?',
      ['camping', T(30), `${A}_prop`]);
    assert.strictEqual(
      await propertyCatalogStale(`${A}_prop`), true,
      'рід житла змінено, а каталог не показано розійденим — оператор не дізнається, що у вендора старий рід',
    );
  });
  console.log('  ok  після зміни роду житла — РОЗІЙШОВСЯ');

  // ── 4. Сусід не зачеплений ────────────────────────────────────────────
  //
  // Друга половина осі: без неї твердження зелене й на коді, який відповідає
  // «розійшлося» на будь-який обʼєкт будь-якого орендаря.
  await runWithOrganization(B, async () => {
    await sql.run('UPDATE properties SET updated_at = ? WHERE id = ?', [T(10), `${B}_prop`]);
    await rememberCatalogSync(`${B}_conn`, T(20));
    assert.strictEqual(
      await propertyCatalogStale(`${B}_prop`), false,
      'зміна в одного орендаря зробила розійденим каталог другого',
    );
  });
  console.log('  ok  сусідній орендар не зачеплений зміною в першого');

  // ── 5. Наступний синк гасить ознаку ───────────────────────────────────
  await runWithOrganization(A, async () => {
    await rememberCatalogSync(`${A}_conn`, T(40));
    assert.strictEqual(
      await propertyCatalogStale(`${A}_prop`), false,
      'ознака не зникла після синку — вона перестала означати стан і стала прикрасою',
    );
  });
  console.log('  ok  наступний синк гасить ознаку');

  // ── 6. Читання без орендаря відмовляє ─────────────────────────────────
  await assert.rejects(
    () => propertyCatalogStale(`${A}_prop`),
    /without a tenant/,
    'стан каталогу читається без орендаря — на Postgres це віддало б порожнечу як «не розійшлося»',
  );
  console.log('  ok  без орендаря — названа відмова, не тихе «не розійшлося»');
} finally {
  await cleanup();
}

console.log('catalog-stale: зміна обʼєкта видима як розходження каталогу, і зникає після синку');
