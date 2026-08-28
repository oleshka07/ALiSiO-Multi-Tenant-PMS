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

export {
  listBuildings,
  createBuilding,
  updateBuilding,
  deleteBuilding,
} from './buildings.handlers';

export {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from './categories.handlers';

export { listGuestPageConfigs } from './guest-page-configs.handlers';
export { getGuestPageConfig, updateGuestPageConfig } from './guest-page-config.handlers';
export { listPropertyGuestConfigs, updatePropertyGuestConfig } from './property-guest-config.handlers';
export { uploadPhoto, deletePhoto } from './photos.handlers';

// Public types
export type {
  Property,
  Category,
  Building,
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
