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
  /**
   * Номер дебітора — тут, а не в `CompanyFields`, і це не дрібниця: `CompanyFields`
   * — це те, що ПРИЙМАЄТЬСЯ від людини (`normalizeCompany`), а номер видає
   * готель лічильником (Д56). Поклавши його туди, форма правки почала б його
   * приймати — і портьє переписав би картку дебітора на зайняте число.
   * `null` — у фірм, заведених до 0140.
   */
  debtor_no: number | null;
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

/**
 * Чи це відмова УНІКАЛЬНОСТІ саме за реєстраційним номером.
 *
 * Раніше тут стояло «будь-яка відмова унікальності = дубль ID», і це було
 * істинно рівно доти, доки унікальний індекс на `companies` був один. З
 * появою `idx_companies_debtor_no` (0140) їх два, і стара форма почала
 * НАЗИВАТИ ЧУЖУ ПРИЧИНУ: зіткнення номерів дебітора доповідало портьє
 * «такий ІД уже є», і той шукав би помилку в полі, якого не чіпав. Це та
 * сама смерть гейта з AGENTS §3.2.1, тільки в коді: візерунок замість
 * властивості.
 *
 * Обидва рушії називають, ЩО саме зіткнулось, — але по-різному, і рядки тут
 * ВИМІРЯНІ, а не взяті з документації (інваріант 28):
 *
 *   Postgres  duplicate key value violates unique constraint
 *             "idx_companies_org_business_id"          ← імʼя індексу
 *   SQLite    UNIQUE constraint failed:
 *             companies.organization_id, companies.business_id   ← колонки
 *
 * Спільне в обох — слово `business_id`, і саме воно тут і питається.
 * Невпізнана відмова унікальності НЕ перекладається: вона летить далі,
 * лягає в лог і повертає 500 (інваріант 6). Названа не своїм іменем відмова
 * гірша за неназвану — за нею людина шукає не там.
 */
function isDuplicateBusinessId(e: unknown): boolean {
  const msg = String((e as any)?.message ?? '');
  const detail = `${msg} ${String((e as any)?.constraint ?? '')} ${String((e as any)?.detail ?? '')}`;
  const code = String((e as any)?.code ?? '');
  const unique = code === '23505' || /UNIQUE constraint failed|duplicate key/i.test(msg);
  return unique && /business_id/i.test(detail);
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

/**
 * Наступний номер дебітора цього рахунку — атомарно.
 *
 * Номер видає ГОТЕЛЬ зі свого діапазону (Д56): реєстраційний номер фірми
 * (`business_id`) видає держава, і підміняти одне одним означало лишати без
 * номера кожну фірму без реєстрації — приватну особу, закордонного партнера.
 *
 * Форма — та сама, що в `allocateInvoiceNumber`
 * (`invoicing/domain/invoice-numbering.ts`), і це третє місце в проєкті, де
 * вона потрібна: збільшення і читання ОДНИМ інкрементом усередині однієї
 * транзакції. `UPDATE … SET x = x + 1` бере замок рядка, тож другий викликач
 * чекає й читає вже нове значення; прочитати-порахувати-записати двома
 * запитами означало б видати двом портьє один номер.
 *
 * `MAX(debtor_no) + 1` тут НЕ годиться: видалена або заархівована фірма
 * звільнила б свій номер, і наступна фірма сіла б у чужу картку дебітора.
 */
export async function allocateDebtorNo(organizationId: string): Promise<number> {
  const sql = getSql();
  return await sql.tx(async (t) => {
    await t.run(
      'UPDATE organizations SET next_debtor_no = next_debtor_no + 1 WHERE id = ?',
      [organizationId]);
    const row = await t.row<{ next_debtor_no: number }>(
      'SELECT next_debtor_no FROM organizations WHERE id = ?', [organizationId]);
    if (!row) throw new Error('Organization not found');
    // Лічильник уже зрушено, тож виданий номер — попередній.
    return Number(row.next_debtor_no) - 1;
  });
}

export async function createCompany(organizationId: string, fields: CompanyFields): Promise<string> {
  const id = crypto.randomUUID();
  const debtorNo = await allocateDebtorNo(organizationId);
  // Колонки — літералом, не зі списку: `check-insert-tenant` читає SQL
  // очима і має бачити `organization_id` (інваріант 12).
  const values = [id, organizationId, ...COMPANY_FIELDS.map((k) => fields[k] ?? null)];
  try {
    await getSql().run(
      `INSERT INTO companies
         (id, organization_id, name, business_id, vat_id, registry_no,
          address_street, address_city, address_zip, address_country,
          bank_name, iban, bic, email, phone, notes, payment_terms_days, debtor_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, debtorNo]);
  } catch (e) {
    if (isDuplicateBusinessId(e)) throw new DuplicateBusinessId();
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
    if (isDuplicateBusinessId(e)) throw new DuplicateBusinessId();
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
