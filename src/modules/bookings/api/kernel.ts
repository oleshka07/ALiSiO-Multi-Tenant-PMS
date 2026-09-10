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

/**
 * Заселення й виселення — фасади, якими пише і рецепція, і кіоск. У kernel,
 * а не лише в `@bookings`: застосунок `kiosk` і його сцена під голим node
 * не можуть тягнути обробники з `next/server`.
 */
export { checkIn, checkOut, assignUnit, decideCheckIn } from '../data/checkin.repo';
export type { CheckinAnswer, CheckoutAnswer, AssignAnswer, FacadeActor } from '../data/checkin.repo';
export {
  checkinDecision, readCheckinPolicy, readSystemOfRecord,
  CHECKIN_PAYMENT_POLICIES, SYSTEMS_OF_RECORD,
} from '../domain/checkin-policy';
export type {
  CheckinPaymentPolicy, SystemOfRecord, CheckinActorKind, CheckinDecision, CheckinRefusal,
} from '../domain/checkin-policy';
