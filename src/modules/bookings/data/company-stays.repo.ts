/**
 * Скільки броней і гостей стоїть за кожною компанією-платником (Блок 4 §2.3).
 *
 * `reservations` належить bookings, тож і лічильник живе тут, а довідник
 * компаній питає його через `@bookings/kernel`. Один запит на організацію,
 * без N+1: список компаній — це десятки рядків, не тисячі.
 */
import { getSql } from '@core/db/async';

export interface CompanyStayStats {
  reservations: number;
  guests: number;
  last_check_in: string | null;
}

/**
 * Лічильник свідомо БЕЗ осі обʼєкта (INC-029).
 *
 * `companies` не має `property_id`: компанія-платник належить РАХУНКУ, а не
 * будинку — той самий контрагент замовляє номери в обох. Звузити лічильник
 * означало б показувати в довіднику компаній різні числа залежно від того, що
 * стоїть у шапці, при тому що сама компанія одна.
 */
export async function companyStays(organizationId: string): Promise<Map<string, CompanyStayStats>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await getSql().rows<any>(
    `SELECT r.company_id, COUNT(*) AS reservations, COUNT(DISTINCT r.guest_id) AS guests, MAX(r.check_in) AS last_check_in
       FROM reservations r
       JOIN properties p ON p.id = r.property_id
      WHERE p.organization_id = ? AND r.company_id IS NOT NULL AND r.status <> 'cancelled'
      GROUP BY r.company_id`,
    [organizationId]);
  const out = new Map<string, CompanyStayStats>();
  for (const r of rows) {
    out.set(String(r.company_id), {
      reservations: Number(r.reservations) || 0,
      guests: Number(r.guests) || 0,
      last_check_in: r.last_check_in ? String(r.last_check_in).slice(0, 10) : null,
    });
  }
  return out;
}
