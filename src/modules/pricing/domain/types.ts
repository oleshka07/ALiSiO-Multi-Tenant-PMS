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
  /** `source` says which of the two price sources answered — see nightly-price.ts. */
  breakdown: { date: string; dayName: string; price: number; isWeekend: boolean; source?: 'matrix' | 'calendar' }[];
  accommodationTotal: number;
  feeBreakdown: { name: string; amount: number }[];
  feesTotal: number;
  total: number;
  currency: string;
  missingDays: number;
  hasPricing: boolean;
}
