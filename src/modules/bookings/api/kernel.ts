/**
 * @bookings/kernel — двері броней для сусідніх модулів, без HTTP.
 *
 * `api/index.ts` тягне обробники, а з ними `next/server`; сцени сусідів під
 * голим node і довідники, яким потрібні лише числа, беруть звідси.
 */
export { companyStays } from '../data/company-stays.repo';
export type { CompanyStayStats } from '../data/company-stays.repo';
