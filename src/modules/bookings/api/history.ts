/**
 * Двері історії броні для інших модулів — окремим входом, не через `@bookings`.
 *
 * Повний фасад тягне обробники з листами й PDF, а їх завантаження у процесі
 * перевірки (ESM, без `__dirname`) падає ще до першого запиту. Писачу з
 * іншого модуля потрібні лише запис, знімок і опис різниці.
 */
export { recordBookingChange, bookingSnapshot, HISTORY_ACTIONS } from '../data/booking-history.repo';
export type { BookingChange, HistoryActor } from '../data/booking-history.repo';
export { describeChanges, changesToText } from '../domain/booking-history';
export type { ChangeLine, BookingSnapshot } from '../domain/booking-history';
