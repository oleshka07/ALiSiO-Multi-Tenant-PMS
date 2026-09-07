/**
 * Підписи джерел ціни — те, що оператор читає під числом.
 *
 * Живе в `ui/` навмисно: екран цін бере це через дозволені двері модуля
 * (`modules/<x>/ui/`), а не імпортом нутрощів — так само, як `day-edit.ts`.
 * Ключ рахує сервер (`monthOrigins` → `priceNights`); тут лише переклад
 * ключа в слово, без жодної логіки про те, яке джерело виграє.
 */
import type { PriceOrigin } from '../domain/day-price';

export type { PriceOrigin };

export const ORIGIN_LABELS: Record<PriceOrigin, string> = {
  rate_plan: 'ціна тарифу',
  rate_plan_weekend: 'ціна вихідних тарифу',
  matrix: 'матриця заселеності',
  unit_type: 'базова ціна',
  unit_type_weekend: 'ціна вихідних',
};
