/**
 * `@invoicing/terms` — вузькі двері до строку оплати, БЕЗ обробників.
 *
 * Потрібні тому, що це читає ЕКРАН (`app/(dashboard)/documents/page.tsx`), а
 * повний фасад `@invoicing` тягне `next/server` і всю решту модуля. Той
 * самий взірець, що `@channels/outbox` і `@pricing/plans`.
 *
 * Через ці двері їде лише чиста арифметика — жодного запиту до бази, тож
 * клієнтський компонент може її кликати.
 */
export {
  DEFAULT_PAYMENT_TERMS_DAYS,
  dueDateFrom,
  customInvoiceDue,
} from '../domain/payment-terms';
