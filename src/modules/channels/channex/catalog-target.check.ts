/**
 * Переклад каталогу в поля Channex — по справжньому HTTP.
 *
 *   node src/modules/channels/channex/catalog-target.check.ts
 *
 * Домен уже перевірений окремо (`../domain/catalog.check.ts`): там порядок
 * дій. Тут — те, чого домен не знає і знати не повинен: як саме поля лягають
 * у тіло запиту і що з відповіді треба забрати.
 *
 * Підмінений `fetch` доводив би, що ми правильно СКЛАЛИ виклик. Половина
 * пасток цього файла — у тому, як ми ЧИТАЄМО відповідь, тож мок піднімає
 * справжній сервер.
 *
 * ── Три пастки, кожна з ціною ───────────────────────────────────────────
 *
 * 1. Тариф створюється ЗАКРИТИМ. Ціна, задана при створенні, засіває
 *    календар на всі майбутні дати (INVENTORY §3.1) — тобто нуль у полі це
 *    нуль на кожну ніч, а між каталогом і фазою 4 стоїть оператор, який
 *    вмикає канал. Закритий тариф — це інваріант 17 у їхніх полях.
 * 2. Основна опція має id САМОГО ТАРИФУ. Код, який заводить їй окремий
 *    рядок, отримує дзеркало, де ціни основної заселеності нема з чим
 *    зіставити.
 * 3. Порядок `options` у відповіді не той, у якому просили. Читати за
 *    позицією означає приписати ціну трьох осіб двом.
 */
import assert from 'node:assert';
// Аліаси й розширення для голого node: клієнт імпортує сусідів без `.ts`.
import '../../../../scripts/lib/module-aliases.mjs';
import type { CatalogRatePlan } from '../domain/catalog.ts';

const { startMockChannex } = await import('./mock-server.ts');
const { ChannexClient } = await import('./client.ts');
const { channexCatalogTarget } = await import('./catalog-target.ts');

const mock = await startMockChannex();
const client = new ChannexClient({
  apiKey: 'test-key',
  baseUrl: `${mock.url}/api/v1`,
  sleep: async () => {},
});
const target = channexCatalogTarget(client, 'conn-1');

try {
  // ── Обʼєкт: обгортка ключем і жодного порожнього поля ─────────────────
  mock.queue.push({ kind: 'created', id: 'prop-1' });
  const propertyId = await target.createProperty({
    id: 'p_local', title: 'Пансіон', currency: 'EUR', country: 'CZ', city: null,
    timezone: 'Europe/Kyiv', propertyType: 'guest_house',
  });
  assert.strictEqual(propertyId, 'prop-1');
  const propCall = mock.calls.at(-1)!;
  assert.ok(propCall.path.endsWith('/properties'), 'обʼєкт пішов не туди');
  const propBody = propCall.body.property as Record<string, unknown>;
  assert.ok(propBody, 'тіло не загорнуте ключем `property` — API відповість порожньою валідацією');
  assert.strictEqual(propBody.title, 'Пансіон');
  assert.ok(!('city' in propBody), 'порожнє місто поїхало полем — це 422 на валідному обʼєкті');
  assert.ok(!('id' in propBody), 'НАШ id поїхав у чужу базу');
  console.log('  ok  обʼєкт заводиться загорнутим, без порожніх полів і без наших id');

  // ── Рід житла і пояс — у ТІЛІ, і не однакові на всіх (Р13.11) ─────────
  //
  // Твердження навмисно про ТІЛО запиту, а не про доменний обʼєкт: рівно на
  // цій осі жив вихідний баг. `timezone` виглядав надісланим — поле в
  // адаптері було, — але доменний обʼєкт його не ніс, і в тіло не потрапляло
  // нічого. Перевірка, яка дивиться на наш обʼєкт, цього не бачить у
  // принципі.
  //
  // Фікстура невироджена: ДВА обʼєкти, різні пояси і різні роди, і між ними
  // `notEqual`. З одним обʼєктом у празькому поясі зашите `'Europe/Prague'`
  // пройшло б як «правильно» (інваріант 26).
  assert.strictEqual(propBody.timezone, 'Europe/Kyiv', 'пояс не доїхав у тілі створення');
  assert.strictEqual(propBody.property_type, 'guest_house', 'рід житла не доїхав у тілі створення');

  mock.queue.push({ kind: 'created', id: 'prop-2' });
  await target.createProperty({
    id: 'p_local_2', title: 'Kemp', currency: 'CZK', country: 'CZ', city: null,
    timezone: 'Europe/Prague', propertyType: 'camping',
  });
  const secondBody = mock.calls.at(-1)!.body.property as Record<string, unknown>;
  assert.strictEqual(secondBody.timezone, 'Europe/Prague');
  assert.strictEqual(secondBody.property_type, 'camping');
  assert.notStrictEqual(
    propBody.timezone, secondBody.timezone,
    'обидва обʼєкти поїхали з одним поясом — фікстура вироджена, зашите значення пройшло б',
  );
  assert.notStrictEqual(
    propBody.property_type, secondBody.property_type,
    'обидва обʼєкти поїхали з одним родом житла — фікстура вироджена',
  );
  console.log('  ok  рід житла і пояс — у ТІЛІ створення, і кожен обʼєкт їде своїм');

  // ── Рід житла, якого вендор не знає, не пропускається мовчки ──────────
  //
  // Умовний спред тут повернув би вихідний баг: поле просто зникло б з тіла,
  // вендор поставив би свій дефолт, а він «affects billing».
  const callsBefore = mock.calls.length;
  let refusedUnknownKind = '';
  try {
    await target.createProperty({
      id: 'p_bad', title: 'X', currency: 'EUR', country: 'CZ', city: null,
      timezone: 'Europe/Kyiv', propertyType: 'igloo',
    });
  } catch (e) {
    refusedUnknownKind = e instanceof Error ? e.message : String(e);
  }
  assert.match(
    refusedUnknownKind, /property_type/,
    'невідомий рід житла мовчки випав із тіла замість відмови',
  );
  assert.strictEqual(
    mock.calls.length, callsBefore,
    'обʼєкт із невідомим родом житла все одно полетів вендору',
  );
  console.log('  ok  рід житла поза мапою вендора — відмова, не мовчазний пропуск');

  // ── Оновлення: те саме тіло, той самий PUT (П1) ───────────────────────
  //
  // Без цього блоку `updateProperty` міг би зібрати ІНШЕ тіло — і рівно так
  // `timezone` колись і загубився: два шляхи, одне з них ніхто не перевіряв.
  mock.queue.push({ kind: 'record', data: { id: 'prop-1', attributes: {
    title: 'Пансіон', currency: 'EUR', country: 'CZ',
    timezone: 'Europe/Prague', property_type: 'hotel',
  } } });
  const drift = await target.propertyDrift('prop-1', {
    id: 'p_local', title: 'Пансіон', currency: 'EUR', country: 'CZ', city: null,
    timezone: 'Europe/Kyiv', propertyType: 'guest_house',
  });
  assert.deepStrictEqual(
    [...(drift ?? [])].sort(), ['property_type', 'timezone'],
    'розбіжність поясу й роду житла не помічена — оновлення не полетить',
  );
  const readCall = mock.calls.at(-1)!;
  assert.strictEqual(readCall.method, 'GET', 'звірка мала читати обʼєкт');
  assert.ok(readCall.path.includes('/properties/prop-1'), 'звірка прочитала не той обʼєкт');
  console.log('  ok  розбіжність із вендором бачиться пополе, читанням його ж обʼєкта');

  await target.updateProperty('prop-1', {
    id: 'p_local', title: 'Пансіон', currency: 'EUR', country: 'CZ', city: null,
    timezone: 'Europe/Kyiv', propertyType: 'guest_house',
  });
  const putCall = mock.calls.at(-1)!;
  assert.strictEqual(putCall.method, 'PUT', 'оновлення пішло не PUT-ом');
  assert.ok(putCall.path.includes('/properties/prop-1'), 'оновлення пішло не на той обʼєкт');
  const putBody = putCall.body.property as Record<string, unknown>;
  assert.ok(putBody, 'тіло оновлення не загорнуте ключем `property`');
  assert.strictEqual(putBody.timezone, 'Europe/Kyiv', 'пояс не доїхав у тілі ОНОВЛЕННЯ');
  assert.strictEqual(putBody.property_type, 'guest_house', 'рід житла не доїхав у тілі ОНОВЛЕННЯ');
  assert.ok(!('id' in putBody), 'НАШ id поїхав у чужу базу');
  console.log('  ok  рід житла і пояс — у ТІЛІ оновлення, тим самим будівником');

  // Однакове з вендорським — не розбіжність, і PUT не летить.
  mock.queue.push({ kind: 'record', data: { id: 'prop-1', attributes: {
    title: 'Пансіон', currency: 'EUR', country: 'CZ',
    timezone: 'Europe/Kyiv', property_type: 'guest_house',
  } } });
  const same = await target.propertyDrift('prop-1', {
    id: 'p_local', title: 'Пансіон', currency: 'EUR', country: 'CZ', city: null,
    timezone: 'Europe/Kyiv', propertyType: 'guest_house',
  });
  assert.deepStrictEqual(same, [], 'звірка знайшла розбіжність там, де все збігається');
  console.log('  ok  збіг із вендором — порожня розбіжність, зайвий PUT не летить');

  // ── Тип номера: місткість не вигадується ──────────────────────────────
  mock.queue.push({ kind: 'created', id: 'rt-1' });
  await target.createUnitType('prop-1', {
    id: 'ut', code: 'STD', title: 'Standard',
    roomCount: 4, maxAdults: 2, maxChildren: 1, defaultOccupancy: 3,
  });
  const rtBody = mock.calls.at(-1)!.body.room_type as Record<string, unknown>;
  assert.strictEqual(rtBody.occ_adults, 2);
  assert.strictEqual(rtBody.occ_children, 1);
  assert.strictEqual(rtBody.occ_infants, 0, 'вигадана місткість для немовлят — це продані місця, яких немає');
  assert.strictEqual(
    rtBody.default_occupancy, 2,
    'default_occupancy більше за occ_adults — 422, і падає створення ВСЬОГО каталогу',
  );
  console.log('  ok  тип номера не отримує місткості, якої в нього немає');

  // ── Тариф: закритий, без ціни, з опціями на кожну заселеність ─────────
  const plan: CatalogRatePlan = {
    id: 'rp', code: 'BAR', title: 'Best Available', currency: 'EUR',
    mealPlan: 'breakfast', on: [], sellable: true, sellMode: 'per_person',
  };
  mock.queue.push({ kind: 'created', id: 'rp-1' });
  const made = await target.createRatePlan('prop-1', 'rt-1', plan, [1, 2, 3]);

  const rpBody = mock.calls.at(-1)!.body.rate_plan as Record<string, unknown>;
  assert.strictEqual(rpBody.room_type_id, 'rt-1', 'тариф не привʼязаний до типу номера — у них це обовʼязково');
  assert.strictEqual(
    rpBody.stop_sell, true,
    'тариф створено ВІДКРИТИМ: між каталогом і фазою 4 його ціною стане нуль (INVENTORY §3.1, інваріант 17)',
  );
  assert.strictEqual(rpBody.meal_type, 'breakfast');
  // Блок 2.2: режим їде ЯВНО. Без поля вендор ставить per_room, а тариф
  // per_room з опцією на кожну заселеність суперечить сам собі (HANDOVER §7):
  // саме так були заведені всі тарифи до 05.09.2026.
  assert.strictEqual(rpBody.sell_mode, 'per_person', 'режим тарифу не поїхав — вендор мовчки поставить per_room');

  const options = rpBody.options as Record<string, unknown>[];
  assert.strictEqual(options.length, 3, 'опція мусить бути на кожну заселеність');
  assert.ok(!options.some((o) => 'rate' in o), 'у опції поїхала ціна — каталог не публікує цін');
  assert.strictEqual(options.filter((o) => o.is_primary).length, 1, 'основна опція мусить бути рівно одна');
  console.log('  ok  тариф їде закритим, без цін, з опцією на кожну заселеність');

  // ── Відповідь читається за `occupancy`, а не за позицією ──────────────
  assert.strictEqual(made.id, 'rp-1');
  const byOccupancy = new Map(made.options.map((o) => [o.occupancy, o.id]));
  assert.strictEqual(
    byOccupancy.get(1), 'rp-1',
    'основна опція має ТОЙ САМИЙ id, що й тариф — інакше її ціну не буде з чим зіставити',
  );
  assert.ok(byOccupancy.get(2) && byOccupancy.get(2) !== 'rp-1', 'неосновна опція має власний id');
  assert.strictEqual(byOccupancy.size, 3, 'зіставлення за позицією замість occupancy — ціна трьох осіб дісталась двом');
  console.log('  ok  опції читаються за заселеністю, а не за порядком у відповіді');

  // ── Заселеність, якої не повернули, — відмова ─────────────────────────
  //
  // Мовчазний пропуск означав би ціну, яку потім нема куди покласти: гість
  // на трьох платить за двох, і видно це вже в рахунку.
  // Відповідь СПРАВЖНЬОЇ форми — конверт створеного тарифу, — але однієї
  // опції в ній немає. Перша версія цього твердження годувала мок конвертом
  // задачі (`ok`), і виклик падав раніше, на розборі id: перевірка була
  // зеленою, а те, що вона нібито доводила, — зламаним. Знайшлося зламом,
  // не читанням.
  mock.queue.push({ kind: 'created', id: 'rp-2', omitOccupancies: [2] });
  await assert.rejects(
    () => target.createRatePlan('prop-1', 'rt-1', plan, [1, 2]),
    /occupancy option/,
    'тариф із половиною опцій прийнято мовчки — ціну другої заселеності нема куди покласти',
  );
  console.log('  ok  тариф без запитаних опцій заселеності — відмова, не пропуск');

  // ── Невідоме харчування не їде взагалі ────────────────────────────────
  mock.queue.push({ kind: 'created', id: 'rp-3' });
  await target.createRatePlan('prop-1', 'rt-1', { ...plan, mealPlan: 'сніданок' }, [2]);
  const oddBody = mock.calls.at(-1)!.body.rate_plan as Record<string, unknown>;
  assert.ok(
    !('meal_type' in oddBody),
    'чуже значення харчування поїхало як є — 422 валить створення всього каталогу',
  );
  console.log('  ok  невпізнане харчування не надсилається замість того, щоб завалити каталог');

  // ── «За номер»: режим per_room і одна опція (Блок 2.2) ───────────────
  mock.queue.push({ kind: 'created', id: 'rp-4' });
  await target.createRatePlan('prop-1', 'rt-1', { ...plan, code: 'ROOM', sellMode: 'per_room' }, [2]);
  const roomBody = mock.calls.at(-1)!.body.rate_plan as Record<string, unknown>;
  assert.strictEqual(roomBody.sell_mode, 'per_room', 'тариф «за номер» мав поїхати як per_room');
  assert.strictEqual((roomBody.options as unknown[]).length, 1, '«за номер» — одна опція, на максимальну місткість');
  console.log('  ok  тариф «за номер» їде як per_room з однією опцією');
} finally {
  await mock.close();
}

console.log('catalog-target: каталог лягає в поля Channex закритим, без цін і без вигаданої місткості');
