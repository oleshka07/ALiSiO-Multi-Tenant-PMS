/**
 * Двері модуля цін для ВХОДІВ, які запускають у прод-образі.
 *
 *   import { priceNights, upsertPrices } from '@pricing/live';
 *
 * `@pricing/plans` поруч — двері для ПИСАЧІВ (`apply-hotel`, нотатки черги):
 * там рівно три імені, і розширювати їх під живі проходи означало б знову
 * зібрати фасад. Тут — те, що просять `scripts/channex-*-live.mjs`.
 *
 * Причина спільна: повний фасад `@pricing` тягне `pricing.handlers.ts` →
 * `next/server`, якого прод-образ не має. Лише реекспорт із шару даних.
 */
export { priceNights } from '../data/nightly-price';
export { updateRatePlan, listRatePlans } from '../data/rate-plans.repo';
export { propertyRatePlans } from '../data/property-rate-plans';
export {
  upsertPrices, bulkUpdatePrices, getPriceMonth,
  dayRestrictions, pairRestrictionsAt, pricedDaysAhead,
} from '../data/price-calendar.repo';
export type { DayRestrictions } from '../data/price-calendar.repo';
