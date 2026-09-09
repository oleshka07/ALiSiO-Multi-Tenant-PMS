/**
 * Канали обʼєкта → рядки дзеркала: переклад без вигадування (К2).
 *
 *   node src/modules/channels/channex/channels-adapter.check.ts
 *
 * Фікстура нижче — форма ЖИВОГО зразка `docs/vendor/channex/live/
 * GET__channels__200.json`, знятого 06.09.2026 на власному обʼєкті staging, а
 * не форма документації (інваріант 28: «Мок віддає форму ЗРАЗКА»). Саме тому
 * тут є `pricing_setting`, `mappingSettings`, `expected_removal_date` і
 * `actions` — полів, які документація не називає, а вендор віддає.
 *
 * ── Три речі, які тут легко зробити неправильно ─────────────────────────
 *
 * 1. **Зіставляти за назвою, а не за кодом.** `title` готельєр міняє як хоче;
 *    вендор попереджає прямо: «match by the code, not by the name».
 *
 * 2. **Брати `id` мапінг-айтема замість `rate_plan_id`.** Обидва UUID, обидва
 *    поруч, і переплутати їх нічого не коштує — доки не доходить до звірки з
 *    `cm_mappings`, де `id` мапінгу не знайдеться ніколи. Екран тоді скаже
 *    «жоден тариф не змаплений» на цілком змапленому каналі, і готельєр піде
 *    мапити те, що вже змаплено.
 *
 * 3. **Вважати порожній `rate_plans` помилкою.** «Empty while the connection
 *    is unmapped» — канал підключено, тарифи ще не змаплені. Це і є та діра,
 *    яку Ц8 закривав інструкцією; сховати її означає збрехати.
 */
import assert from 'node:assert';
// Через аліаси й динамічний імпорт, як решта перевірок адаптера: файл тягне
// клієнт і репозиторій, а їх бере лише шов аліасів (`module-aliases`).
import '../../../../scripts/lib/module-aliases.mjs';

const { mapChannels, mapChannelCatalog } = await import('./channels-adapter.ts');

// Форма живого зразка, з полями, яких немає в документації.
const live = [
  {
    id: 'ae730843-3aee-4ac3-9b7f-40510f73f8b8',
    type: 'channel',
    attributes: {
      id: 'ae730843-3aee-4ac3-9b7f-40510f73f8b8',
      title: 'Наш Букінг — не чіпати',
      currency: null,
      settings: {
        email: 'hotel@example.test',
        hotel_id: '12345678',
        send_email_notifications: false,
        mappingSettings: { rooms: { PROBE: 'c451b315-0860-4e5f-bf63-50489d497e20' } },
      },
      actions: ['load_future_reservations'],
      // Код адаптера. НЕ дорівнює `title` — і саме на цьому стоїть сцена 1.
      channel: 'Expedia',
      inserted_at: '2026-09-05T21:21:31.620174',
      updated_at: '2026-09-05T21:21:31.771331',
      properties: ['65dea8cf-5e61-4c9a-ae8e-cae9d24857c5'],
      is_active: false,
      rate_plans: [{
        // `id` мапінг-айтема — НЕ те, що нам треба.
        id: 'd5a1df3d-357c-49c6-babd-082c1bc95f44',
        settings: {
          readonly: false, occupancy: 2, rate_plan_code: 'PROBE', room_type_code: 'PROBE',
          pricing_setting: { min_stay_type: 'Arrival' }, pricing_type: 'per_room', primary_occ: true,
        },
        // …а ось це — те.
        rate_plan_id: '28f08170-e338-4b91-b76b-253ab84b60fc',
      }],
      expected_removal_date: null,
    },
    relationships: {
      group: { data: { id: '70912cf0-5f3b-49a1-b8c7-ccb18169c416', type: 'group' } },
      properties: { data: [{ id: '65dea8cf-5e61-4c9a-ae8e-cae9d24857c5', type: 'property' }] },
    },
  },
  // Другий канал — увімкнений, іншого коду, ще не змаплений. Вісь не
  // вироджена (інваріант 26): з одним каналом «стан читається» і «стан завжди
  // false» невідрізнювані, а порожній `rate_plans` без непорожнього поруч не
  // доводить, що його не сплутали з помилкою.
  {
    id: 'ch-2',
    type: 'channel',
    attributes: {
      id: 'ch-2', title: 'Airbnb', channel: 'AirBNB', is_active: true,
      settings: {}, rate_plans: [], actions: [],
    },
  },
];

// ── 1. Код і назва — різні речі ────────────────────────────────────────────
{
  const { rows, skipped } = mapChannels(live as never);
  assert.strictEqual(skipped.length, 0, `нічого не мало пропуститись: ${skipped.join(', ')}`);
  assert.strictEqual(rows.length, 2, `каналів мало бути два, а є ${rows.length}`);

  const first = rows[0];
  assert.strictEqual(first.otaCode, 'Expedia',
    'код OTA взято не з `channel` — зіставляти за назвою заборонено самим вендором');
  assert.strictEqual(first.title, 'Наш Букінг — не чіпати',
    'назву треба показати як є: готельєр упізнає канал саме по ній');
  assert.notStrictEqual(first.otaCode, first.title,
    'фікстура вироджена: код і назва збігаються, і сплутати їх було б непомітно');
  console.log('  ok  код адаптера і назва читаються окремо, і не плутаються');
}

// ── 2. Стан каналу — їхній, і читається як є ───────────────────────────────
{
  const { rows } = mapChannels(live as never);
  assert.deepStrictEqual(rows.map((r) => r.isActive), [false, true],
    'стан каналів прочитано не з `is_active` — вимкнений канал показався б продаваним');
  console.log('  ok  вимкнений і увімкнений канали розрізняються');
}

// ── 3. Змаплені тарифи — `rate_plan_id`, а не `id` мапінга ─────────────────
{
  const { rows } = mapChannels(live as never);
  assert.deepStrictEqual(rows[0].mappedRemoteRatePlanIds, ['28f08170-e338-4b91-b76b-253ab84b60fc'],
    'узято `id` мапінг-айтема замість `rate_plan_id` — звірка з дзеркалом не знайде його НІКОЛИ, '
    + 'і екран скаже «не змаплено» на змапленому каналі');
  assert.deepStrictEqual(rows[1].mappedRemoteRatePlanIds, [],
    'порожній `rate_plans` — законний стан «канал підключено, тарифи не змаплені» (Ц8), не помилка');
  console.log('  ok  беремо rate_plan_id, а порожній список лишається порожнім');
}

// ── 4. Налаштування доїжджають обʼєктом, а не рядком ───────────────────────
{
  const { rows } = mapChannels(live as never);
  assert.strictEqual(rows[0].settings?.hotel_id, '12345678', 'налаштування підключення загубились');
  assert.deepStrictEqual(rows[1].settings, {}, 'порожні налаштування мали лишитись порожнім обʼєктом');
  console.log('  ok  налаштування підключення доїжджають як є');
}

// ── 5. Крива відповідь не глушить решту ────────────────────────────────────
//
// Канал без ідентифікатора — зіпсоване повідомлення. Виняток тут сховав би
// всі інші канали готелю; той самий довід, що в стрічці ревізій.
{
  const { rows, skipped } = mapChannels([{ attributes: { channel: 'X' } }, live[1]] as never);
  assert.strictEqual(rows.length, 1, 'крива відповідь сховала решту каналів');
  assert.deepStrictEqual(skipped, ['missing_id'], 'причина пропуску не названа');
  console.log('  ok  канал без ідентифікатора пропускається з причиною, решта лишається');
}

// ── 5b. Порожній код і відсутній прапорець — теж пропуск, і причина інша ───
//
// Це не педантизм про типи, а ДВА КАНАЛИ З ОДНОГО на екрані. «Підключені»
// малюються з дзеркала, «Доступні» рахуються ВІДНІМАННЯМ за кодом
// (`channels/page.tsx`), а порожній код не збігається з жодним кодом
// каталогу — тож OTA стоїть підключеною і водночас пропонується підключити.
// Жодної помилки при цьому немає ніде: обидва списки «правильні».
//
// Відсутній `is_active` — сусідня половина того ж класу: `=== true` мовчки
// перетворює «поля немає» на «вимкнено», а вимкнений канал не шле нічого.
// Обидва поля стоять у живому зразку вендора, тож їхня відсутність — це
// зміна на тому боці, яку треба ПОБАЧИТИ (інваріант 28).
{
  const { rows, skipped } = mapChannels([
    { id: 'ch-blank', attributes: { title: 'Без коду', channel: '   ', is_active: true } },
    { id: 'ch-nonstr', attributes: { title: 'Код числом', channel: 42, is_active: true } },
    { id: 'ch-noflag', attributes: { title: 'Без прапорця', channel: 'Agoda' } },
    live[1],
  ] as never);
  assert.strictEqual(rows.length, 1,
    'крива відповідь сховала решту каналів або впустила канал без коду');
  assert.strictEqual(rows[0].otaCode, 'AirBNB', 'лишився не той канал');
  assert.deepStrictEqual(skipped,
    ['missing_channel_code', 'missing_channel_code', 'missing_is_active'],
    'причини пропуску не названі або злиплися в одну — оператор не дізнається, ЩО саме прийшло криве');
  // Вісь: пропущено ТРИ рядки з чотирьох, і серед них два різні роди. Один
  // рід лишив би твердження зеленим і тоді, коли друга варта зникла.
  assert.strictEqual(new Set(skipped).size, 2, 'фікстура вироджена: обидві варти дають одну причину');
  console.log('  ok  порожній код і відсутній прапорець пропускаються, і кожен своєю причиною');
}

// ── 6. Каталог адаптерів — «доступні OTA» ──────────────────────────────────
//
// Форма живого `GET /channels/list` (57 адаптерів на 06.09.2026): код, назва,
// рід (`ota`/`meta`/`cm`) і чи є листування.
{
  const catalog = mapChannelCatalog([
    { code: 'BookingCom', title: 'Booking.com', kind: 'meta', message_support: true },
    { code: 'AirBNB', title: 'Airbnb', kind: 'ota', message_support: true },
    // Без назви — показуємо код: порожній рядок у списку означав би канал,
    // який не можна ні вибрати, ні назвати.
    { code: 'Quirky', kind: 'meta', message_support: false },
    // Без коду — не канал: зіставляти його нема з чим.
    { title: 'Безіменний', kind: 'meta' },
  ]);
  assert.deepStrictEqual(catalog.map((c) => c.code), ['BookingCom', 'AirBNB', 'Quirky'],
    'запис без коду потрапив у каталог — його нема з чим зіставити');
  assert.strictEqual(catalog[2].title, 'Quirky', 'канал без назви мав показатись кодом');
  assert.deepStrictEqual(catalog.map((c) => c.kind), ['meta', 'ota', 'meta']);
  assert.deepStrictEqual(catalog.map((c) => c.messaging), [true, true, false],
    'ознака листування прочитана не з `message_support`');
  console.log('  ok  каталог адаптерів: код обовʼязковий, назва падає на код');
}

console.log('channels-adapter: канали перекладаються без вигадування');
