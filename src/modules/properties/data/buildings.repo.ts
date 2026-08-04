import { getSql } from '@core/db/async';
import { ownsProperty, ownsViaProperty, propertyScopeSql } from './tenant-scope';

/**
 * Buildings hang off a property. The property_id filter used to be optional, so
 * calling the endpoint without it listed every tenant's buildings, and
 * update/delete acted on whatever id the URL carried.
 */

export function listBuildings(organizationId: string, filters: { property_id?: string } = {}) {
  const sql = getSql();
  let query = `
    SELECT b.*, c.name as category_name, c.type as category_type,
      COUNT(u.id) as unit_count
    FROM buildings b
    JOIN categories c ON b.category_id = c.id
    LEFT JOIN units u ON u.building_id = b.id AND u.is_active = 1
    WHERE ${propertyScopeSql('b')}
  `;

  const params: string[] = [organizationId];

  if (filters.property_id) {
    query += ' AND b.property_id = ?';
    params.push(filters.property_id);
  }

  query += ' GROUP BY b.id ORDER BY b.sort_order';

  return sql.rows<any>(query, params);
}

export interface CreateBuildingInput {
  category_id: string;
  property_id: string;
  name: string;
  code: string;
  description?: string;
  sort_order?: number;
}

export async function createBuilding(organizationId: string, input: CreateBuildingInput) {
  // Both ids arrive in the request body. The category is checked too, or a
  // building could be filed under another tenant's category.
  if (!await ownsProperty(organizationId, input.property_id)) return null;
  if (!await ownsViaProperty(organizationId, 'categories', input.category_id)) return null;

  const sql = getSql();
  const result = await sql.row<any>(
    `
    INSERT INTO buildings (category_id, property_id, name, code, description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *`,
    [input.category_id, input.property_id, input.name, input.code, input.description ?? null, input.sort_order ?? 0],
  );
  return result;
}

export async function updateBuilding(organizationId: string, id: string, fields: Record<string, unknown>) {
  if (!await ownsViaProperty(organizationId, 'buildings', id)) return null;
  // Reassigning the category must not move the building into another tenant.
  if (fields.category_id !== undefined
    && !await ownsViaProperty(organizationId, 'categories', String(fields.category_id))) return null;

  const sql = getSql();
  const allowed = ['name', 'code', 'description', 'sort_order', 'category_id'];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of allowed) {
    if (fields[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }

  if (updates.length === 0) return null;

  values.push(id, organizationId);
  await sql.run(`UPDATE buildings SET ${updates.join(', ')} WHERE id = ? AND ${propertyScopeSql('buildings')}`, [...values]);
  return await sql.row<any>('SELECT * FROM buildings WHERE id = ?', [id]);
}

export async function deleteBuilding(organizationId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (!await ownsViaProperty(organizationId, 'buildings', id)) return { ok: false, error: 'Not found' };

  const sql = getSql();
  const unitCount = await sql.row<any>('SELECT COUNT(*) as cnt FROM units WHERE building_id = ?', [id]) as { cnt: number };
  if (unitCount.cnt > 0) {
    return { ok: false, error: `Cannot delete: ${unitCount.cnt} units belong to this building. Delete units first.` };
  }
  await sql.run(`DELETE FROM buildings WHERE id = ? AND ${propertyScopeSql('buildings')}`, [id, organizationId]);
  return { ok: true };
}
