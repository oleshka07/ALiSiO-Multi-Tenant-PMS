import { getDb } from '@core/db';

export function listUnitTypes(filters: { category?: string } = {}) {
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
    LEFT JOIN units u ON u.unit_type_id = ut.id AND u.is_active = 1
    WHERE ut.is_active = 1
  `;

  const params: string[] = [];

  if (filters.category) {
    query += ' AND c.type = ?';
    params.push(filters.category);
  }

  query += ' GROUP BY ut.id ORDER BY c.sort_order, ut.sort_order';

  return getDb().prepare(query).all(...params);
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

export function createUnitType(input: CreateUnitTypeInput) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO unit_types (property_id, category_id, building_id, name, code, description,
      max_adults, max_children, max_occupancy, base_occupancy,
      beds_single, beds_double, beds_sofa, extra_bed_available, photos, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.property_id, input.category_id, input.building_id ?? null, input.name, input.code, input.description ?? null,
    input.max_adults ?? 2, input.max_children ?? 2, input.max_occupancy ?? 4, input.base_occupancy ?? 2,
    input.beds_single ?? 0, input.beds_double ?? 1, input.beds_sofa ?? 0, input.extra_bed_available ? 1 : 0, 
    input.photos ?? null, input.sort_order ?? 0
  );
  return db.prepare('SELECT * FROM unit_types WHERE rowid = ?').get(result.lastInsertRowid);
}

export function updateUnitType(id: string, fields: Record<string, unknown>) {
  const db = getDb();

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

  updates.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE unit_types SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM unit_types WHERE id = ?').get(id);
}

export function deleteUnitType(id: string): { ok: boolean; error?: string } {
  const db = getDb();
  const unitCount = db.prepare('SELECT COUNT(*) as cnt FROM units WHERE unit_type_id = ?').get(id) as { cnt: number };
  if (unitCount.cnt > 0) {
    return { ok: false, error: `Cannot delete: ${unitCount.cnt} units of this type exist. Delete units first.` };
  }
  db.prepare('DELETE FROM unit_types WHERE id = ?').run(id);
  return { ok: true };
}
