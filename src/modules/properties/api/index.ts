// ─── Public API of the properties module ─────────────────────────────────────
// This is the ONLY file other modules may import from.
// Import via: import { ... } from '@properties'

// HTTP handlers (for Next.js route.ts files)
export {
  listProperties,
  createProperty,
  getProperty,
  updateProperty,
  deleteProperty,
} from './properties.handlers';

export {
  listUnits,
  createUnit,
  updateUnit,
  deleteUnit,
} from './units.handlers';

export {
  listUnitTypes,
  createUnitType,
  updateUnitType,
  deleteUnitType,
} from './unit-types.handlers';

// Будов більше немає. Корпуси й зони готель називає колонкою `units.zone` —
// простим текстом, який він друкує сам. Окрема таблиця з CRUD, FK і власним
// типом iCal-каналу існувала заради одного клієнта з будовою «F», і календар
// однаково групував по `building_name || zone`, тобто робив ту саму роботу
// вдвічі. Прибрано міграцією 0044.

export {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from './categories.handlers';

// Збори поверх ціни за ніч. Таблиця `fees_taxes` існувала від початку і
// квота її читала — а завести збір було нічим, крім файла готелю. Тобто в
// кожного реального клієнта мито й прибирання в квоті були нулем, і це мало
// вигляд «цей готель таких зборів не має».
export {
  listFees,
  createFee,
  updateFee,
  deleteFee,
} from './fees.handlers';

export { listGuestPageConfigs } from './guest-page-configs.handlers';
export { getGuestPageConfig, updateGuestPageConfig } from './guest-page-config.handlers';
export { listPropertyGuestConfigs, updatePropertyGuestConfig } from './property-guest-config.handlers';
export { uploadPhoto, deletePhoto } from './photos.handlers';

// Public types
export type {
  Property,
  Category,
  UnitType,
  Unit,
  CategoryType,
  RoomStatus,
  CleaningStatus,
} from '../domain/types';

// Загальний пошук питає модуль, а не таблицю. Див. core/search-types.ts.
export { searchUnits } from '../data/unit-search';

// Валюти готелю: основна одна (organizations.default_currency), другорядних
// 1–3, курс до основної — завжди у finance_exchange_rates.
export { getCurrencies, saveCurrencies, saveManualRate } from './currency.handlers';

// Наявність: одне джерело відповіді «чи вільно» для віджета і для батчера
// ARI. Другий розрахунок = овербукінг через OTA. Див. data/availability.ts.
export { availabilityByDay, freeUnitsForRange, unassignedPressureByDay } from '../data/availability';
export type { DateStr, UnitId, UnitTypeId, OccupiedSpan } from '../data/availability';
