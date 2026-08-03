import { getSql } from '@core/db/async';
import { getDb } from '@core/db';
import type { TaskTag } from '../domain/types';
import { requireOrganizationId } from '@core/auth/tenant-context';

// ─── Helpers ───────────────────────────────────────────────

function getOrgId(): string {
  return requireOrganizationId(getDb());
}

// ─── List tags ────────────────────────────────────────────

export async function listTags(): Promise<TaskTag[]> {
  const sql = getSql();
  return await sql.rows<TaskTag>('SELECT * FROM task_tags WHERE organization_id = ? ORDER BY name', [getOrgId()]);
}

// ─── Get single tag ──────────────────────────────────────

export async function getTagById(id: string): Promise<TaskTag | null> {
  const sql = getSql();
  const tag = await sql.row<TaskTag>(
    'SELECT * FROM task_tags WHERE id = ? AND organization_id = ?', [id, getOrgId()],
  );
  return tag ?? null;
}

// ─── Create tag ──────────────────────────────────────────

export interface CreateTagInput {
  name: string;
  color?: string;
}

export async function createTag(input: CreateTagInput): Promise<TaskTag> {
  const sql = getSql();
  const orgId = getOrgId();

  const result = await sql.run(`
    INSERT INTO task_tags (organization_id, name, color)
    VALUES (?, ?, ?)
  `, [orgId, input.name, input.color ?? '#6c7086']);

  const row = await sql.row<{ id: string }>('SELECT id FROM task_tags WHERE rowid = ?', [result.lastId]);
  return (await getTagById(row!.id))!;
}

// ─── Update tag ──────────────────────────────────────────

export async function updateTag(id: string, fields: Record<string, unknown>): Promise<TaskTag | null> {
  const sql = getSql();
  const allowed = ['name', 'color'];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of allowed) {
    if (fields[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }

  if (updates.length === 0) return null;

  values.push(id, getOrgId());

  await sql.run(`UPDATE task_tags SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`, values);
  return getTagById(id);
}

// ─── Delete tag ──────────────────────────────────────────
// task_tag_links has ON DELETE CASCADE on tag_id, so links are auto-removed

export async function deleteTag(id: string): Promise<{ ok: boolean }> {
  const sql = getSql();
  const res = await sql.run('DELETE FROM task_tags WHERE id = ? AND organization_id = ?', [id, getOrgId()]);
  return { ok: res.changes > 0 };
}
