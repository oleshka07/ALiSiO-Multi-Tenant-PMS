import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import type { Task, TaskTag } from '../domain/types';
import path from 'path';
import fs from 'fs';
import { requireOrganizationId } from '@core/auth/tenant-context';

// ─── Helpers ───────────────────────────────────────────────

function getOrgId(): string {
  return requireOrganizationId(getDb());
}

/**
 * task_tag_links is the only table here without an organization_id — it is a
 * link table. It reaches an organization through the task it links, which is
 * why the join exists rather than a plain WHERE on the link row.
 */
async function fetchTagsForTask(taskId: string): Promise<TaskTag[]> {
  const sql = getSql();
  return await sql.rows<TaskTag>(`
    SELECT tt.*
    FROM task_tags tt
    JOIN task_tag_links ttl ON ttl.tag_id = tt.id
    JOIN tasks t ON t.id = ttl.task_id
    WHERE ttl.task_id = ? AND t.organization_id = ? AND tt.organization_id = ?
    ORDER BY tt.name
  `, [taskId, getOrgId(), getOrgId()]);
}

// ─── List tasks with filters ──────────────────────────────

export interface ListTasksFilters {
  project_id?: string;
  status?: string;
  assignee_id?: string;
  priority?: string;
  property_id?: string;
  search?: string;
  due_date_from?: string;
  due_date_to?: string;
  parent_id?: string | null;
}

export async function listTasks(filters: ListTasksFilters = {}): Promise<Task[]> {
  const sql = getSql();
  const conditions: string[] = ['t.organization_id = ?'];
  const params: unknown[] = [getOrgId()];

  if (filters.project_id) {
    conditions.push('t.project_id = ?');
    params.push(filters.project_id);
  }
  if (filters.status) {
    conditions.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.assignee_id) {
    conditions.push('t.assignee_id = ?');
    params.push(filters.assignee_id);
  }
  if (filters.priority) {
    conditions.push('t.priority = ?');
    params.push(filters.priority);
  }
  if (filters.property_id) {
    conditions.push('t.property_id = ?');
    params.push(filters.property_id);
  }
  if (filters.search) {
    conditions.push('(t.title LIKE ? OR t.description LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term);
  }
  if (filters.due_date_from) {
    conditions.push('t.due_date >= ?');
    params.push(filters.due_date_from);
  }
  if (filters.due_date_to) {
    conditions.push('t.due_date <= ?');
    params.push(filters.due_date_to);
  }
  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null || filters.parent_id === '') {
      conditions.push('t.parent_id IS NULL');
    } else {
      conditions.push('t.parent_id = ?');
      params.push(filters.parent_id);
    }
  }

  const rows = await sql.rows<Task>(`
    SELECT
      t.*,
      a.full_name  AS assignee_name,
      cr.full_name AS creator_name,
      tp.name      AS project_name,
      tp.color     AS project_color,
      p.name       AS property_name,
      (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id) AS subtask_count,
      (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id AND sub.status = 'done') AS subtask_done_count
    FROM tasks t
    LEFT JOIN app_users a  ON a.id = t.assignee_id
    LEFT JOIN app_users cr ON cr.id = t.created_by
    LEFT JOIN task_projects tp ON tp.id = t.project_id
    LEFT JOIN business_units p ON p.id = t.property_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.sort_order, t.created_at DESC
  `, params);

  // Attach tags to each task
  for (const row of rows) {
    row.tags = await fetchTagsForTask(row.id);
  }

  return rows;
}

// ─── Get single task ──────────────────────────────────────

export async function getTaskById(id: string): Promise<(Task & { subtasks?: Task[] }) | null> {
  const sql = getSql();
  const org = getOrgId();

  const task = await sql.row<Task>(`
    SELECT
      t.*,
      a.full_name  AS assignee_name,
      cr.full_name AS creator_name,
      tp.name      AS project_name,
      tp.color     AS project_color,
      p.name       AS property_name,
      (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id) AS subtask_count,
      (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = t.id AND sub.status = 'done') AS subtask_done_count
    FROM tasks t
    LEFT JOIN app_users a  ON a.id = t.assignee_id
    LEFT JOIN app_users cr ON cr.id = t.created_by
    LEFT JOIN task_projects tp ON tp.id = t.project_id
    LEFT JOIN business_units p ON p.id = t.property_id
    WHERE t.id = ? AND t.organization_id = ?
  `, [id, org]);

  if (!task) return null;

  task.tags = await fetchTagsForTask(task.id);

  // Fetch subtasks
  const subtasks = await sql.rows<Task>(`
    SELECT
      t.*,
      a.full_name  AS assignee_name,
      cr.full_name AS creator_name
    FROM tasks t
    LEFT JOIN app_users a  ON a.id = t.assignee_id
    LEFT JOIN app_users cr ON cr.id = t.created_by
    WHERE t.parent_id = ? AND t.organization_id = ?
    ORDER BY t.sort_order, t.created_at
  `, [id, org]);

  for (const sub of subtasks) {
    sub.tags = await fetchTagsForTask(sub.id);
  }

  return { ...task, subtasks };
}

// ─── Create task ──────────────────────────────────────────

export interface CreateTaskInput {
  title: string;
  description?: string;
  project_id?: string;
  parent_id?: string;
  status?: string;
  priority?: string;
  due_date?: string;
  due_time?: string;
  assignee_id?: string;
  created_by?: string;
  property_id?: string;
  sort_order?: number;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const sql = getSql();
  const orgId = getOrgId();

  const result = await sql.row<any>(
    `
    INSERT INTO tasks (
      organization_id, title, description, project_id, parent_id,
      status, priority, due_date, due_time, assignee_id,
      created_by, property_id, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id`,
    [
    orgId,
    input.title,
    input.description ?? null,
    input.project_id ?? null,
    input.parent_id ?? null,
    input.status ?? 'todo',
    input.priority ?? 'normal',
    input.due_date ?? null,
    input.due_time ?? null,
    input.assignee_id ?? null,
    input.created_by ?? null,
    input.property_id ?? null,
    input.sort_order ?? 0,
  ],
  );
  return (await getTaskById(result!.id))!;
}

// ─── Update task ──────────────────────────────────────────

export async function updateTask(id: string, fields: Record<string, unknown>): Promise<Task | null> {
  const sql = getSql();
  const allowed = [
    'title', 'description', 'project_id', 'parent_id',
    'status', 'priority', 'due_date', 'due_time',
    'assignee_id', 'created_by', 'property_id', 'sort_order',
    'completed_at',
  ];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of allowed) {
    if (fields[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }

  // Auto-set completed_at when status changes to done
  if (fields.status === 'done' && fields.completed_at === undefined) {
    updates.push("completed_at = CURRENT_TIMESTAMP");
  }
  // Clear completed_at when moving out of done
  if (fields.status && fields.status !== 'done' && fields.completed_at === undefined) {
    updates.push('completed_at = NULL');
  }

  if (updates.length === 0) return null;

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, getOrgId());

  await sql.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`, values);
  return getTaskById(id);
}

// ─── Delete task ──────────────────────────────────────────

export async function deleteTask(id: string): Promise<{ ok: boolean }> {
  const sql = getSql();
  const org = getOrgId();

  // Clean up attachment files from disk before cascade delete removes DB rows
  // Include attachments from subtasks (which will be cascade-deleted)
  const attachments = await sql.rows<{ url: string }>(`
    SELECT a.url FROM task_attachments a
    JOIN tasks t ON a.task_id = t.id
    WHERE (t.id = ? OR t.parent_id = ?) AND t.organization_id = ?
  `, [id, id, org]);

  const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads', 'tasks');
  for (const att of attachments) {
    const filename = att.url.split('/').pop();
    if (filename) {
      const filePath = path.join(UPLOAD_DIR, filename);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  const res = await sql.run('DELETE FROM tasks WHERE id = ? AND organization_id = ?', [id, org]);
  return { ok: res.changes > 0 };
}

// ─── Toggle task status ───────────────────────────────────

export async function toggleTaskStatus(id: string): Promise<Task | null> {
  const sql = getSql();
  const org = getOrgId();
  const task = await sql.row<{ status: string }>(
    'SELECT status FROM tasks WHERE id = ? AND organization_id = ?', [id, org],
  );
  if (!task) return null;

  const newStatus = task.status === 'done' ? 'todo' : 'done';

  const completedAt = newStatus === 'done' ? "CURRENT_TIMESTAMP" : 'NULL';
  await sql.run(
    `UPDATE tasks SET status = ?, completed_at = ${completedAt}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`,
    [newStatus, id, org],
  );

  return getTaskById(id);
}

// ─── Reorder tasks ────────────────────────────────────────

export async function reorderTasks(updates: { id: string; sort_order: number }[]): Promise<void> {
  const sql = getSql();
  const org = getOrgId();
  await sql.tx(async (t) => {
    for (const u of updates) {
      await t.run(
        "UPDATE tasks SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?",
        [u.sort_order, u.id, org],
      );
    }
  });
}

// ─── Set task tags ────────────────────────────────────────

export async function setTaskTags(taskId: string, tagIds: string[]): Promise<TaskTag[]> {
  const sql = getSql();
  const org = getOrgId();

  // Both the task and every tag have to be this organization's, or the links
  // would attach one company's tag to another company's task.
  const owned = await sql.row<{ id: string }>(
    'SELECT id FROM tasks WHERE id = ? AND organization_id = ?', [taskId, org],
  );
  if (!owned) return [];

  await sql.tx(async (t) => {
    await t.run('DELETE FROM task_tag_links WHERE task_id = ?', [taskId]);
    for (const tagId of tagIds) {
      await t.run(
        'INSERT INTO task_tag_links (task_id, tag_id) SELECT ?, id FROM task_tags WHERE id = ? AND organization_id = ?',
        [taskId, tagId, org],
      );
    }
  });
  return fetchTagsForTask(taskId);
}
