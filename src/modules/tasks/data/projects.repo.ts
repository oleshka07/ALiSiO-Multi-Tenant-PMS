import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import type { TaskProject } from '../domain/types';
import { requireOrganizationId } from '@core/auth/tenant-context';
import { propertyOrSharedFilter, type PropertyScope } from '@core/property-scope';

// ─── Helpers ───────────────────────────────────────────────

async function getOrgId(): Promise<string> {
  return await requireOrganizationId();
}

// ─── List projects ────────────────────────────────────────

/**
 * Проєкти ОДНОГО обʼєкта плюс спільні — сказано типом (INC-029, двері О14).
 *
 * `task_projects.property_id` теж NULLABLE, і з тієї самої причини: проєкт
 * «Ремонт даху» належить будинку, проєкт «Річна звітність» — рахунку.
 */
export async function listProjects(scope: PropertyScope): Promise<TaskProject[]> {
  const sql = getSql();
  const org = await getOrgId();
  const inScope = propertyOrSharedFilter(scope, 'tp');
  return await sql.rows<TaskProject>(`
    SELECT
      tp.*,
      p.name AS property_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = tp.id) AS task_count
    FROM task_projects tp
    LEFT JOIN properties p ON p.id = tp.property_id
    WHERE tp.organization_id = ? AND ${inScope.sql}
    ORDER BY tp.sort_order, tp.created_at
  `, [org, ...inScope.params]);
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
  `, [id, await getOrgId()]);
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
  const orgId = await getOrgId();

  const result = await sql.row<any>(
    `
    INSERT INTO task_projects (organization_id, name, description, color, icon, parent_id, property_id, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id`,
    [
    orgId,
    input.name,
    input.description ?? null,
    input.color ?? '#4f6ef7',
    input.icon ?? '📁',
    input.parent_id ?? null,
    input.property_id ?? null,
    input.sort_order ?? 0,
  ],
  );
  return (await getProjectById(result!.id))!;
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

  updates.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, await getOrgId());

  await sql.run(`UPDATE task_projects SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`, values);
  return getProjectById(id);
}

// ─── Delete project ──────────────────────────────────────

export async function deleteProject(id: string): Promise<{ ok: boolean }> {
  const sql = getSql();
  const res = await sql.run('DELETE FROM task_projects WHERE id = ? AND organization_id = ?', [id, await getOrgId()]);
  return { ok: res.changes > 0 };
}
