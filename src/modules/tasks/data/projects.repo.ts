import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import type { TaskProject } from '../domain/types';
import { requireOrganizationId } from '@core/auth/tenant-context';

// ─── Helpers ───────────────────────────────────────────────

function getOrgId(): string {
  return requireOrganizationId(getDb());
}

// ─── List projects ────────────────────────────────────────

export async function listProjects(): Promise<TaskProject[]> {
  const sql = getSql();
  const org = getOrgId();
  return await sql.rows<TaskProject>(`
    SELECT
      tp.*,
      p.name AS property_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = tp.id) AS task_count
    FROM task_projects tp
    LEFT JOIN properties p ON p.id = tp.property_id
    WHERE tp.organization_id = ?
    ORDER BY tp.sort_order, tp.created_at
  `, [org]);
}

// ─── Get single project ──────────────────────────────────

export async function getProjectById(id: string): Promise<TaskProject | null> {
  const sql = getSql();
  const project = await sql.row<TaskProject>(`
    SELECT
      tp.*,
      p.name AS property_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = tp.id) AS task_count
    FROM task_projects tp
    LEFT JOIN properties p ON p.id = tp.property_id
    WHERE tp.id = ? AND tp.organization_id = ?
  `, [id, getOrgId()]);
  return project ?? null;
}

// ─── Create project ──────────────────────────────────────

export interface CreateProjectInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parent_id?: string;
  property_id?: string;
  sort_order?: number;
}

export async function createProject(input: CreateProjectInput): Promise<TaskProject> {
  const sql = getSql();
  const orgId = getOrgId();

  const result = await sql.run(`
    INSERT INTO task_projects (organization_id, name, description, color, icon, parent_id, property_id, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    orgId,
    input.name,
    input.description ?? null,
    input.color ?? '#4f6ef7',
    input.icon ?? '📁',
    input.parent_id ?? null,
    input.property_id ?? null,
    input.sort_order ?? 0,
  ]);

  const row = await sql.row<{ id: string }>('SELECT id FROM task_projects WHERE rowid = ?', [result.lastId]);
  return (await getProjectById(row!.id))!;
}

// ─── Update project ──────────────────────────────────────

export async function updateProject(id: string, fields: Record<string, unknown>): Promise<TaskProject | null> {
  const sql = getSql();
  const allowed = ['name', 'description', 'color', 'icon', 'parent_id', 'property_id', 'sort_order', 'is_archived'];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of allowed) {
    if (fields[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }

  if (updates.length === 0) return null;

  updates.push("updated_at = datetime('now')");
  values.push(id, getOrgId());

  await sql.run(`UPDATE task_projects SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`, values);
  return getProjectById(id);
}

// ─── Delete project ──────────────────────────────────────

export async function deleteProject(id: string): Promise<{ ok: boolean }> {
  const sql = getSql();
  const res = await sql.run('DELETE FROM task_projects WHERE id = ? AND organization_id = ?', [id, getOrgId()]);
  return { ok: res.changes > 0 };
}
