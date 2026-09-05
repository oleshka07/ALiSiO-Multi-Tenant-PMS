/**
 * @companies/kernel — двері довідника для сусідніх модулів, без HTTP.
 *
 * `@bookings` при виборі платника на броні бере звідси знімок реквізитів;
 * `api/index.ts` тягне обробники з `next/server`, і сцена під голим node
 * його не імпортує.
 */
import { getCompany, createCompany } from '../data/companies.repo';
import { normalizeCompany, payerSnapshot, payerAddressLine, type PayerSnapshot } from '../domain/company';

export type { PayerSnapshot } from '../domain/company';

/**
 * Завести компанію з коду — для сцен сусідів (`company-stays.repo.check.ts`)
 * і, згодом, для синку каналу, якому OTA віддає юрособу. Та сама
 * нормалізація, що й у HTTP-обробнику.
 */
export async function createCompanyForTests(organizationId: string, body: Record<string, unknown>): Promise<string> {
  return await createCompany(organizationId, normalizeCompany(body) as any);
}

export interface CompanyPayer extends PayerSnapshot {
  id: string;
  name: string;
  archived: boolean;
  /** Для `fin_folios.payer_*`: адреса одним рядком, ДІЧ, ІД. */
  payer_address: string | null;
  payer_vat_no: string | null;
  payer_debtor_no: string | null;
}

/**
 * Реквізити компанії як платника. Чужа або неіснуюча — `null` (інваріант 5).
 * Архівна повертається з прапорцем: бронь, на якій вона вже стоїть, має
 * читатись; нову на неї викликач не ставить.
 */
export async function companyPayer(organizationId: string, id: string): Promise<CompanyPayer | null> {
  const c = await getCompany(organizationId, id);
  if (!c) return null;
  return {
    id: c.id, name: c.name, archived: c.archived_at !== null,
    ...payerSnapshot(c),
    payer_address: payerAddressLine(c), payer_vat_no: c.vat_id, payer_debtor_no: c.business_id,
  };
}
