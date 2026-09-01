/**
 * Каталог заведено — і зʼєднання ЗНАЄ, що саме заведено.
 *
 *   node src/modules/channels/data/catalog-sync.check.ts
 *
 * ── Навіщо ця перевірка існує ───────────────────────────────────────────
 *
 * Знайдено прогоном проти живого staging 01.09.2026, не читанням. Каталог
 * створювався бездоганно: обʼєкт, типи, тарифи, опції — усе на тому боці,
 * усе в дзеркалі. А `cm_connections.remote_property_id` лишався NULL.
 *
 * Ціна цього — не косметика. `pullConnection()` починається з
 *
 *     if (!conn.remotePropertyId) throw new Error('connection has no remote property');
 *
 * і це правильна відмова: стрічка без `filter[property_id]` віддала б
 * ревізії ЧУЖИХ орендарів (И11). Тобто після успішного заведення каталогу
 * броні з каналів не приїжджають НІКОЛИ, і причина виглядає як несправність
 * стрічки, а не як незаписана колонка.
 *
 * Кожна фаза окремо правильна. Порожній був шов між ними: фаза 3 пише
 * дзеркало, фаза 5 читає колонку, і ніхто не переносить одне в друге.
 *
 * ── Чому не «читати з дзеркала» ─────────────────────────────────────────
 *
 * Так теж можна, і тоді колонку слід було б прибрати. Але вона вже читається
 * у двох місцях (`connections.repo`, `pull-adapter`), описана в §4.1 і
 * потрапляє в кожен виклик стрічки — тобто дешевше заповнити її один раз
 * при заведенні, ніж на кожному опитуванні ходити в дзеркало по рядок, який
 * ніколи не змінюється. Два будинки для одного факту лишаються, і це
 * свідомо: дзеркало — загальна відповідність, колонка — гаряча координата
 * зʼєднання.
 *
 * ── Перевірка була ЧЕРВОНОЮ ─────────────────────────────────────────────
 *
 * Інваріант 24: спершу твердження, потім побачити його червоним, і лише тоді
 * зміна. Тут крок «побачити червоним» і був способом знайти діру — вона
 * існувала до перевірки, а не зʼявилася для неї.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { syncConnectionCatalog } = await import('./catalog-sync.ts');
const { remoteIdOf } = await import('./mappings.repo.ts');

const sql = getSql();
const A = '__catsync__a';
const B = '__catsync__b';

async function cleanup() {
  for (const org of [A, B]) {
    await sql.run('DELETE FROM cm_mappings WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM rate_plans WHERE property_id = ?', [`${org}_prop`]);
    await sql.run('DELETE FROM units WHERE property_id = ?', [`${org}_prop`]);
    await sql.run('DELETE FROM unit_types WHERE property_id = ?', [`${org}_prop`]);
    await sql.run('DELETE FROM categories WHERE property_id = ?', [`${org}_prop`]);
    await sql.run('DELETE FROM properties WHERE organization_id = ?', [org]);
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

/**
 * Готель, у якого є що заводити: тип номера з номером.
 *
 * ── Чому тут НЕМАЄ тарифів і цін ────────────────────────────────────────
 *
 * Обʼєкт на тому боці створюється незалежно від тарифів — саме тому діра,
 * заради якої написана ця перевірка, і була невидимою. Тобто твердженню
 * вони не потрібні.
 *
 * А засіяти їх тут і не можна: ціна під тариф — це рядок `price_calendar` з
 * `rate_plan_id`, тобто запит до цінових таблиць поза `modules/pricing`
 * (інваріант 16), і `check-price-source --strict` це ловить. Правильно:
 * писача цін під тариф у фасаді `@pricing` сьогодні немає взагалі
 * (`upsertPrices` і `bulkUpdatePrices` пишуть базову ціну типу, з
 * `rate_plan_id IS NULL`), і заводити його заради перевірки — не її справа.
 * Каталог із тарифами покриває `domain/catalog.check.ts` на памʼятних
 * заглушках і живий прогін `scripts/channex-catalog-live.mjs`.
 *
 * Двох орендарів треба, і не для симетрії: один не доводить нічого — з ним
 * зламана межа виглядає цілою (той самий довід, що в `check-isolation.mjs`).
 */
async function seed(org: string) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
      [`${org}_prop`, org, org, `${org}_prop`]);
    await sql.run('INSERT INTO categories (id, property_id, name, type) VALUES (?, ?, ?, ?)',
      [`${org}_cat`, `${org}_prop`, 'Rooms', 'rooms']);
    await sql.run(
      `INSERT INTO unit_types (id, property_id, category_id, name, code,
                               max_adults, max_children, max_occupancy, base_occupancy, is_active)
       VALUES (?, ?, ?, ?, ?, 2, 0, 2, 2, TRUE)`,
      [`${org}_ut`, `${org}_prop`, `${org}_cat`, 'Double', 'DBL'],
    );
    await sql.run(
      `INSERT INTO units (id, property_id, unit_type_id, category_id, name, code, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [`${org}_u1`, `${org}_prop`, `${org}_ut`, `${org}_cat`, '101', '101'],
    );
    // Тариф БЕЗ ціни, і це навмисне поєднання двох потреб:
    //   * обʼєкту нема звідки взяти валюту без жодного тарифу — syncCatalog
    //     на це свідомо відмовляє, і перевірка мусить пройти повз відмову;
    //   * ціни під тариф тут ставити не можна (інваріант 16, див. шапку seed),
    //     тож тариф лишається непродаваним і йде у skipped(no_price).
    // Заразом це покриває сам шлях `no_price`: тариф, який оператор завів і
    // не оцінив, називається у звіті, а не зникає мовчки (інваріант 17).
    await sql.run(
      `INSERT INTO rate_plans (id, property_id, name, code, currency, is_active, is_hidden, priority)
       VALUES (?, ?, ?, ?, 'EUR', TRUE, FALSE, 0)`,
      [`${org}_rp`, `${org}_prop`, 'Best Available', 'BAR'],
    );
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider,
                                   webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, 'probe', ?, ?, TRUE)`,
      [`${org}_conn`, org, `${org}_prop`, `tok_${org}`, `sec_${org}`],
    );
  });
}

/**
 * Той бік — у памʼяті. Перевірка не ходить у мережу: живий API міряється
 * скриптом (`scripts/channex-catalog-live.mjs`), а гейт мусить бути
 * детермінованим, інакше збірка червоніє від чужого простою.
 */
function fakeTarget(prefix: string) {
  let n = 0;
  return {
    createProperty: async () => `${prefix}-property`,
    createUnitType: async () => `${prefix}-ut-${++n}`,
    createRatePlan: async (
      _p: string, _ut: string, _plan: unknown, occupancies: number[],
    ) => ({
      id: `${prefix}-rp-${++n}`,
      options: occupancies.map((occupancy, i) => ({
        occupancy, id: i === 0 ? `${prefix}-rp-${n}` : `${prefix}-opt-${++n}`,
      })),
    }),
  };
}

await cleanup();
await seed(A);
await seed(B);

await runWithOrganization(A, async () => {
  const report = await syncConnectionCatalog(`${A}_conn`, { target: fakeTarget('a') as never });
  assert.equal(report.remotePropertyId, 'a-property', 'обʼєкт мав завестися');
  assert.deepEqual(
    report.skipped.map((x) => `${x.what}:${x.reason}`), ['rate_plan:no_price'],
    'тариф без ціни називається у звіті, а не зникає мовчки (інваріант 17)',
  );

  // ── Головне твердження: зʼєднання знає свій обʼєкт на тому боці ───────
  const rows = await sql.rows<{ remote_property_id: string | null }>(
    'SELECT remote_property_id FROM cm_connections WHERE id = ?', [`${A}_conn`],
  );
  assert.equal(
    rows[0]?.remote_property_id, 'a-property',
    'cm_connections.remote_property_id порожній після заведення каталогу — '
    + 'pullConnection() відмовить назавжди, і виглядатиме це як зламана стрічка',
  );

  // І те саме значення в дзеркалі: два будинки одного факту не розходяться.
  assert.equal(
    await remoteIdOf(`${A}_conn`, 'property', `${A}_prop`, 0, ''),
    'a-property',
    'дзеркало і колонка мусять називати той самий обʼєкт',
  );
});
console.log('  ok  заведення каталогу записує обʼєкт на зʼєднання');

// ── Межа орендаря: чуже зʼєднання не зачепило ────────────────────────────
{
  const rows = await sql.rows<{ remote_property_id: string | null }>(
    'SELECT remote_property_id FROM cm_connections WHERE id = ?', [`${B}_conn`],
  );
  assert.equal(rows[0]?.remote_property_id, null,
    'заведення каталогу одного орендаря не має чіпати зʼєднання другого');
}
console.log('  ok  зʼєднання другого орендаря не зачеплене');

// ── Повторний прохід нічого не створює і не псує вже записане ────────────
await runWithOrganization(A, async () => {
  const again = await syncConnectionCatalog(`${A}_conn`, { target: fakeTarget('z') as never });
  assert.equal(again.created.unitTypes, 0, 'другий прохід не створює типів');
  assert.equal(again.existing.unitTypes, 1, 'другий прохід бачить тип як уже заведений');
  const rows = await sql.rows<{ remote_property_id: string | null }>(
    'SELECT remote_property_id FROM cm_connections WHERE id = ?', [`${A}_conn`],
  );
  assert.equal(rows[0]?.remote_property_id, 'a-property',
    'повторний прохід не має переписувати обʼєкт на новий');
});
console.log('  ok  повторний прохід ідемпотентний і не переписує обʼєкт');

await cleanup();
console.log('каталог: зʼєднання знає свій обʼєкт на тому боці');
