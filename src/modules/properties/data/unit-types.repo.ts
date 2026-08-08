import { getSql } from '@core/db/async';
import { ownsProperty, ownsViaProperty, propertyScopeSql } from './tenant-scope';

/**
 * Unit types hang off a property. listUnitTypes filtered only by is_active and
 * an optional category, so it returned every tenant's room types; create,
 * update and delete acted on whatever ids the request carried.
 */

export function listUnitTypes(organizationId: string, filters: { category?: string } = {}) {
  const sql = getSql();
  let query = `
    SELECT
      ut.id, ut.name, ut.code, ut.max_adults, ut.max_children, ut.max_occupancy, ut.base_occupancy,
      ut.beds_single, ut.beds_double, ut.photos, ut.sort_order,
      c.id as category_id, c.name as category_name, c.type as category_type,
      b.id as building_id, b.name as building_name, b.code as building_code,
      COUNT(u.id) as unit_count
    FROM unit_types ut
    JOIN categories c ON ut.category_id = c.id
    LEFT JOIN buildings b ON ut.building_id = b.id
    LEFT JOIN units u ON u.unit_type_id = ut.id AND u.is_active = TRUE
    WHERE ut.is_active = TRUE
  `;

  const params: string[] = [];

  if (filters.category) {
    query += ' AND c.type = ?';
    params.push(filters.category);
  }

  query += ' GROUP BY ut.id, c.id, c.name, c.type, c.sort_order, b.id, b.name, b.code ORDER BY c.sort_order, ut.sort_order';

  return sql.rows<any>(query, params);
}

export interface CreateUnitTypeInput {
  property_id: string;
  category_id: string;
  building_id?: string;
  name: string;
  code: string;
  description?: string;
  max_adults?: number;
  max_children?: number;
  max_occupancy?: number;
  base_occupancy?: number;
  beds_single?: number;
  beds_double?: number;
  beds_sofa?: number;
  extra_bed_available?: boolean;
  photos?: string;
  sort_order?: number;
}

export async function createUnitType(organizationId: string, input: CreateUnitTypeInput) {
  // Ids arrive in the request body, so each is verified against the caller.
  if (!await ownsProperty(organizationId, input.property_id)) return null;
  if (!await ownsViaProperty(organizationId, 'categories', input.category_id)) return null;
  if (input.building_id && !await ownsViaProperty(organizationId, 'buildings', input.building_id)) return null;

  const sql = getSql();
  const result = await sql.row<any>(
    `
    INSERT INTO unit_types (property_id, category_id, building_id, name, code, description,
      max_adults, max_children, max_occupancy, base_occupancy,
      beds_single, beds_double, beds_sofa, extra_bed_available, photos, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`,
    [input.property_id, input.category_id, input.building_id ?? null, input.name, input.code, input.description ?? null,
    input.max_adults ?? 2, input.max_children ?? 2, input.max_occupancy ?? 4, input.base_occupancy ?? 2,
    input.beds_single ?? 0, input.beds_double ?? 1, input.beds_sofa ?? 0, input.extra_bed_available ? 1 : 0, 
    input.photos ?? null, input.sort_order ?? 0],
  );
  return result;
}

export async function updateUnitType(organizationId: string, id: string, fields: Record<string, unknown>) {
  if (!await ownsViaProperty(organizationId, 'unit_types', id)) return null;
  // Reassignment must not move the type into another tenant.
  if (fields.category_id !== undefined
    && !await ownsViaProperty(organizationId, 'categories', String(fields.category_id))) return null;
  if (fields.building_id
    && !await ownsViaProperty(organizationId, 'buildings', String(fields.building_id))) return null;

  const sql = getSql();

  const nullableFields = ['building_id', 'description'];
  for (const f of nullableFields) {
    if (fields[f] === '') fields[f] = null;
  }

  const allowed = ['name', 'code', 'description', 'category_id', 'building_id', 'max_adults', 'max_children', 'max_occupancy', 'base_occupancy', 'beds_single', 'beds_double', 'beds_sofa', 'extra_bed_available', 'photos', 'sort_order', 'is_active'];
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
  values.push(id, organizationId);

  await sql.run(`UPDATE unit_types SET ${updates.join(', ')} WHERE id = ? AND ${propertyScopeSql('unit_types')}`, [...values]);
  return await sql.row<any>('SELECT * FROM unit_types WHERE id = ?', [id]);
}

export async function deleteUnitType(organizationId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (!await ownsViaProperty(organizationId, 'unit_types', id)) return { ok: false, error: 'Not found' };

  const sql = getSql();
  const unitCount = await sql.row<any>('SELECT COUNT(*) as cnt FROM units WHERE unit_type_id = ?', [id]) as { cnt: number };
  if (unitCount.cnt > 0) {
    return { ok: false, error: `Cannot delete: ${unitCount.cnt} units of this type exist. Delete units first.` };
  }
  await sql.run(`DELETE FROM unit_types WHERE id = ? AND ${propertyScopeSql('unit_types')}`, [id, organizationId]);
  return { ok: true };
}
