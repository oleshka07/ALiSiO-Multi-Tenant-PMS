/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSql } from '@core/db/async';
import { requireOrganizationId } from '@core/auth/tenant-context';

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
