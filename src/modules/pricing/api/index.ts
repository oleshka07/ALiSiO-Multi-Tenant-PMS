// ─── Public API of the pricing module ────────────────────────────────────────
// Import via: import { ... } from '@pricing'

export { getPricing, updatePricing } from './pricing.handlers';
export { getBulkPricing, updateBulkPricing } from './bulk.handlers';
export { listRatePlanSettings, createRatePlanSetting, updateRatePlanSetting, deleteRatePlanSetting } from './rate-plans.handlers';
export { getQuote } from './quote.handlers';

// The price matrix: occupancy changes the price, never the category.
export {
  getOccupancyMatrix, createOccupancyPrice, updateOccupancyPrice, deleteOccupancyPrice,
  createLosTier, updateLosTier, deleteLosTier, quoteOccupancy,
} from './occupancy-price.handlers';
export { quoteStay, addDays } from '../domain/occupancy-price';

// One resolver for what a night costs, used by the operator quote and by the
// widget alike — the two used to keep separate copies of the arithmetic.
export { priceNights, cheapestByDay } from '../data/nightly-price';

// Шов §3.5: тарифи обʼєкта в тому вигляді, у якому їх треба знати модулю
// каналів. Іменується `PropertyRatePlan`, бо `RatePlan` у цьому ж фасаді вже
// зайнятий іншим — тарифом у розумінні екрана цін.
export { propertyRatePlans } from '../data/property-rate-plans';

// Писачі календаря — двері для скриптів засіву та гейтів інших модулів
// (гейт дверей каналів доводить через них, що ціна тарифу кладе координату
// лише на його пару). Орендар — із контексту, тариф звіряється з обʼєктом.
export { upsertPrices, bulkUpdatePrices, getPriceMonth } from '../data/price-calendar.repo';
export { dayRestrictions } from '../data/price-calendar.repo';
export type { DayRestrictions } from '../data/price-calendar.repo';
// Обмеження перебування — одне правило для віджета, бронювання й каналу (Д1/Д2).
export { stayRefusal, OPEN_STAY } from '../domain/restrictions';
export type { StayRestrictions, StayRefusal } from '../domain/restrictions';
export type { BulkUpdateInput, PriceCalendarOptions } from '../data/price-calendar.repo';
export type {
  RatePlan as PropertyRatePlan,
  RatePlanUnitType as PropertyRatePlanUnitType,
} from '../data/property-rate-plans';
export type { NightlyPrice, NightlyPrices } from '../data/nightly-price';
export type { PriceRow, LosTier, NightPrice, Quote } from '../domain/occupancy-price';

// Not wrapped with withPermission — authenticates via X-Cron-Secret header
// against process.env.CRON_SECRET. Called from a daily VPS crontab.

export type {
  PriceCalendar,
  DayPrice,
  PriceUpsertInput,
  QuoteResult,
  RatePlan,
  Promotion,
  PromotionType,
} from '../domain/types';
