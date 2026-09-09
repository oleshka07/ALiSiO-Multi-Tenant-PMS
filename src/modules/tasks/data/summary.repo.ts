import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { propertyOrSharedFilter, type PropertyScope } from '@core/property-scope';

/**
 * The counts the evening digest shows.
 *
 * This lived inside the notifications module and read the tasks table directly
 * — the kind of reach-past-the-front-door that makes a module impossible to
 * remove or replace. It also counted every organization's tasks into one
 * number, so a second hotel's overdue work appeared in the first hotel's
 * digest, names and all.
 */

export interface TasksSummary {
  overdue: number;
  overdueNames: string[];
  today: number;
  inProgress: number;
  total: number;
}

/**
 * Числа вечірнього дайджесту — по ОДНОМУ обʼєкту або по всьому рахунку.
 *
 * Область приходить типом і без значення за замовчуванням: дайджест власника
 * двох готелів законно зводить обидва, дайджест керівника одного будинку — ні,
 * і різницю мусить сказати той, хто його шле. Двері «або спільне» (О14): NULL
 * у `tasks.property_id` — задача рахунку, і вона стосується кожного будинку.
 */
export async function getTasksSummary(scope: PropertyScope): Promise<TasksSummary> {
  const sql = getSql();
  const org = await requireOrganizationId();
  const today = new Date().toISOString().split('T')[0];
  const inScope = propertyOrSharedFilter(scope, 'tasks');

  // Область стоїть у САМОМУ літералі кожного запиту, а не в змінній, яку
  // підставляють. Умова, зібрана підстановкою, статично не читається: гейт
  // кладе такий оператор у «невизначено», тобто «не доведено», — і жодне
  // переведення не було б видно ні машині, ні наступному читачеві.
  const OPEN = "AND status NOT IN ('done', 'cancelled')";

  const count = async (extra: string, rest: unknown[] = []): Promise<number> => {
    const row = await sql.row<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM tasks
        WHERE organization_id = ? AND ${inScope.sql} ${extra}`,
      [org, ...inScope.params, ...rest]);
    return row?.cnt ?? 0;
  };

  const overdueRows = await sql.rows<{ title: string }>(
    `SELECT title FROM tasks
      WHERE organization_id = ? AND ${inScope.sql} ${OPEN}
        AND due_date IS NOT NULL AND due_date < ?
      ORDER BY due_date ASC LIMIT 3`,
    [org, ...inScope.params, today]);

  return {
    overdue: await count(`${OPEN} AND due_date IS NOT NULL AND due_date < ?`, [today]),
    overdueNames: overdueRows.map((t) => t.title || ''),
    today: await count(`${OPEN} AND due_date = ?`, [today]),
    inProgress: await count("AND status = 'in_progress'"),
    total: await count(OPEN),
  };
}
