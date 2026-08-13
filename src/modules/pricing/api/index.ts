// ─── Public API of the pricing module ────────────────────────────────────────
// Import via: import { ... } from '@pricing'

export { getPricing, updatePricing } from './pricing.handlers';
export { getBulkPricing, updateBulkPricing } from './bulk.handlers';
export { getQuote } from './quote.handlers';

// The price matrix: occupancy changes the price, never the category.
export {
  getOccupancyMatrix, createOccupancyPrice, updateOccupancyPrice, deleteOccupancyPrice,
  createLosTier, updateLosTier, deleteLosTier, quoteOccupancy,
} from './occupancy-price.handlers';
export { quoteStay, addDays } from '../domain/occupancy-price';
export type { PriceRow, LosTier, NightPrice, Quote } from '../domain/occupancy-price';

// Not wrapped with withPermission — authenticates via X-Cron-Secret header
// against process.env.CRON_SECRET. Called from a daily VPS crontab.
export { syncPriceLabsFromCron } from './cron-pricelabs-sync.handlers';

export type {
  PriceCalendar,
  DayPrice,
  PriceUpsertInput,
  QuoteResult,
  RatePlan,
  Promotion,
  PromotionType,
} from '../domain/types';
export { previewPricelabs } from './pricelabs-preview.handlers';
