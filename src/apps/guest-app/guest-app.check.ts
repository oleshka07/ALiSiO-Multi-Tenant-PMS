/**
 * Гостьовий застосунок: ключ у адресі називає ОДИН будинок, і саме свій.
 *
 *   node src/apps/guest-app/guest-app.check.ts
 *
 * ── Що тут стверджується і чому саме це ─────────────────────────────────
 *
 * Сторінка публічна: сесії немає за визначенням, і єдине, що відрізняє один
 * готель від другого, — ключ у адресі. Тобто весь орендар цього застосунку
 * тримається на одному запиті, і якщо він помиляється, гість бачить чужий
 * готель, чужі номери й чужі ціни — мовчки, з кодом 200.
 *
 * Осі не вироджені (інваріант 26): ДВА рахунки, у кожного свій обʼєкт і свій
 * ключ. Один рахунок доводив би нуль — читач, який просто віддає «єдиний
 * обʼєкт у базі», був би зелений.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../../scripts/lib/module-aliases.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alisio-guest-app-'));
process.env.ALISIO_DATA_DIR = tmp;

await import('@core/db/index.ts');
const { getSql } = await import('@core/db/async.ts');
const { runWithOrganization } = await import('@core/auth/tenant-context.ts');
const { propertyByAppKey } = await import('./data/property.repo.ts');
const { generateGuestAppKey, readGuestAppKey } = await import('./domain/key.ts');
const { languageFromHeader } = await import('./ui/translations.ts');

const sql = getSql();

const A = '__guest_app__org_a';
const B = '__guest_app__org_b';
const PA = '__guest_app__prop_a';
const PB = '__guest_app__prop_b';

const keyA = generateGuestAppKey();
const keyB = generateGuestAppKey();

for (const [org, prop, name, key] of [
  [A, PA, 'Haus Alpha', keyA], [B, PB, 'Haus Beta', keyB],
] as const) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, org, org]);
  await runWithOrganization(org, () => sql.run(
    `INSERT INTO properties (id, organization_id, name, slug, country, guest_app_key)
     VALUES (?, ?, ?, ?, 'DE', ?)`,
    [prop, org, name, prop, key]));
}

try {
  // ── 1. Ключ відчиняє СВІЙ будинок, і обидва боки ─────────────────────────
  //
  // Двома боками навмисно: «ключ А дав обʼєкт А» істинне й на читачі, який
  // завжди віддає перший рядок таблиці. Пара «і ключ Б дав обʼєкт Б» це
  // прочитання виключає.
  const homeA = await propertyByAppKey(keyA);
  const homeB = await propertyByAppKey(keyB);
  assert.strictEqual(homeA?.propertyId, PA, `ключ А відчинив ${homeA?.propertyId}`);
  assert.strictEqual(homeB?.propertyId, PB, `ключ Б відчинив ${homeB?.propertyId}`);
  assert.strictEqual(homeA?.organizationId, A, 'орендар А не той');
  assert.strictEqual(homeB?.organizationId, B, 'орендар Б не той');
  // Імена РІЗНІ й перевіряються: саме назву готелю гість бачить першим рядком,
  // і підміна тут — це чужий бренд на екрані.
  assert.strictEqual(homeA?.propertyName, 'Haus Alpha', 'на екрані чужа назва');
  assert.strictEqual(homeB?.propertyName, 'Haus Beta', 'на екрані чужа назва');
  console.log('  ok  1. кожен ключ відчиняє свій будинок і свій рахунок');

  // ── 2. Вигаданий ключ не відчиняє нічого ─────────────────────────────────
  //
  // Не «порожній обʼєкт», не «перший-ліпший»: немає рядка — немає відповіді,
  // і сторінка робить 404 (інваріанти 5 і 13).
  assert.strictEqual(await propertyByAppKey(generateGuestAppKey()), undefined,
    'ключ, якого немає в базі, щось відчинив');
  console.log('  ok  2. ключ, якого немає, не відчиняє нічого');

  // ── 3. Те, що не є ключем, не стає умовою запиту ─────────────────────────
  //
  // Форму перевіряє домен ДО бази: сегмент адреси приходить від будь-кого з
  // інтернету. Порожньо, коротко, задовго, чужі літери, спроба підставити
  // шаблон — усе це `null`, тобто 404 без жодного запиту.
  // `0`, `1`, `l`, `o`, `i`, `u` в алфавіт не входять навмисно — їх плутають
  // на око й на слух, коли ключ диктують або набирають з паперу.
  for (const bad of ['', ' ', 'abc', keyA.slice(0, 15), `${keyA}x`, '%', `${keyA.slice(0, 15)}%`,
    '0000000000000000', '1111111111111111', 'llllllllllllllll', 'oooooooooooooooo',
    'iiiiiiiiiiiiiiii', 'uuuuuuuuuuuuuuuu']) {
    assert.strictEqual(readGuestAppKey(bad), null, `«${bad}» прийнято за ключ`);
  }
  // І зустрічна вісь: справжній ключ приймається — інакше твердження вище
  // було б зелене й на функції, яка відмовляє завжди.
  assert.strictEqual(readGuestAppKey(keyA), keyA, 'справжній ключ не прийнято');
  assert.strictEqual(readGuestAppKey(keyA.toUpperCase()), keyA,
    'ключ із паперу, набраний великими літерами, не прийнято');
  console.log('  ok  3. не-ключ відсіюється до бази; справжній — приймається');

  // ── 4. Два ключі не бувають однакові ─────────────────────────────────────
  //
  // Тримає це УНІКАЛЬНИЙ індекс (0414), але сам генератор теж має не давати
  // збігів: індекс тут — друга лінія, а не перша.
  const many = new Set(Array.from({ length: 500 }, () => generateGuestAppKey()));
  assert.strictEqual(many.size, 500, `генератор дав ${500 - many.size} збігів на 500`);
  console.log('  ok  4. 500 ключів — 500 різних');

  // ── 5. Мова приходить із ТЕЛЕФОНА, і з ваги, а не з порядку ──────────────
  //
  // Заголовок — список із вагами в довільному порядку. Читач «перший підрядок»
  // на `cs,en;q=0.9` віддав би чеську, якої в нас немає, і сторінка мовчки
  // впала б у дефолт; на `de;q=0.2,en;q=0.9` він віддав би німецьку людині,
  // яка просила англійську. Тому осі дві: і вага, і невідома мова.
  assert.strictEqual(languageFromHeader('de-AT,de;q=0.9,en-US;q=0.8'), 'de', 'de-AT це de');
  assert.strictEqual(languageFromHeader('en-GB,en;q=0.9'), 'en', 'англієць дістав не англійську');
  assert.strictEqual(languageFromHeader('de;q=0.2,en;q=0.9'), 'en',
    'вага знехтувана — узято перший рядок, а не найбажаніший');
  assert.strictEqual(languageFromHeader('cs,en;q=0.8'), 'en',
    'чех із англійською другою мусить дістати англійську, а не дефолт');
  assert.strictEqual(languageFromHeader('cs,sk;q=0.8'), 'de',
    'мова, якої ми не знаємо, має впасти в дефолт');
  assert.strictEqual(languageFromHeader(''), 'de', 'порожній заголовок');
  assert.strictEqual(languageFromHeader(undefined), 'de', 'заголовка немає взагалі');
  assert.strictEqual(languageFromHeader('en;q=0'), 'de',
    'вага 0 означає «не треба», а не «треба найбільше»');
  console.log('  ok  5. мова з Accept-Language: за вагою, з регіоном, із запасним дефолтом');

  console.log('guest-app: ключ називає один будинок — свій, і сторінка говорить мовою телефона');
} finally {
  for (const org of [A, B]) {
    await runWithOrganization(org, () => sql.run('DELETE FROM properties WHERE organization_id = ?', [org]));
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
