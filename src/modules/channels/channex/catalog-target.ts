/**
 * Каталог доменною мовою → поля Channex.
 *
 * Тут і тільки тут живуть `room_type`, `rate_plan`, `occ_adults`,
 * `default_occupancy`, `stop_sell` (інваріант И1). Порядок дій — у
 * `../domain/catalog.ts`, і він не знає жодного з цих слів.
 *
 * ── Тариф створюється ЗАКРИТИМ, і це головне рішення файла ──────────────
 *
 * `options[].rate`, задана при створенні, засіває КАЛЕНДАР: ціна одразу
 * читається через `GET /restrictions` на кожну майбутню дату, а не лише там,
 * куди її поклали (INVENTORY §3.1, перевірено на живому API). Тобто нуль у
 * цьому полі — не «порожньо», а «нуль на всі дати».
 *
 * Обʼєкт при створенні каталогу ще ні до чого не підключений, тож саме по
 * собі це нікуди не поїде. Але між `syncCatalog()` і першою відправкою ARI
 * стоїть оператор, який вмикає канал в iFrame, — і рівно в цьому проміжку
 * нуль став би ціною ночі в OTA.
 *
 * Тому `stop_sell: true` на тарифі при створенні. Це та сама відповідь, що й
 * в інваріанті 17 і И2: ніч без ціни ЗАКРИТА, а не продана за вигаданим
 * числом. Відкриє її фаза 4 — разом зі справжніми цінами, одним і тим самим
 * запитом обмежень.
 *
 * ── Режим і заселеність: `sell_mode` їде явно, опції — за режимом ────────
 *
 * Без поля вендор ставить `per_room` — «одна опція на максимальну місткість,
 * ціна однакова на будь-яку кількість гостей», — а ми клали опцію на кожну
 * заселеність: тариф суперечив сам собі (HANDOVER-2026-09-01 §7). З Блоку
 * 2.2 (Ц26) режим обирає готель, шов `propertyRatePlans()` віддає опції за
 * ним (`per_room` — одну, `per_person` — на кожну кількість дорослих), а
 * тут режим лягає в тіло. Набір опцій після створення не переробити
 * (виміряно: `PUT` з `options` — нуль змін або 422), тому режим замкнений
 * заведенням — тримає писач тарифів.
 *
 * Заселеність понад `occ_adults` типу номера — жорстка 422, і вона валить
 * створення ВСЬОГО каталогу, а не лише цього тарифу. Обрізає шов
 * `propertyRatePlans()` — і саме ДОРОСЛОЮ місткістю, а не загальною; до
 * 01.09.2026 він різав по `max_occupancy`, і буденний сімейний номер «2
 * дорослих + 2 дітей» з цінами на 1..4 особи не заводився взагалі.
 *
 * ── Другої варти на опції тут НЕМАЄ, і це рішення ───────────────────────
 *
 * `default_occupancy` нижче обрізається вдруге, а список опцій — ні. Різниця
 * не в недбалості: варта на опції могла б бути лише двох родів, і обидва
 * гірші за її відсутність.
 *
 * Мовчазне обрізання тут ховало б регресію шва: каталог заводився б, а
 * заселеності зникали б без сліду — тобто ми проміняли б гучну помилку на
 * тиху втрату грошей, рівно той обмін, від якого застерігає інваріант 17.
 *
 * Іменований пропуск (`no_price`-подібний) виглядав би доречніше, але він
 * перетворив би поламаний шов на «нормальний стан із приміткою»: після
 * виправлення шва ця умова не може виникнути з наших даних узагалі, тож
 * пропуск був би способом жити з помилкою, а не страховкою від неї.
 *
 * Страховка тут інша й дешевша: `property-rate-plans.check.ts` містить
 * сімейний тип, у якого `max_adults` і `max_occupancy` розходяться — єдиний,
 * який розрізняє два правила обрізання. Поки його не було, гейт лишався
 * зеленим при будь-якому з них.
 */
import type { ChannexClient } from './client';
import { channexPropertyType } from './property-type';
import type {
  CatalogProperty,
  CatalogRatePlan,
  CatalogTarget,
  CatalogUnitType,
  RemoteOption,
} from '../domain/catalog.ts';

/**
 * Скільки осіб уміщає тип номера, як це розуміє Channex.
 *
 * `occ_children` і `occ_infants` — місця ЛИШЕ для дітей, тобто понад
 * дорослих. Документація каже «> 0» і тут же «якщо таких немає — 0»; живий
 * API приймає нуль (перевірено 31.08). Нуль і ставимо: вигадана дитяча
 * місткість — це номер, проданий на більше людей, ніж у ньому ліжок.
 */
function unitTypeAttributes(remotePropertyId: string, unitType: CatalogUnitType) {
  const adults = Math.max(1, Math.trunc(unitType.maxAdults));
  return {
    property_id: remotePropertyId,
    title: unitType.title,
    count_of_rooms: Math.max(1, Math.trunc(unitType.roomCount)),
    occ_adults: adults,
    occ_children: Math.max(0, Math.trunc(unitType.maxChildren)),
    occ_infants: 0,
    // Не більше за occ_adults — інакше 422 і впав весь каталог.
    default_occupancy: Math.min(adults, Math.max(1, Math.trunc(unitType.defaultOccupancy))),
  };
}

/**
 * Наш тариф на одному типі номера → тариф Channex.
 *
 * `meal_type` перекладається лише тоді, коли ми впевнені: чужий рядок, який
 * не входить у їхній перелік, дає 422 на весь каталог. Не впізнали — не
 * шлемо поле взагалі; тариф без вказаного харчування — нормальний тариф.
 */
const MEAL_TYPES = new Set([
  'none', 'all_inclusive', 'breakfast', 'lunch', 'dinner', 'american',
  'bed_and_breakfast', 'buffet_breakfast', 'carribean_breakfast',
  'continental_breakfast', 'english_breakfast', 'european_plan', 'family_plan',
  'full_board', 'full_breakfast', 'half_board', 'room_only', 'self_catering',
  'bermuda', 'dinner_bed_and_breakfast_plan', 'family_american',
  'breakfast_and_lunch', 'lunch_and_dinner',
]);

function ratePlanAttributes(
  remotePropertyId: string,
  remoteUnitTypeId: string,
  plan: CatalogRatePlan,
  occupancies: number[],
) {
  const meal = plan.mealPlan && MEAL_TYPES.has(plan.mealPlan) ? plan.mealPlan : undefined;

  return {
    property_id: remotePropertyId,
    room_type_id: remoteUnitTypeId,
    title: plan.title,
    currency: plan.currency,
    // Режим — явно, за вибором готелю (Ц26). Див. шапку.
    sell_mode: plan.sellMode,
    // Ціна — фазою 4. Поки тариф закритий, і це не обережність, а інваріант
    // 17: ніч без названої ціни не продається. Див. шапку.
    stop_sell: true,
    ...(meal ? { meal_type: meal } : {}),
    options: occupancies.map((occupancy, i) => ({
      occupancy,
      is_primary: i === 0,
    })),
  };
}

/**
 * Той бік, як його бачить домен, — поверх клієнта Channex.
 *
 * `key` — зʼєднання: ним ключується пауза й повтори. Не ключ API: один ключ
 * обслуговує всі готелі акаунта, а межа тут — обʼєкт.
 */
/**
 * Тіло `POST`/`PUT /properties` — ОДНЕ на створення й оновлення.
 *
 * Два тіла розійшлися б: рівно так `timezone` і опинився в адаптері, але не
 * в жодному тілі, яке насправді летить (Р13.11). Один будівник — і гейт
 * стверджує про нього, а не про доменний обʼєкт.
 *
 * Умовний спред лишається для НЕОБОВʼЯЗКОВИХ полів (адреса, телефон): їх
 * готель може не назвати, і порожній рядок вендору гірший за відсутність.
 * `timezone` і `property_type` під нього НЕ підпадають — вони обовʼязкові й
 * вартуються вище (`catalog-sync`), бо саме мовчазне випадання з тіла було
 * вихідним багом.
 */
export function propertyAttributes(property: CatalogProperty): Record<string, unknown> {
  const propertyType = channexPropertyType(property.propertyType);
  if (!propertyType) {
    // Сюди не дійти: `catalog-sync` вартує рід житла названою відмовою до
    // виклику. Але мовчазний пропуск тут повернув би рівно той баг, який ця
    // правка закриває, — вендор поставив би свій дефолт, а він «affects
    // billing». Тому це кидає, а не спреди.
    throw new Error(`channex: lodging kind "${property.propertyType}" has no vendor property_type`);
  }
  return {
    title: property.title,
    currency: property.currency,
    ...(property.country ? { country: property.country } : {}),
    ...(property.city ? { city: property.city } : {}),
    ...(property.address ? { address: property.address } : {}),
    ...(property.zipCode ? { zip_code: property.zipCode } : {}),
    ...(property.email ? { email: property.email } : {}),
    ...(property.phone ? { phone: property.phone } : {}),
    // Обидва — безумовно. Вендор: «Make sure you set property type and
    // timezone when you create a property», і `property_type` «affects
    // billing».
    timezone: property.timezone,
    property_type: propertyType,
  };
}

/**
 * Поля обʼєкта, за які відповідає PMS.
 *
 * Порівнюються перед оновленням: розійшлося щось із цього — летить `PUT`,
 * не розійшлося — не летить нічого. Усе, чого тут немає (фото, опис,
 * зручності, `facilities`), лишається за вендором і нашим оновленням не
 * чіпається.
 */
export const PROPERTY_FIELDS_WE_OWN = [
  'title', 'currency', 'country', 'city', 'address',
  'zip_code', 'email', 'phone', 'timezone', 'property_type',
] as const;

export function channexCatalogTarget(client: ChannexClient, key: string): CatalogTarget {
  return {
    createProperty(property: CatalogProperty): Promise<string> {
      return client.createProperty(key, propertyAttributes(property));
    },

    /**
     * Що у вендора розійшлося з нашим — назвами полів, які пішли б у тіло.
     *
     * Порожній масив означає «однакове», і тоді оновлення не кличеться.
     * `null` — обʼєкта у вендора немає (404 на читанні).
     */
    async propertyDrift(remotePropertyId: string, property: CatalogProperty): Promise<string[] | null> {
      const theirs = await client.getProperty(key, remotePropertyId);
      if (!theirs) return null;
      const ours = propertyAttributes(property);
      return PROPERTY_FIELDS_WE_OWN.filter((field) => {
        // Поля, якого ми не надсилаємо (готель не назвав адреси), не
        // розходження: інакше кожен синк слав би PUT, щоб нічого не змінити.
        if (!(field in ours)) return false;
        const mine = ours[field];
        const theirsValue = theirs[field];
        return String(mine ?? '') !== String(theirsValue ?? '');
      });
    },

    updateProperty(remotePropertyId: string, property: CatalogProperty): Promise<void> {
      return client.updateProperty(key, remotePropertyId, propertyAttributes(property));
    },

    createUnitType(remotePropertyId: string, unitType: CatalogUnitType): Promise<string> {
      return client.createRoomType(key, unitTypeAttributes(remotePropertyId, unitType));
    },

    async createRatePlan(
      remotePropertyId: string,
      remoteUnitTypeId: string,
      plan: CatalogRatePlan,
      occupancies: number[],
    ): Promise<{ id: string; options: RemoteOption[] }> {
      const made = await client.createRatePlan(
        key, ratePlanAttributes(remotePropertyId, remoteUnitTypeId, plan, occupancies),
      );

      // Опція, якої ми просили, але не отримали, — це ціна, яку потім не
      // буде куди покласти. Мовчазний пропуск тут означав би, що заселеність
      // на 3 осіб продається за ціною двох, і помітить це гість у рахунку.
      const got = new Set(made.options.map((o) => o.occupancy));
      const missing = occupancies.filter((o) => !got.has(o));
      if (missing.length) {
        throw new Error(`channex: rate plan created without occupancy option(s) ${missing.join(', ')}`);
      }

      return made;
    },
  };
}
