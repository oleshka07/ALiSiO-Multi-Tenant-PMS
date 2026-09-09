/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { refuse } from '@core/http/errors';

/**
 * «Is this row this hotel's?» — asked in SQL, for the finance module.
 *
 * The list and create handlers here name the organization. The ones that take
 * an id — get, update, delete, merge — did not: they wrote `WHERE id = ?` and
 * left the rest to row-level security. On Postgres that mostly held. On SQLite
 * there is no policy at all, and the ids are guessable (`inc_${Date.now()}`),
 * so an operation, an account, a capex line or a budget could be read, edited,
 * merged or deleted across tenants by anyone with finance access anywhere.
 *
 * AGENTS.md §3: the tenant is named in the query. Two mechanisms, deliberately
 * — the reintroduction test on `booking_sites` showed each covers an engine the
 * other does not.
 */

/** The row, if this organization owns it. Undefined reads as «does not exist». */
export async function ownedFinanceRow(
  table: 'fin_operations' | 'finance_accounts' | 'capex_items' | 'fin_budgets'
    | 'expense_categories' | 'finance_counterparties' | 'business_units'
    | 'finance_tags' | 'fin_auto_rules' | 'fin_recurring_templates',
  id: string,
  organizationId?: string,
): Promise<any | undefined> {
  const sql = getSql();
  const org = organizationId ?? await requireOrganizationId();
  // The table name is from the union above — a literal in this file, never
  // from a request — so interpolating it is safe and the id stays bound.
  return await sql.row<any>(
    `SELECT * FROM "${table}" WHERE id = ? AND organization_id = ?`, [id, org]);
}

/**
 * Поле, яке вказує в довідник фінансів, і таблиця, у якій воно живе.
 *
 * Список один на всі шляхи запису НАВМИСНО. Р12.3 закрив `createOperationInTx`
 * і `updateOperation`, і кожен закрив своїм шматком коду; уже за добу
 * знайшлося ще три двері в те саме поле — авто-правила (`set_category_id` та
 * рідня), шаблон регулярного платежу і бюджетний рядок, — і жодні з них про
 * ту варту не знали (Р13.1, Р13.7). Дві реалізації однієї перевірки
 * розходяться; шість — розходяться шість разів.
 */
export const CATALOGUE_REFERENCES = [
  ['category_id', 'expense_categories', 'Статті обліку'],
  ['account_from_id', 'finance_accounts', 'Рахунку'],
  ['account_to_id', 'finance_accounts', 'Рахунку'],
  ['project_id', 'business_units', 'Бізнес-юніту'],
  ['counterparty_id', 'finance_counterparties', 'Контрагента'],
] as const;

export type CatalogueField = typeof CATALOGUE_REFERENCES[number][0];

/**
 * Кожне назване поле — рядок ЦЬОГО готелю, або названа відмова 404.
 *
 * Чому база цього не спиняє. Зовнішній ключ ОДНОКОЛОНКОВИЙ
 * (`category_id → expense_categories(id)`): він доводить, що рядок існує, і
 * мовчить про те, чий він. А RI-тригери Postgres виконуються з ВИМКНЕНОЮ row
 * security — політика, яка ховає чужий рядок від читання, при перевірці ключа
 * не діє. Тож чужий ідентифікатор проходить, і виходить рядок, чия стаття для
 * його ж готелю невидима: у списку порожня назва, у P&L гроші лягають не в
 * той рядок звіту, мовчки.
 *
 * Чужий id → 404, не 403 (інваріант 5): для цього готелю такого рядка не
 * існує, і відповідь не має підказувати, що він існує в когось іншого.
 *
 * `undefined`, `null` і `''` пропускаються: «поля немає в запиті» і «поле
 * очищають» — це не посилання, і вимагати від них належності означало б
 * відмовляти в очищенні.
 */
export async function requireOwnedReferences(
  organizationId: string,
  input: Readonly<Record<string, unknown>> | object,
  fields: readonly (readonly [string, Parameters<typeof ownedFinanceRow>[0], string])[] = CATALOGUE_REFERENCES,
): Promise<void> {
  for (const [field, table, what] of fields) {
    const value = (input as Record<string, unknown>)[field];
    if (value === undefined || value === null || value === '') continue;
    if (!await ownedFinanceRow(table, String(value), organizationId)) {
      refuse(`${what} з таким ідентифікатором у цього готелю немає.`, 404);
    }
  }
}

/**
 * Ті самі пʼять полів, але названі так, як їх називає авто-правило.
 *
 * `set_category_id` — це `category_id`, просто в іншому тілі запиту. Мапа
 * існує, щоб варта лишалась ОДНА: інакше поруч зʼявилась би друга копія
 * списку таблиць, і перше ж нове поле потрапило б лише в одну з них.
 */
export const RULE_ACTION_REFERENCES = [
  ['set_category_id', 'expense_categories', 'Статті обліку'],
  ['set_project_id', 'business_units', 'Бізнес-юніту'],
  ['set_counterparty_id', 'finance_counterparties', 'Контрагента'],
] as const;
