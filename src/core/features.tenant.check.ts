/**
 * Прапорець модуля читається ДО того, як відомий орендар, — і мусить бачити
 * рядок організації, про яку питають.
 *
 *   node src/core/features.tenant.check.ts
 *   DB_DRIVER=postgres DATABASE_URL=… node src/core/features.tenant.check.ts   # ось де це червоне
 *
 * INC-014, 02.09.2026, бета. Крон розсилки каналів питає `hasFeature(org,
 * 'channels')` для кожної організації ПЕРЕД тим, як увійти в її контекст —
 * і на Postgres політика `organization_features_tenant` ховала рядок:
 * `SELECT … WHERE organization_id = ?` без `app.organization_id` віддавав
 * порожньо, дефолт модуля OFF, орендар «пропущений». Черга росла, крон
 * відповідав `success: true, 0 sent`, і жоден гейт цього не бачив: SQLite
 * політик не має, а перевірка крона працює з підставленими залежностями.
 * Той самий клас — вебхук і публічний віджет, які теж питають прапорець без
 * орендаря.
 *
 * Сцена тримає ОБИДВІ осі (інваріант 26): модуль, який за замовчуванням OFF,
 * увімкнено рядком — і модуль, який за замовчуванням ON, вимкнено рядком.
 * Дефолт, що просочився замість рядка, провалює обидві. На SQLite сцена
 * зелена завжди — сенс вона має лише в `check:pg`.
 */
import assert from 'node:assert';
import '../../scripts/lib/module-aliases.mjs';

const { runWithOrganization, currentOrganizationId } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { hasFeature, setFeature, featureDefault } = await import('./features.ts');

const sql = getSql();
const A = '__ft_check__a';
const B = '__ft_check__b';

async function cleanup() {
  for (const org of [A, B]) {
    await runWithOrganization(org, () => sql.run('DELETE FROM organization_features WHERE organization_id = ?', [org]));
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

await cleanup();
for (const org of [A, B]) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
}

try {
  assert.strictEqual(currentOrganizationId(), null, 'сцена питає без орендаря — інакше вона не про те');
  assert.strictEqual(featureDefault('channels'), false, 'вісь 1 потребує модуля, який за замовчуванням OFF');
  assert.strictEqual(featureDefault('booking_engine'), true, 'вісь 2 потребує модуля, який за замовчуванням ON');

  // Без рядка — дефолт, з обох боків. Контроль, а не твердження.
  assert.strictEqual(await hasFeature(A, 'channels'), false);
  assert.strictEqual(await hasFeature(A, 'booking_engine'), true);

  // Рядки пишуться в контексті орендаря — так, як їх пише екран «Модулі».
  await runWithOrganization(A, async () => {
    await setFeature(A, 'channels', true);
    await setFeature(A, 'booking_engine', false);
  });

  // Контроль: у контексті орендаря рядок видно.
  assert.strictEqual(await runWithOrganization(A, () => hasFeature(A, 'channels')), true);
  assert.strictEqual(await runWithOrganization(A, () => hasFeature(A, 'booking_engine')), false);

  // ТВЕРДЖЕННЯ: без орендаря — ті самі відповіді, бо питання називає організацію.
  assert.strictEqual(currentOrganizationId(), null);
  assert.strictEqual(await hasFeature(A, 'channels'), true,
    'модуль увімкнено рядком, а прочитано дефолт OFF — крон пропустить цього орендаря мовчки (INC-014)');
  assert.strictEqual(await hasFeature(A, 'booking_engine'), false,
    'модуль вимкнено рядком, а прочитано дефолт ON — публічний віджет продаватиме те, що готель вимкнув');

  // Чужа організація без рядків — дефолти: рядок А не просочується в Б.
  assert.strictEqual(await hasFeature(B, 'channels'), false);
  assert.strictEqual(await hasFeature(B, 'booking_engine'), true);

  // Вихід із виклику не лишає орендаря на зʼєднанні для наступного читача.
  assert.strictEqual(currentOrganizationId(), null);

  console.log('  ok  прапорець модуля читається без орендаря так само, як з ним — по обох осях');
  console.log('features.tenant: питання про модуль називає організацію, і політика бази йому не заважає');
} finally {
  await cleanup();
}
