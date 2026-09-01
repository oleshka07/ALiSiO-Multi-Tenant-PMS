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
    mealPlan: 'breakfast', on: [], sellable: true,
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
} finally {
  await mock.close();
}

console.log('catalog-target: каталог лягає в поля Channex закритим, без цін і без вигаданої місткості');
