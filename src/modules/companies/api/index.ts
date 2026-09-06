/**
 * @companies — довідник компаній-платників (Блок 4 §2.3, 0093). Ядро, без
 * ключа модуля: юрособа-платник є в будь-якому готелі.
 */
export { listCompanies, createCompany, getCompany, updateCompany, deleteCompany } from './companies.handlers';
export { companyPayer } from './kernel';
export type { CompanyPayer } from './kernel';
