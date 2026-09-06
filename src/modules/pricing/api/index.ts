// ─── Public API of the pricing module ────────────────────────────────────────
// Import via: import { ... } from '@pricing'

export { getPricing, updatePricing } from './pricing.handlers';
export { getBulkPricing, updateBulkPricing } from './bulk.handlers';
export { listRatePlanSettings, createRatePlanSetting, updateRatePlanSetting, deleteRatePlanSetting } from './rate-plans.handlers';
export { getQuote } from './quote.handlers';
// Сезони (Блок 2 крок 1, Ц27): правило, яке рендериться в календар писачем
// масового редактора — другого джерела ціни не зʼявляється.
export {
  listSeasonSettings, createSeasonSetting, updateSeasonSetting, deleteSeasonSetting, splitSeasonSetting,
  listSeasonPriceCells, putSeasonPriceCell, deleteSeasonPriceCell, clearSeasonOverridesSetting,
} from './seasons.handlers';
export { listSeasons, createSeason, updateSeason, deleteSeason, splitSeason, seasonPrices, setSeasonPrice, clearSeasonOverrides } from '../data/seasons.repo';
export type { Season, SeasonPriceCell, SeasonInput, SeasonPriceInput } from '../data/seasons.repo';
export type { PriceSource } from '../domain/types';
// Надбавки за заселеність (Блок 2 крок 3, Ц30): правило поверх ціни ночі.
export { listExtraOccupancyRules, createExtraOccupancyRule, updateExtraOccupancyRule, deleteExtraOccupancyRule } from './extra-occupancy.handlers';
export { listRules as listExtraOccupancyRulesOf, createRule as createExtraOccupancyRuleOf, ageBandsOf, normalizeBoundaries } from '../data/extra-occupancy.repo';
export { bandsFrom, bandIndexFor, nightSurcharges, ADULT_AGE } from '../domain/extra-occupancy';
export type { OccupancyRule, AgeBand, GuestKind, SurchargeMode } from '../domain/extra-occupancy';
// Правила цін і промо (Блок 2 крок 4, Ц31): шар після надбавок і до зборів.
export { listPriceRules, createPriceRule, updatePriceRule, deletePriceRule } from './price-rules.handlers';
export { redeemPromoCode, rulesForProperty as priceRulesForProperty } from '../data/price-rules.repo';
export { applyRules, RULE_KINDS, RULE_CONDITIONS, RULE_ACTIONS, RULE_VALUE_KINDS } from '../domain/price-rules';
export type { PriceRule, RuleDelta, StayContext, SalesChannel, RuleKind, RuleCondition, RuleAction, RuleValueKind } from '../domain/price-rules';

// The price matrix: occupancy changes the price, never the category.
export {
  getOccupancyMatrix, createOccupancyPrice, updateOccupancyPrice, deleteOccupancyPrice,
  createLosTier, updateLosTier, deleteLosTier, quoteOccupancy,
} from './occupancy-price.handlers';
export { quoteStay, addDays } from '../domain/occupancy-price';
// Рядок матриці як писач — для перевірок сусідніх модулів (канал), яким до
// цінових таблиць не можна (інваріант 16, `check-price-source`).
export { createPrice as createOccupancyRow, loadMatrix as occupancyMatrixOf } from '../data/occupancy-price.repo';

// One resolver for what a night costs, used by the operator quote and by the
// widget alike — the two used to keep separate copies of the arithmetic.
export { priceNights, cheapestByDay } from '../data/nightly-price';

// Шов §3.5: тарифи обʼєкта в тому вигляді, у якому їх треба знати модулю
// каналів. Іменується `PropertyRatePlan`, бо `RatePlan` у цьому ж фасаді вже
// зайнятий іншим — тарифом у розумінні екрана цін.
export { propertyRatePlans } from '../data/property-rate-plans';

// Писач тарифів — двері для живого проходу (`channex-ari-live.mjs --retire`):
// зняти з продажу й повернути тим самим кодом, що й екран, і побачити в
// календарі вендора «закрито» (інваріант 27).
export { updateRatePlan, listRatePlans } from '../data/rate-plans.repo';
export type { RatePlanSetting, UpdateRatePlanInput } from '../data/rate-plans.repo';

// Писачі календаря — двері для скриптів засіву та гейтів інших модулів
// (гейт дверей каналів доводить через них, що ціна тарифу кладе координату
// лише на його пару). Орендар — із контексту, тариф звіряється з обʼєктом.
export { upsertPrices, bulkUpdatePrices, getPriceMonth } from '../data/price-calendar.repo';
export { dayRestrictions, pairRestrictionsAt, pricedDaysAhead } from '../data/price-calendar.repo';
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
  SellMode,
} from '../domain/types';
export { SELL_MODES } from '../domain/types';
