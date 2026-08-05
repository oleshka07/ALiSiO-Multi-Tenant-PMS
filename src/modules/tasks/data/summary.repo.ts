import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import { requireOrganizationId } from '@core/auth/tenant-context';

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

export async function getTasksSummary(): Promise<TasksSummary> {
  const sql = getSql();
  const org = await requireOrganizationId();
  const today = new Date().toISOString().split('T')[0];

  const open = "status NOT IN ('done', 'cancelled') AND organization_id = ?";

  const count = async (where: string, ...params: unknown[]): Promise<number> => {
    const row = await sql.row<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM tasks WHERE ${where}`, params);
    return row?.cnt ?? 0;
  };

  const overdueRows = await sql.rows<{ title: string }>(`
    SELECT title FROM tasks
    WHERE ${open} AND due_date IS NOT NULL AND due_date < ?
    ORDER BY due_date ASC LIMIT 3
  `, [org, today]);

  return {
    overdue: await count(`${open} AND due_date IS NOT NULL AND due_date < ?`, org, today),
    overdueNames: overdueRows.map((t) => t.title || ''),
    today: await count(`${open} AND due_date = ?`, org, today),
    inProgress: await count("status = 'in_progress' AND organization_id = ?", org),
    total: await count(open, org),
  };
}
