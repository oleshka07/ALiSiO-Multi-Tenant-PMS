import { LODGING_KINDS, type LodgingKind } from '@core/lodging-kinds';
import { billingBasisOf, lodgingKindsBilledBy, type LodgingBillingBasis } from '../ui/billing-group';

/**
 * Рід житла (наш) → `property_type` (вендорський).
 *
 * ── Навіщо мапа, якщо значення збігаються ────────────────────────────────
 *
 * Бо збіг — це стан, а не домовленість. Перелік родів житла живе в ядрі
 * (`@core/lodging-kinds`): він потрібен формі обʼєкта готелю, який модуль
 * каналів не купував. Вендорський `property_type` — факт про Channex.
 * Сьогодні обидва набори збігаються слово в слово, і мапа тотожна; коли
 * вендор перейменує `holiday_home` або додасть значення, зміниться цей файл,
 * і жоден рядок ядра не зрушить.
 *
 * Раніше цього шва не було: писач обʼєкта в `modules/properties` імпортував
 * вендорський перелік із `modules/channels/ui/`, тобто базовий модуль
 * відмовляв за списком продаваного (Р13.15). Зворотний напрямок імпорту
 * тепер тримає `check-boundaries --strict`.
 *
 * ── Чому мапа перелічена, а не приведення типу ───────────────────────────
 *
 * `as string` сховав би розбіжність: рід, якого вендор не знає, поїхав би в
 * тіло запиту і повернувся 422 посеред створення каталогу. Тут кожен рід
 * названий, `Record<LodgingKind, string>` не дає пропустити новий, а
 * `channexPropertyType` повертає `null` для того, чого вендор не приймає —
 * і кличучий бік мусить вирішити, що з цим робити, замість мовчазного
 * пропуску.
 */
const TO_CHANNEX: Record<LodgingKind, string | null> = {
  apart_hotel: 'apart_hotel',
  apartment: 'apartment',
  boat: 'boat',
  camping: 'camping',
  capsule_hotel: 'capsule_hotel',
  chalet: 'chalet',
  country_house: 'country_house',
  farm_stay: 'farm_stay',
  guest_house: 'guest_house',
  holiday_home: 'holiday_home',
  holiday_park: 'holiday_park',
  homestay: 'homestay',
  hostel: 'hostel',
  hotel: 'hotel',
  inn: 'inn',
  lodge: 'lodge',
  motel: 'motel',
  resort: 'resort',
  riad: 'riad',
  ryokan: 'ryokan',
  tent: 'tent',
  villa: 'villa',
};

/**
 * Група тарифікації вендора — те, ЗА ЩО він виставить рахунок.
 *
 * ── Таблиця тут НЕ лежить, і це навмисно ────────────────────────────────
 *
 * Розбиття родів житла на «за обʼєкт» і «за юніт» живе в
 * `../ui/billing-group.ts` доменними словами (`per_property`, `per_unit`) —
 * бо його читає ЕКРАН, на якому оператор обирає рід, і читає в браузері.
 * Клієнтський компонент не може імпортувати цю теку: разом із нею поїхали б
 * `client.ts`, ключі й транспорт.
 *
 * Тут — переклад у слова вендора, і тільки він. Двох таблиць немає
 * свідомо: два списки одного факту розходяться мовчки, і розійшлися б саме
 * тоді, коли вендор перенесе рід із групи в групу.
 *
 * ── Чому це взагалі має вагу ────────────────────────────────────────────
 *
 * Лист вендора 09.09.2026 (`docs/vendor/channex/billing-2026-09-09.md`,
 * збережений дослівно): «Billing follows the property_type you set on
 * create. Hotel-group types bill at $7/property; vacation-rental types at
 * $0.50/unit.» Тобто рід житла — не «коректність каталогу», а вісь рахунку
 * готелю, і помилка тут МОВЧИТЬ: неправильний рід дає неправильний рахунок
 * доти, доки хтось не звірить виписку (інваріант 29).
 *
 * Сум у коді немає і не буде: $7 і $0.50 змінюються без нас. Код називає
 * ГРУПУ; джерело правди для сум — лист і сторінка цін вендора.
 */
export type ChannexBillingGroup = 'hotel' | 'vacation_rental';

const GROUP_OF_BASIS: Record<LodgingBillingBasis, ChannexBillingGroup> = {
  per_property: 'hotel',
  per_unit: 'vacation_rental',
};

/**
 * За що вендор виставить рахунок для цього роду житла.
 *
 * `null` — рід поза переліком вендора; тоді питання рахунку не стоїть, бо
 * обʼєкт із таким родом до вендора не поїде взагалі (`propertyAttributes`
 * відмовляє).
 */
export function channexBillingGroup(kind: string | null | undefined): ChannexBillingGroup | null {
  const basis = billingBasisOf(kind);
  return basis === null ? null : GROUP_OF_BASIS[basis];
}

/** Роди житла однієї групи тарифікації. Для гейта і для екрана. */
export function lodgingKindsInBillingGroup(group: ChannexBillingGroup): LodgingKind[] {
  const basis = (Object.keys(GROUP_OF_BASIS) as LodgingBillingBasis[])
    .find((b) => GROUP_OF_BASIS[b] === group)!;
  return lodgingKindsBilledBy(basis);
}

/**
 * Вендорське значення для нашого роду житла, або `null`, якщо вендор такого
 * не приймає.
 *
 * `null` — не «пропусти поле»: див. шапку. Кличучий бік відмовляє названими
 * словами (`catalog-sync`), бо мовчки надіслати обʼєкт без роду означає
 * дозволити вендору поставити свій дефолт, а він «affects billing».
 */
export function channexPropertyType(kind: string | null | undefined): string | null {
  if (!kind || !(kind in TO_CHANNEX)) return null;
  return TO_CHANNEX[kind as LodgingKind];
}

/** Роди житла, які вендор приймає. Для гейтів і для екрана. */
export const CHANNEX_PROPERTY_TYPES = LODGING_KINDS
  .filter((k) => TO_CHANNEX[k] !== null)
  .map((k) => TO_CHANNEX[k] as string);
