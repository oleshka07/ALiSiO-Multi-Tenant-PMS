/**
 * Клієнтські двері правила оплати з фоліо — чистий домен без серверних
 * імпортів (та сама причина, що в `ui/requote.ts`).
 */
export { folioSettlesStay, FOLIO_PAYMENT_METHODS } from '../domain/folio-payment';
export type { SettleSummary } from '../domain/folio-payment';
