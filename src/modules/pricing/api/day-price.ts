/**
 * Двері до правила дня: яке число рядка календаря діє на дату і з якої колонки.
 *
 *   import { dayRowPrice } from '@pricing/day-price';
 *
 * Окремий файл, а не повний фасад `@pricing`, з тієї самої причини, що
 * `@pricing/plans` і `@pricing/live`: цим правилом користується публічний
 * календар віджета, і тягнути туди HTTP-обробники модуля цін нема чого.
 *
 * Тут лише реекспорт домену — жодного коду.
 */
export { dayRowPrice, isWeekendDate, priceOrigin } from '../domain/day-price';
export type { PriceColumn, DayRowPrice, PriceOrigin } from '../domain/day-price';
