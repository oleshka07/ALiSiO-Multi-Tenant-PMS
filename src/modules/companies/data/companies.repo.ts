/**
 * Довідник компаній-платників (Блок 4 §2.3, 0093).
 *
 * Організація — з сесії, у кожному запиті (інваріант 1); чужий id — `null`,
 * і викликач відповідає 404 (інваріант 5). `business_id` унікальний у межах
 * організації (інваріант 3) — це тримає сама база часткевим індексом, а тут
 * лише називається причина відмови, щоб рецепція побачила «така компанія
 * вже є», а не 500.
 *
 * Скільки в компанії броней і гостей — знає `@bookings` (`companyStays`);
 * цей файл до `reservations` не ходить.
 */
import { getSql } from '@core/db/async';
import { COMPANY_FIELDS, type CompanyFields } from '../domain/company';

export interface Company extends CompanyFields {
  id: string;
  organization_id: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyFilter {
  search?: string | null;
  /** Є пошта або телефон. */
  hasContact?: boolean;
  /** Є IBAN або назва банку. */
  hasBank?: boolean;
  includeArchived?: boolean;
  sort?: 'name' | 'created_at';
  dir?: 'asc' | 'desc';
}

export class DuplicateBusinessId extends Error {
  constructor() { super('duplicate_business_id'); }
}

function isUniqueViolation(e: unknown): boolean {
  const msg = String((e as any)?.message ?? '');
  const code = String((e as any)?.code ?? '');
  return code === '23505' || /UNIQUE constraint failed|duplicate key/i.test(msg);
}

export async function listCompanies(organizationId: string, f: CompanyFilter = {}): Promise<Company[]> {
  const where: string[] = ['organization_id = ?'];
  const params: unknown[] = [organizationId];
  if (f.search) {
    const like = `%${f.search.trim().toLowerCase()}%`;
    where.push("(LOWER(name) LIKE ? OR LOWER(COALESCE(business_id, '')) LIKE ? OR LOWER(COALESCE(vat_id, '')) LIKE ?)");
    params.push(like, like, like);
  }
  if (f.hasContact) where.push("(COALESCE(email, '') <> '' OR COALESCE(phone, '') <> '')");
  if (f.hasBank) where.push("(COALESCE(iban, '') <> '' OR COALESCE(bank_name, '') <> '')");
  if (!f.includeArchived) where.push('archived_at IS NULL');
  const sort = f.sort === 'created_at' ? 'created_at' : 'name';
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  return await getSql().rows<Company>(
    `SELECT * FROM companies WHERE ${where.join(' AND ')} ORDER BY ${sort} ${dir}, name ASC`, params);
}

export async function getCompany(organizationId: string, id: string): Promise<Company | null> {
  const row = await getSql().row<Company>(
    'SELECT * FROM companies WHERE id = ? AND organization_id = ?', [id, organizationId]);
  return row ?? null;
}

export async function createCompany(organizationId: string, fields: CompanyFields): Promise<string> {
  const id = crypto.randomUUID();
  // Колонки — літералом, не зі списку: `check-insert-tenant` читає SQL
  // очима і має бачити `organization_id` (інваріант 12).
  const values = [id, organizationId, ...COMPANY_FIELDS.map((k) => fields[k] ?? null)];
  try {
    await getSql().run(
      `INSERT INTO companies
         (id, organization_id, name, business_id, vat_id, registry_no,
          address_street, address_city, address_zip, address_country,
          bank_name, iban, bic, email, phone, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values);
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicateBusinessId();
    throw e;
  }
  return id;
}

/** Змінити названі поля; `false` — чужа або неіснуюча компанія. */
export async function updateCompany(organizationId: string, id: string, patch: Partial<CompanyFields>): Promise<boolean> {
  const keys = COMPANY_FIELDS.filter((k) => k in patch);
  if (keys.length === 0) return (await getCompany(organizationId, id)) !== null;
  const sets = keys.map((k) => `${k} = ?`);
  const values: unknown[] = keys.map((k) => patch[k] ?? null);
  try {
    const r = await getSql().run(
      `UPDATE companies SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`,
      [...values, id, organizationId]);
    return (r?.changes ?? 0) > 0;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicateBusinessId();
    throw e;
  }
}

/** В архів або назад. Архівна компанія випадає зі списку вибору, броні лишаються. */
export async function setCompanyArchived(organizationId: string, id: string, archived: boolean): Promise<boolean> {
  const r = await getSql().run(
    `UPDATE companies SET archived_at = ${archived ? 'CURRENT_TIMESTAMP' : 'NULL'}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`,
    [id, organizationId]);
  return (r?.changes ?? 0) > 0;
}

/** Видалити рядок довідника. Чи є на нього броні — перевіряє викликач через `@bookings`. */
export async function deleteCompany(organizationId: string, id: string): Promise<boolean> {
  const r = await getSql().run('DELETE FROM companies WHERE id = ? AND organization_id = ?', [id, organizationId]);
  return (r?.changes ?? 0) > 0;
}
