import { LODGING_KINDS, type LodgingKind } from '@core/lodging-kinds';

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
