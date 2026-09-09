/**
 * Дзеркало каналів (OTA) — воно дзеркало, а не скарбничка.
 *
 *   node src/modules/channels/data/channels.repo.check.ts
 *
 * К2: рівень OTA. `cm_mappings` каже «наша пара тип × тариф = ось цей тариф
 * на тому боці», але ЯКИЙ OTA той тариф побачить, вирішують мапінг-айтеми
 * всередині менеджера каналів. Досі це закривалося інструкцією готельєру
 * (Ц8); тепер відповідь читається й показується.
 *
 * ── Що саме тут доводиться ──────────────────────────────────────────────
 *
 * 1. **Дзеркало ідемпотентне.** Два проходи з тією самою відповіддю дають ті
 *    самі рядки, а не подвоєні: інакше екран показував би кожен канал
 *    стільки разів, скільки разів натиснули «Оновити».
 *
 * 2. **Канал, якого в новій відповіді немає, ЗНИКАЄ.** Це різниця між
 *    дзеркалом і накопичувачем, і вона коштує дорого в один бік: готельєр
 *    відключив Booking.com у вікні вендора, а наш екран далі показує його
 *    підключеним — і хтось вирішить, що номери продаються там, де вони вже
 *    не продаються. §4.3 ТЗ саме через це й прибрав цю таблицю колись:
 *    «наша копія протухне мовчки». Тепер вона є, і зобовʼязання тримати її
 *    свіжою виконується тим, що прохід ПЕРЕЗАПИСУЄ дзеркало цілком.
 *
 * 3. **Чуже зʼєднання не існує.** `connection_id` приходить із URL, а на
 *    SQLite політик немає — клас INC-010. Читання чужого дзеркала показало б
 *    інший готель: які в нього канали, з якими тарифами.
 *
 * 4. **Читання без орендаря відмовляє**, а не віддає все.
 */
import assert from 'node:assert';
import '../../../../scripts/lib/module-aliases.mjs';

const { runWithOrganization } = await import('@core/auth/tenant-context');
const { getSql } = await import('@core/db/async');
const { putChannels, channelsOf, channelsSyncedAt } = await import('./channels.repo.ts');

const sql = getSql();
const ORG = '__cmch__org';
const OTHER = '__cmch__other';
const PROP = '__cmch__prop';
const CONN = '__cmch__conn';
/** Друге зʼєднання того самого орендаря: його перша й єдина відповідь порожня. */
const CONN_EMPTY = '__cmch__conn_empty';
const OTHER_PROP = '__cmch__other_prop';
const OTHER_CONN = '__cmch__other_conn';

async function cleanup() {
  for (const org of [ORG, OTHER]) {
    await runWithOrganization(org, async () => {
      await sql.run('DELETE FROM cm_channels WHERE organization_id = ?', [org]).catch(() => {});
      await sql.run('DELETE FROM cm_connections WHERE organization_id = ?', [org]);
      await sql.run("DELETE FROM properties WHERE id LIKE '__cmch__%'", []);
    });
    await sql.run('DELETE FROM organizations WHERE id = ?', [org]);
  }
}

await cleanup();
for (const org of [ORG, OTHER]) {
  await sql.run('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)', [org, 'CH', org]);
}

try {
  await runWithOrganization(ORG, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
      [PROP, ORG, 'CH', PROP]);
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, 'probe', 'tok_ch', 'sec_ch', TRUE)`,
      [CONN, ORG, PROP]);
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, environment, webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, 'probe', 'production', 'tok_ch_e', 'sec_ch_e', TRUE)`,
      [CONN_EMPTY, ORG, PROP]);
  });
  await runWithOrganization(OTHER, async () => {
    await sql.run('INSERT INTO properties (id, organization_id, name, slug) VALUES (?, ?, ?, ?)',
      [OTHER_PROP, OTHER, 'CH2', OTHER_PROP]);
    await sql.run(
      `INSERT INTO cm_connections (id, organization_id, property_id, provider, webhook_token, webhook_secret, is_enabled)
       VALUES (?, ?, ?, 'probe', 'tok_ch2', 'sec_ch2', TRUE)`,
      [OTHER_CONN, OTHER, OTHER_PROP]);
  });

  const booking = {
    remoteChannelId: 'ch-booking',
    otaCode: 'BookingCom',
    title: 'Booking.com',
    isActive: true,
    settings: { hotel_id: '12345' },
    mappedRemoteRatePlanIds: ['rp-bar-dbl', 'rp-bb-dbl'],
  };
  const airbnb = {
    remoteChannelId: 'ch-airbnb',
    otaCode: 'Airbnb',
    title: 'Airbnb',
    isActive: false,
    settings: {},
    mappedRemoteRatePlanIds: ['rp-bar-sgl'],
  };

  await runWithOrganization(ORG, async () => {
    // ── 1. Записали — прочитали ──────────────────────────────────────────
    //
    // Фікстура не вироджена по осях, про які сцена стверджує (інваріант 26):
    // ДВА канали, один увімкнений і один вимкнений, з РІЗНОЮ кількістю
    // змаплених тарифів (2 і 1). З одним каналом «дзеркало пише все» і
    // «дзеркало пише перший» невідрізнювані; з однаковим `is_active`
    // невідрізнювані «стан читається» і «стан завжди true».
    await putChannels(CONN, [booking, airbnb]);
    const first = await channelsOf(CONN);
    assert.strictEqual(first.length, 2, `каналів мало бути два, а є ${first.length}`);
    assert.deepStrictEqual(first.map((c) => c.remoteChannelId).sort(), ['ch-airbnb', 'ch-booking']);
    const b = first.find((c) => c.remoteChannelId === 'ch-booking');
    assert.strictEqual(b?.otaCode, 'BookingCom', 'код OTA не збережено');
    assert.strictEqual(b?.title, 'Booking.com');
    assert.strictEqual(b?.isActive, true, 'стан каналу не збережено');
    assert.deepStrictEqual(b?.mappedRemoteRatePlanIds, ['rp-bar-dbl', 'rp-bb-dbl'],
      'змаплені тарифи каналу не збереглись — екран не покаже, що саме там продається');
    assert.strictEqual(b?.settings?.hotel_id, '12345', 'налаштування каналу не збережено');
    const a = first.find((c) => c.remoteChannelId === 'ch-airbnb');
    assert.strictEqual(a?.isActive, false,
      'вимкнений канал прочитався увімкненим — готельєр вирішить, що там продається');
    console.log('  ok  канали пишуться й читаються з кодом, станом і змапленими тарифами');

    // ── 2. Ідемпотентність ───────────────────────────────────────────────
    await putChannels(CONN, [booking, airbnb]);
    const again = await channelsOf(CONN);
    assert.strictEqual(again.length, 2,
      `другий прохід подвоїв дзеркало: ${again.length} рядків замість 2`);
    console.log('  ok  повторний прохід не подвоює дзеркало');

    // ── 3. Канал, якого більше немає у відповіді, ЗНИКАЄ ─────────────────
    //
    // Це і є різниця між дзеркалом і накопичувачем. Готельєр відключив
    // канал у вікні вендора; якщо наш рядок лишиться, екран казатиме, що
    // номери продаються там, де вони вже не продаються.
    await putChannels(CONN, [{ ...booking, isActive: false, mappedRemoteRatePlanIds: [] }]);
    const shrunk = await channelsOf(CONN);
    assert.strictEqual(shrunk.length, 1,
      `канал, якого немає у відповіді, лишився в дзеркалі: ${shrunk.map((c) => c.remoteChannelId).join(', ')}`);
    assert.strictEqual(shrunk[0].remoteChannelId, 'ch-booking');
    assert.strictEqual(shrunk[0].isActive, false, 'зміна стану не доїхала до дзеркала');
    assert.deepStrictEqual(shrunk[0].mappedRemoteRatePlanIds, [],
      'знятий мапінг лишився в дзеркалі — екран покаже тариф проданим у канал, з якого його зняли');
    console.log('  ok  дзеркало перезаписується цілком: зниклий канал зникає');

    // ── 4. Мітка свіжості ────────────────────────────────────────────────
    const at = await channelsSyncedAt(CONN);
    assert.ok(at, 'дзеркало без мітки часу — лімітер «не частіше разу на годину» не має на що спертись');
    console.log('  ok  дзеркало несе мітку, коли його оновлювали');

    // ── 5. Порожня відповідь — теж відповідь ─────────────────────────────
    //
    // «Каналів нуль» і «ще не питали» — різні стани: перший означає, що
    // готельєр жодного не підключив, другий — що ми не знаємо. Мітка
    // лишається, рядків немає.
    //
    // На ОКРЕМОМУ зʼєднанні, чия перша й єдина відповідь порожня. На
    // головному ця сцена була б виродженою (інваріант 26): там мітку вже
    // поставили проходи вище, і реалізація, яка ставить її ЛИШЕ за наявності
    // рядків, лишалась би зеленою. Так і сталося на першій редакції.
    await putChannels(CONN_EMPTY, []);
    assert.strictEqual((await channelsOf(CONN_EMPTY)).length, 0);
    assert.ok(await channelsSyncedAt(CONN_EMPTY),
      'порожня відповідь не лишила мітки — «нуль каналів» стало невідрізнюваним від «не питали», '
      + 'і лімітер питав би вендора на кожне відкриття екрана');
    console.log('  ok  порожня відповідь лишає мітку: «нуль» ≠ «не питали»');

    // Дзеркало НЕ порожнє перед сценою про чужого орендаря: читання без
    // орендаря на порожній таблиці віддає нуль рядків і без жодної варти.
    await putChannels(CONN, [booking, airbnb]);
  });

  // ── 6. Чуже зʼєднання ──────────────────────────────────────────────────
  await runWithOrganization(OTHER, async () => {
    await assert.rejects(
      () => putChannels(CONN, [booking]),
      /connection not found/,
      'чужий орендар записав дзеркало в НАШЕ зʼєднання');
    const seen = await channelsOf(CONN);
    assert.strictEqual(seen.length, 0,
      `чужий орендар прочитав НАШІ канали (${seen.map((c) => c.title).join(', ')}) — `
      + 'які в сусіда OTA і з якими тарифами');
    console.log('  ok  чуже зʼєднання не існує ні для запису, ні для читання');
  });

  // ── 7. Без орендаря ────────────────────────────────────────────────────
  await assert.rejects(() => channelsOf(CONN), /without a tenant/,
    'читання дзеркала без орендаря не відмовило');
  console.log('  ok  читання без орендаря відмовляє, а не віддає все');
} finally {
  await cleanup();
}

console.log('channels.repo: дзеркало каналів — дзеркало, а не скарбничка');
