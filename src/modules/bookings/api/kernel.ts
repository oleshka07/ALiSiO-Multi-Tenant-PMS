/**
 * @bookings/kernel — двері броней для сусідніх модулів, без HTTP.
 *
 * `api/index.ts` тягне обробники, а з ними `next/server`; сцени сусідів під
 * голим node і довідники, яким потрібні лише числа, беруть звідси.
 */
export { companyStays } from '../data/company-stays.repo';
export type { CompanyStayStats } from '../data/company-stays.repo';

// В3: статус оплати броні виводиться з фоліо — один перерахунок на всіх, хто
// приймає гроші (каса, оплата з фоліо, маркер). Саме в KERNEL, а не у важкому
// фасаді: `@bookings` тягне `@invoicing`, а той — генератор PDF, який під
// голим node падає на `__dirname`, тож сцена каси не піднімалась узагалі.
export { recalcPaymentStatusFromFolio } from '../data/payment-status.repo';
export type { PaymentStatusChange } from '../data/payment-status.repo';
