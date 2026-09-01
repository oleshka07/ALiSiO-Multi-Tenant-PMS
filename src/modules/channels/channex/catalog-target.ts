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
 * ── Заселеність: одна опція на кожну, з обрізанням ──────────────────────
 *
 * Заселеність понад `occ_adults` типу номера — жорстка 422, і вона валить
 * створення ВСЬОГО каталогу, а не лише цього тарифу. Обрізає шов
 * `propertyRatePlans()` (там же й пояснення), але тут стоїть друга варта:
 * помилка коштує занадто дорого, щоб покладатися на одну.
 */
import type { ChannexClient } from './client';
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
export function channexCatalogTarget(client: ChannexClient, key: string): CatalogTarget {
  return {
    createProperty(property: CatalogProperty): Promise<string> {
      return client.createProperty(key, {
        title: property.title,
        currency: property.currency,
        ...(property.country ? { country: property.country } : {}),
        ...(property.city ? { city: property.city } : {}),
        ...(property.address ? { address: property.address } : {}),
        ...(property.zipCode ? { zip_code: property.zipCode } : {}),
        ...(property.email ? { email: property.email } : {}),
        ...(property.phone ? { phone: property.phone } : {}),
        ...(property.timezone ? { timezone: property.timezone } : {}),
      });
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
