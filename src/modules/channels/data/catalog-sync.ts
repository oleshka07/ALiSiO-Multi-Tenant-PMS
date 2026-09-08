import { getSql } from '@core/db/async';
import { refuse } from '@core/http/refusal';
import { isKnownTimezone } from '@core/hotel-day';
import { enqueueChange, OUTBOX_HORIZON_DAYS } from './outbox.repo';
import { addDays } from './outbox-notes';
import { catalogProperty, catalogUnitTypes } from '@properties/live';
// Вузькі двері — див. `@pricing/plans`: повний фасад тягне `next/server`.
import { propertyRatePlans } from '@pricing/plans';
import { connectionInTenant, rememberRemoteProperty } from './connections.repo';
import { putMapping, remoteIdOf } from './mappings.repo';
import {
  syncCatalog as runSyncCatalog,
  type CatalogDeps,
  type CatalogMirror,
  type CatalogRatePlan,
  type CatalogReport,
  type CatalogTarget,
  type CatalogUnitType,
} from '../domain/catalog.ts';

/**
 * Зібрати каталог обʼєкта і завести його в менеджері каналів.
 *
 * ── Що тут відбувається, а що ні ────────────────────────────────────────
 *
 * Тут — СКЛАДАННЯ: два шви (`@properties` і `@pricing`) дають фонд і тарифи,
 * дзеркало дає «що вже заведено», адаптер уміє це створити. Порядок дій — у
 * `../domain/catalog.ts`, поля вендора — в адаптері. Цей файл не знає ні
 * того, ні того, і саме тому його можна прочитати за раз.
 *
 * ── Чому обидва шви, а не один запит ────────────────────────────────────
 *
 * Тариф належить обʼєкту, а місткість — типу номера (інваріант 15), і живуть
 * вони в різних модулях. Один запит через межу модуля зекономив би рядок і
 * коштував би того, що зміна цінових таблиць мовчки ламала б синк каталогу.
 *
 * ── Орендар ─────────────────────────────────────────────────────────────
 *
 * `connectionId` приходить із URL, тож зʼєднання читається З ОБМЕЖЕННЯМ
 * (`connectionInTenant`), а не за самим лише id. Далі обʼєкт береться з
 * зʼєднання, а не з аргументу: інакше чужий `propertyId` заводив би чужий
 * готель у наш акаунт менеджера каналів.
 */
export interface CatalogSyncDeps {
  /** Той бік. Робить адаптер (`channexCatalogTarget`), не цей файл. */
  target: CatalogTarget;
}

/** Дзеркало поверх `cm_mappings`. Пара «тип × тариф» ключується обома. */
export function tableMirror(connectionId: string): CatalogMirror {
  return {
    remoteIdOf(entityType, localId, unitTypeId = '', occupancy = 0) {
      return remoteIdOf(connectionId, entityType, localId, occupancy, unitTypeId);
    },
    async put(row) {
      await putMapping(connectionId, {
        entityType: row.entityType,
        localId: row.localId,
        unitTypeId: row.unitTypeId ?? '',
        occupancy: row.occupancy ?? 0,
        remoteId: row.remoteId,
      });
      // Ц16: новий мапінг — це перша відправка. Тариф на тому боці створено
      // ЗАКРИТИМ, і відкриє його лише батчер із черги; тип чи пара, що
      // зʼявились у дзеркалі без координати, лишились би закритими назавжди
      // без жодної помилки — та сама тиша, що И14, поверхом вище.
      const today = new Date().toISOString().slice(0, 10);
      const horizon = addDays(today, OUTBOX_HORIZON_DAYS - 1);
      if (row.entityType === 'unit_type') {
        await enqueueChange(getSql(), connectionId, { kind: 'availability', unitTypeId: row.localId, date: today, dateTo: horizon });
      } else if (row.entityType === 'rate_plan' && row.unitTypeId) {
        await enqueueChange(getSql(), connectionId, { kind: 'rate', unitTypeId: row.unitTypeId, ratePlanId: row.localId, date: today, dateTo: horizon });
      }
    },
  };
}

/**
 * Каталог одного зʼєднання: прочитати наше, завести чуже, записати дзеркало.
 *
 * Кидає, якщо зʼєднання не наше або обʼєкт зник: це відмова, а не «нічого не
 * знайшли, отже нічого й не робимо» (інваріант 13).
 */
export async function syncConnectionCatalog(
  connectionId: string,
  deps: CatalogSyncDeps,
): Promise<CatalogReport> {
  const connection = await connectionInTenant(connectionId);
  if (!connection) throw new Error('catalog: connection not found');

  const property = await catalogProperty(connection.propertyId);
  if (!property) throw new Error('catalog: property not found');
  // Названа відмова, а не тихий здогад. Тип житла впливає на рахунок, який
  // вендор виставить ГОТЕЛЮ; підставити тут 'hotel' означало б заплатити за
  // нього його ж грошима. Інваріант 13: не знайшли — відмовляємо.
  //
  // `refuse`, а не `new Error`: уся мотивація цієї варти — «готель мусить
  // побачити причину», а голий Error затирався `serverError` до
  // «Внутрішня помилка сервера» ще на маршруті (Р13.10). Тепер текст їде
  // своїм 400.
  if (!property.propertyType) {
    refuse('catalog: property_type is not set — the hotel must say what kind of lodging it is');
  }
  // Пояс — тією ж вартою і з тієї ж причини (Р13.12).
  //
  // Він і був «надісланим» лише на вигляд: `catalog-target` клав його
  // умовним спредом, тож порожній рядок — а `NOT NULL` його дозволяє —
  // мовчки випадав з тіла, і ми опинялись там, звідки почали, без жодної
  // помилки. Вигадана ж зона поїхала б вендору і повернулась 422 посеред
  // створення каталогу, коли обʼєкт уже заведено.
  //
  // Перевіряється НЕПОРОЖНІСТЬ і належність до бази IANA — тим самим
  // `isKnownTimezone`, що й при заведенні готелю (`provisionOrganization`),
  // щоб два шляхи не розійшлися в тому, який пояс вважають справжнім.
  if (!property.timezone || !property.timezone.trim()) {
    refuse('catalog: the property has no timezone — the hotel must say which one it is in');
  }
  if (!isKnownTimezone(property.timezone)) {
    refuse(`catalog: timezone "${property.timezone}" is not a known IANA zone (Europe/Kyiv, Europe/Prague, …)`);
  }

  const unitTypes = await catalogUnitTypes(connection.propertyId);
  const ratePlans = await propertyRatePlans(connection.propertyId);

  const catalogUnits: CatalogUnitType[] = unitTypes.map((ut) => ({
    id: ut.id,
    code: ut.code,
    title: ut.name,
    roomCount: ut.roomCount,
    maxAdults: ut.maxAdults,
    maxChildren: ut.maxChildren,
    defaultOccupancy: ut.baseOccupancy,
  }));

  const catalogPlans: CatalogRatePlan[] = ratePlans.map((plan) => ({
    id: plan.id,
    code: plan.code,
    title: plan.name,
    currency: plan.currency,
    mealPlan: plan.mealPlan,
    sellMode: plan.sellMode,
    on: plan.unitTypes.map((ut) => ({ unitTypeId: ut.id, occupancies: ut.occupancies })),
    sellable: plan.sellable,
  }));

  const args: CatalogDeps = {
    property: {
      id: property.id,
      title: property.title,
      // Валюта обʼєкта — та, у якій він продає. Беремо з тарифів: окремої
      // колонки валюти в обʼєкта немає, і вигадувати дефолт тут не можна —
      // `|| 'CZK'` уже коштувало цьому проєкту гейта (`check-currency`).
      currency: catalogPlans[0]?.currency ?? '',
      country: property.country,
      city: property.city,
      address: property.address,
      email: property.email,
      phone: property.phone,
      // Обидва — вимога вендора перед продакшном, і обидва мовчали: типу не
      // існувало ніде, а пояс ВИГЛЯДАВ відправленим (умовний спред у
      // `catalog-target`), бо сюди його ніхто не клав.
      timezone: property.timezone,
      propertyType: property.propertyType,
    },
    unitTypes: catalogUnits,
    ratePlans: catalogPlans,
    target: deps.target,
    mirror: tableMirror(connectionId),
  };

  if (!args.property.currency) {
    // Обʼєкт без жодного тарифу не має чим назвати валюту, а менеджер
    // каналів вимагає її обовʼязково. Відмова тут дешевша за 422 посеред
    // створення, коли обʼєкт уже заведено, а тарифи — ще ні.
    refuse('catalog: property has no rate plan to take the currency from');
  }

  const report = await runSyncCatalog(args);

  // Шов до фази 5, який довго був порожній. Каталог заводиться бездоганно, а
  // стрічка броней починається з `if (!conn.remotePropertyId) throw` — тобто
  // без цього рядка броні з каналів не приїжджають НІКОЛИ, і виглядає це як
  // несправність стрічки, а не як незаписана колонка. Знайдено прогоном
  // проти живого staging; тримає `catalog-sync.check.ts`.
  await rememberRemoteProperty(connectionId, report.remotePropertyId);

  return report;
}
