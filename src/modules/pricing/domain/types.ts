export type {
  PriceCalendar,
  OccupancyRule,
  ChildPricingRule,
  Restriction,
  Promotion,
  FeeTax,
  RatePlan,
  RatePlanUnitType,
  PromotionType,
  PricingModel,
} from '@/types/database';

export interface DayPrice {
  date: string;
  day: number;
  dayOfWeek: number;
  isWeekend: boolean;
  base_price: number;
  weekend_price: number | null;
  effective_price: number;
  min_stay: number;
  max_stay: number | null;
  closed: number;
  cta: number;
  ctd: number;
  hasData: boolean;
  /** Сітка ТАРИФУ: число взяте з базового рядка типу, власного рядка тарифу на цей день немає. */
  inherited?: boolean;
}

export interface PriceUpsertInput {
  date: string;
  base_price?: number;
  weekend_price?: number | null;
  min_stay?: number;
  max_stay?: number | null;
  closed?: boolean;
  cta?: boolean;
  ctd?: boolean;
}

export interface QuoteResult {
  unitTypeId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  /** `source` says which of the three price sources answered — see nightly-price.ts. */
  breakdown: { date: string; dayName: string; price: number; isWeekend: boolean; source?: 'rate_plan' | 'matrix' | 'calendar' }[];
  accommodationTotal: number;
  /**
   * `collectedFor` — виручка готелю (`property`) чи збір для громади
   * (`authority`). Суму не змінює; вирішує, як рядок стане позицією
   * фіскального документа. Читає це модуль юрисдикції, не квота.
   */
  feeBreakdown: { name: string; amount: number; collectedFor: 'property' | 'authority' }[];
  /**
   * Збори, які вже всередині ціни ночі: показуються («у тому числі»), у
   * `feesTotal` і в `total` НЕ входять. Скласти `feeBreakdown` можна —
   * вийде рівно `feesTotal`; скласти обидва списки не можна, і саме тому
   * вони окремі.
   */
  includedFees: { name: string; amount: number; collectedFor: 'property' | 'authority' }[];
  feesTotal: number;
  total: number;
  currency: string;
  missingDays: number;
  hasPricing: boolean;
}
