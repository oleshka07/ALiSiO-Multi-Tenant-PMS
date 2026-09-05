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
  /** NULL — ціни на цей день немає (лише обмеження): ніч не продається (інваріант 17). */
  base_price: number | null;
  weekend_price: number | null;
  effective_price: number | null;
  min_stay: number;
  max_stay: number | null;
  closed: number;
  cta: number;
  ctd: number;
  hasData: boolean;
  /** Звідки ціна рядка (Ц27); `manual` у рядку без ціни — лише обмеження. */
  source?: PriceSource;
  /** Сітка ТАРИФУ: число взяте з базового рядка типу, власного рядка тарифу на цей день немає. */
  inherited?: boolean;
}

/**
 * Одна семантика на КОЖНЕ поле (Блок 0.6 B4): поля немає в запиті — не
 * чіпати те, що лежить; явний `null` — прибрати (ціна → NULL, ніч у
 * `missing`; максимум → без межі; мінімум → 1; прапорець → знято); значення
 * — записати. Екран редактора дня шле всі поля разом, тож для нього це
 * непомітно; для писача, який шле частину полів, це різниця між «зберіг
 * мінімум» і «скинув усе інше».
 *
 * Звідки ціна дня (Блок 2 крок 1, Ц27): `season` — розгорнута з клітинки
 * сезону; `manual` — редактор дня чи масовий, точкове перевизначення, яке
 * перерендер сезону не затирає; `import` — файл готелю; `derived` — рядок
 * похідного тарифу, порахований від бази (Ц28, крок 2). Рядки «з правила»
 * (`season`, `derived`) перерендер переписує; `manual` з ціною — ніколи.
 */
export type PriceSource = 'season' | 'manual' | 'import' | 'derived';
export const PRICE_SOURCES: readonly PriceSource[] = ['season', 'manual', 'import', 'derived'];

export interface PriceUpsertInput {
  date: string;
  /** Джерело ціни, коли в запиті є ціна; без ціни джерело рядка не міняється. Дефолт — `manual`. */
  source?: PriceSource;
  /** 0 і менше — відмова `price_not_positive`. */
  base_price?: number | null;
  /** 0 і менше — відмова. */
  weekend_price?: number | null;
  min_stay?: number | null;
  max_stay?: number | null;
  closed?: boolean | null;
  cta?: boolean | null;
  ctd?: boolean | null;
}

export interface QuoteResult {
  unitTypeId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  /** `source` says which of the three price sources answered — see nightly-price.ts. */
  breakdown: {
    date: string; dayName: string; price: number; isWeekend: boolean; source?: 'rate_plan' | 'matrix' | 'calendar';
    /** Правила цін і промо на цю ніч (Ц31); `price` їх уже містить. */
    priceBeforeRules?: number;
    rules?: { name: string; delta: number; kind: 'rule' | 'promo' }[];
  }[];
  /** Сума ночей ДО правил цін (Ц31); `accommodationTotal` — після. */
  accommodationBeforeRules: number;
  /** Правила й промо, що спрацювали, із сумою по поїздці — рядки розкладу між ціною й зборами. */
  rules: { name: string; kind: 'rule' | 'promo'; total: number }[];
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

/**
 * Як тариф рахує гостей (Блок 2.2, Ц26).
 *
 * `per_room` — одна ціна на номер на будь-яку кількість гостей: ціна тарифу
 * на дату, без надбавок заселеності; у менеджера каналів — одна опція.
 * `per_person` — своя ціна на кожну кількість дорослих (надбавка з матриці
 * поверх ціни тарифу); опція на кожну кількість дорослих до місткості типу.
 * Словник закритий — docs/NAMING.md.
 */
export type SellMode = 'per_room' | 'per_person';
export const SELL_MODES: readonly SellMode[] = ['per_room', 'per_person'];

/**
 * Похідний тариф (Блок 2 крок 2, Ц28): ціна доби = ціна базового тарифу на
 * дату ± коригування. `manual` — тариф зі своїми цінами (календар, сезони);
 * `derived` — рядки рахуються від бази й рендеряться в календар з
 * `source = 'derived'`. Похідний від похідного не буває — писач відмовляє.
 */
export type PricingType = 'manual' | 'derived';
export const PRICING_TYPES: readonly PricingType[] = ['manual', 'derived'];
/** Відсоток від бази або сума в валюті тарифу. */
export type AdjustmentKind = 'percent' | 'fixed';
export const ADJUSTMENT_KINDS: readonly AdjustmentKind[] = ['percent', 'fixed'];
export type AdjustmentDirection = 'increase' | 'decrease';
export const ADJUSTMENT_DIRECTIONS: readonly AdjustmentDirection[] = ['increase', 'decrease'];

export interface RateAdjustment {
  kind: AdjustmentKind;
  /** Додатне число: відсоток (0 < v < 100 для зменшення) або сума. */
  value: number;
  direction: AdjustmentDirection;
}
