/**
 * Приймання каталогу: другий готель з іншим набором тарифів не вимагає коду.
 *
 *   node src/modules/channels/domain/catalog.check.ts
 *
 * Це критерій приймання фази 3 дослівно (ТЗ §10.10): не «Йорг підключився», а
 * «канал підключається з налаштуваннями, і другий готель з іншими
 * налаштуваннями не вимагає жодної зміни коду». Тому нижче ДВА готелі різної
 * форми, як `check-isolation.mjs` вимагає двох організацій: на одному все
 * зламане виглядає цілим.
 *
 * ── Чого цей контракт НЕ стверджує ──────────────────────────────────────
 *
 * Нічого про ціну на рядку мапінгу — ні що вона там є, ні що її там немає.
 * Перенесення `pricing_modifier_percent` на точку збуту (Ц7) відкладене до
 * фази 4, і контракт, який зафіксував би сьогоднішню асиметрію, довелося б
 * переписувати разом із нею — гірше, він видавав би її за рішення.
 *
 * Одне твердження про ціну тут усе ж є, і воно іншого роду: **прохід
 * каталогу не публікує ціни взагалі**. Це не про те, ДЕ живе число, а про те,
 * що каталог і ARI — різні фази. У Channex ціна, задана при створенні
 * тарифу, засіває календар на всі майбутні дати (INVENTORY §3.1): заповнити
 * поле «щоб було» означає продати ніч за числом, якого ніхто не називав
 * (інваріант 17). Це твердження лишиться істинним і після переїзду колонки.
 *
 * ── Що ловить кожне твердження ──────────────────────────────────────────
 *
 * Найдорожче — третє. Наш тариф із цінами на двох типах номерів мусить дати
 * ДВА тарифи на тому боці (Ц6: у них тариф належить типу номера), і обидва
 * мусять лишитись у дзеркалі. Дзеркало, ключоване самим лише id тарифу,
 * затерло б перший рядок другим — і половина фонду назавжди лишилась би без
 * обміну, без жодної помилки.
 */
import assert from 'node:assert';
import {
  syncCatalog,
  type CatalogDeps,
  type CatalogProperty,
  type CatalogRatePlan,
  type CatalogTarget,
  type CatalogUnitType,
  type CatalogMirror,
  type RemoteOption,
} from './catalog.ts';

// ── Стенд: той бік і дзеркало, обидва в памʼяті ───────────────────────────

interface Made { path: string; body: unknown }

function stand() {
  const made: Made[] = [];
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${++seq}`;

  const target: CatalogTarget = {
    async createProperty(property: CatalogProperty) {
      const remoteId = id('prop');
      made.push({ path: 'properties', body: property });
      return remoteId;
    },
    async createUnitType(remotePropertyId: string, unitType: CatalogUnitType) {
      const remoteId = id('rt');
      made.push({ path: 'room_types', body: { remotePropertyId, unitType } });
      return remoteId;
    },
    async createRatePlan(
      remotePropertyId: string,
      remoteUnitTypeId: string,
      plan: CatalogRatePlan,
      occupancies: number[],
    ) {
      const remoteId = id('rp');
      made.push({ path: 'rate_plans', body: { remotePropertyId, remoteUnitTypeId, plan, occupancies } });
      // Основна опція має ТОЙ САМИЙ id, що й тариф (INVENTORY §3.1) — і саме
      // на цьому спотикається код, який заводить їй окремий рядок.
      const options: RemoteOption[] = occupancies.map((occupancy, i) => ({
        occupancy,
        id: i === 0 ? remoteId : id('opt'),
      }));
      return { id: remoteId, options };
    },
  };

  const rows = new Map<string, string>();
  const key = (t: string, l: string, u: string, o: number) => `${t}|${l}|${u}|${o}`;
  const mirror: CatalogMirror = {
    async remoteIdOf(entityType, localId, unitTypeId = '', occupancy = 0) {
      return rows.get(key(entityType, localId, unitTypeId, occupancy)) ?? null;
    },
    async put(row) {
      rows.set(key(row.entityType, row.localId, row.unitTypeId ?? '', row.occupancy ?? 0), row.remoteId);
    },
  };

  return { target, mirror, made, rows };
}

const HOTEL_A: Pick<CatalogDeps, 'property' | 'unitTypes' | 'ratePlans'> = {
  property: { id: 'p_a', title: 'A', currency: 'EUR', country: 'CZ' },
  unitTypes: [
    { id: 'ut_std', code: 'STD', title: 'Standard', roomCount: 4, maxAdults: 2, maxChildren: 1, defaultOccupancy: 2 },
    { id: 'ut_fam', code: 'FAM', title: 'Family', roomCount: 2, maxAdults: 4, maxChildren: 2, defaultOccupancy: 2 },
  ],
  ratePlans: [
    {
      id: 'rp_bar', code: 'BAR', title: 'Best Available', currency: 'EUR', mealPlan: 'breakfast', sellMode: 'per_person',
      // Той самий тариф на ДВОХ типах — саме тут ламається дзеркало на одному ключі.
      on: [
        { unitTypeId: 'ut_std', occupancies: [1, 2] },
        { unitTypeId: 'ut_fam', occupancies: [2, 3, 4] },
      ],
      sellable: true,
    },
    {
      id: 'rp_nr', code: 'NR', title: 'Non-refundable', currency: 'EUR', mealPlan: null, sellMode: 'per_room',
      on: [{ unitTypeId: 'ut_std', occupancies: [2] }],
      sellable: true,
    },
  ],
};

// Другий готель — ІНША форма: один тип, три тарифи, один із них без цін.
const HOTEL_B: Pick<CatalogDeps, 'property' | 'unitTypes' | 'ratePlans'> = {
  property: { id: 'p_b', title: 'B', currency: 'CZK' },
  unitTypes: [
    { id: 'b_ut', code: 'DBL', title: 'Double', roomCount: 9, maxAdults: 2, maxChildren: 0, defaultOccupancy: 2 },
    // Тип-заготовка: заведений, номерів під ним немає.
    { id: 'b_draft', code: 'SUITE', title: 'Suite', roomCount: 0, maxAdults: 2, maxChildren: 0, defaultOccupancy: 2 },
  ],
  ratePlans: [
    { id: 'b_bar', code: 'BAR', title: 'BAR', currency: 'CZK', mealPlan: null, sellMode: 'per_room', on: [{ unitTypeId: 'b_ut', occupancies: [2] }], sellable: true },
    { id: 'b_eb', code: 'EB', title: 'Early Bird', currency: 'CZK', mealPlan: null, sellMode: 'per_person', on: [{ unitTypeId: 'b_ut', occupancies: [1, 2] }], sellable: true },
    // Заведений, цін не поставили. Інваріант 17: НАЗВАТИ, не продати.
    { id: 'b_empty', code: 'EMPTY', title: 'Без цін', currency: 'CZK', mealPlan: null, sellMode: 'per_person', on: [], sellable: false },
  ],
};

// ── 1. Обʼєкт, типи й тарифи заводяться, і пара дає два тарифи ────────────
const a = stand();
const first = await syncCatalog({ ...HOTEL_A, target: a.target, mirror: a.mirror });

assert.strictEqual(first.created.unitTypes, 2, 'обидва типи номерів мали поїхати');
assert.strictEqual(
  first.created.ratePlans, 3,
  'наш тариф на двох типах — це ДВА тарифи на тому боці плюс один на одному типі (Ц6)',
);
assert.strictEqual(first.created.options, 2 + 3 + 1, 'опція на кожну заселеність кожної пари');
assert.strictEqual(first.skipped.length, 0, 'у готелі A нічого пропускати');
console.log('  ok  каталог заводиться, пара «тип × тариф» дає окремий тариф на кожен тип');

// ── 2. Дзеркало тримає ОБИДВІ пари одного тарифу ─────────────────────────
const barStd = await a.mirror.remoteIdOf('rate_plan', 'rp_bar', 'ut_std');
const barFam = await a.mirror.remoteIdOf('rate_plan', 'rp_bar', 'ut_fam');
assert.ok(barStd, 'пара BAR × Standard зникла з дзеркала');
assert.ok(barFam, 'пара BAR × Family зникла з дзеркала');
assert.notStrictEqual(
  barStd, barFam,
  'дві пари одного тарифу отримали один чужий id — дзеркало ключується парою, не тарифом',
);
console.log('  ok  дзеркало ключується парою: другий тип не затирає перший');

// ── 3. Основна опція має id самого тарифу ────────────────────────────────
const primary = await a.mirror.remoteIdOf('rate_plan_option', 'rp_bar', 'ut_std', 1);
assert.strictEqual(
  primary, barStd,
  'основна опція заселеності має ТОЙ САМИЙ id, що й тариф (INVENTORY §3.1)',
);
const secondary = await a.mirror.remoteIdOf('rate_plan_option', 'rp_bar', 'ut_std', 2);
assert.ok(secondary && secondary !== barStd, 'неосновна опція має власний id, і без нього ціну не прочитати назад');
console.log('  ok  опції заселеності змаплені, основна не плутається з рештою');

// ── 4. Другий прохід не створює нічого ───────────────────────────────────
const madeAfterFirst = a.made.length;
const second = await syncCatalog({ ...HOTEL_A, target: a.target, mirror: a.mirror });
assert.strictEqual(a.made.length, madeAfterFirst, 'повторний прохід звернувся до того боку — це дублікати каталогу');
assert.deepStrictEqual(
  second.created, { unitTypes: 0, ratePlans: 0, options: 0 },
  'повторний прохід щось створив: каталог, який уже є, не чіпається',
);
assert.strictEqual(second.existing.ratePlans, 3, 'повторний прохід не впізнав того, що сам щойно завів');
console.log('  ok  прохід ідемпотентний: удруге не створюється нічого');

// ── 5. Прохід каталогу не везе ціни ──────────────────────────────────────
//
// Не «ціна не та» і не «ціна не звідти», а «ціни немає взагалі». Створення
// тарифу з ненульовою ціною засіває календар на тому боці на всі майбутні
// дати (INVENTORY §3.1) — тобто каталог опублікував би число, якого ніхто не
// називав. Ціни їдуть фазою 4, своїм лімітом і своєю чергою.
//
// Перевіряються КЛЮЧІ надісланого, а не текст. Перша версія шукала підрядки
// в JSON — і пропустила `basePriceMinor`, бо шукала `price` з урахуванням
// регістру. Знайшлося не читанням, а зламом: поле додали в тариф навмисно, і
// перевірка лишилась зеленою. Текстом шукати тут узагалі не можна: шлях
// `rate_plans` і назва тарифу «Best Available» дали б хибне спрацювання на
// будь-якому розумному слові.
function keysOf(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) { for (const v of value) keysOf(v, into); return into; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { into.add(k); keysOf(v, into); }
  }
  return into;
}
const MONEY = /price|amount|cost|money|^rate$|^rates$/i;
const moneyKeys = [...keysOf(a.made)].filter((k) => MONEY.test(k));
assert.deepStrictEqual(
  moneyKeys, [],
  `прохід каталогу надіслав ${moneyKeys.join(', ')} — каталог не публікує ціни (фаза 4, інваріант 17)`,
);
console.log('  ok  каталог заводиться без жодного числа ціни');

// ── 6. Другий готель іншої форми — той самий код ─────────────────────────
const b = stand();
const reportB = await syncCatalog({ ...HOTEL_B, target: b.target, mirror: b.mirror });

assert.strictEqual(reportB.created.unitTypes, 1, 'тип без жодного номера поїхав у канал');
assert.strictEqual(reportB.created.ratePlans, 2, 'поїхало не два продаваних тарифи');
assert.deepStrictEqual(
  reportB.skipped.map((s) => `${s.what}:${s.localId}:${s.reason}`).sort(),
  ['rate_plan:b_empty:no_price', 'unit_type:b_draft:no_rooms'],
  'пропущене мусить бути НАЗВАНЕ: оператор має бачити причину, а не гадати',
);
console.log('  ok  другий готель іншої форми пройшов тим самим кодом');

// ── 7. Тариф без цін не їде, але й не зникає ─────────────────────────────
assert.strictEqual(
  await b.mirror.remoteIdOf('rate_plan', 'b_empty', 'b_ut'), null,
  'тариф без жодної ціни опинився в каналі — ніч, якої не покриває жодне джерело, не продається (інваріант 17)',
);
console.log('  ok  тариф без цін названий у звіті й не проданий');

console.log('catalog: каталог заводиться парами, ідемпотентно, без цін і без коду під конкретний готель');
