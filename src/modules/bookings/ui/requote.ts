/**
 * Клієнтські двері переквотування — чистий домен без серверних імпортів
 * (та сама причина, що в `ui/booking-history.ts`: `@bookings` тягне базу).
 */
export { requoteDelta, isChannelBooking } from '../domain/requote';
export type { RequoteDelta, RequoteQuote } from '../domain/requote';
