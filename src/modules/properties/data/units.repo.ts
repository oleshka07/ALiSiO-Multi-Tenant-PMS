import { getSql } from '@core/db/async';
import { ownsProperty, ownsViaProperty, propertyScopeSql } from './tenant-scope';

/**
 * Units hang off a property. listUnits filtered only by is_active, so it
 * returned every tenant's rooms, and create/update/delete acted on whatever
 * ids the request carried — including bulkCreateUnits, which could have
 * written a hundred rooms into another tenant's property in one call.
 */

export function listUnits(organizationId: string, filters: { category?: string; unitType?: string; includePool?: boolean } = {}) {
  const sql = getSql();
  let query = `
    SELECT
      u.id, u.name, u.code, u.beds, u.zone, u.room_status, u.cleaning_status, u.sort_order, u.is_active, u.is_pool, u.lock_code, u.entry_photo_url,
      c.id as category_id, c.name as category_name, c.type as category_type, c.icon as category_icon, c.color as category_color,
      ut.id as unit_type_id, ut.name as unit_type_name, ut.code as unit_type_code, ut.max_adults, ut.base_occupancy,
      b.id as building_id, b.name as building_name, b.code as building_code
    FROM units u
    JOIN categories c ON u.category_id = c.id
    JOIN unit_types ut ON u.unit_type_id = ut.id
    LEFT JOIN buildings b ON u.building_id = b.id
    WHERE u.is_active = TRUE AND ${propertyScopeSql('u')}
  `;

  const params: string[] = [organizationId];

  // Pool/staging units never show up as bookable rooms. The room-allocation
  // modal opts in via includePool=true.
  if (!filters.includePool) {
    query += ' AND (u.is_pool IS NULL OR u.is_pool = FALSE)';
  }

  if (filters.category) {
    query += ' AND c.type = ?';
    params.push(filters.category);
  }

  if (filters.unitType) {
    query += ' AND ut.id = ?';
    params.push(filters.unitType);
  }

  query += ' ORDER BY c.sort_order, b.sort_order, ut.sort_order, u.sort_order';

  return sql.rows<any>(query, params);
}

export interface CreateUnitInput {
  unit_type_id: string;
  property_id: string;
  category_id: string;
  building_id?: string;
  name: string;
  code: string;
  floor?: number;
  zone?: string;
  beds?: number;
  notes?: string;
  sort_order?: number;
}

/** Every id below arrives in the request body, so each is checked separately. */
async function ownsAllRefs(
  organizationId: string,
  input: { property_id: string; category_id: string; unit_type_id: string; building_id?: string },
): Promise<boolean> {
  if (!await ownsProperty(organizationId, input.property_id)) return false;
  if (!await ownsViaProperty(organizationId, 'categories', input.category_id)) return false;
  if (!await ownsViaProperty(organizationId, 'unit_types', input.unit_type_id)) return false;
  if (input.building_id && !await ownsViaProperty(organizationId, 'buildings', input.building_id)) return false;
  return true;
}

export async function createUnit(organizationId: string, input: CreateUnitInput) {
  if (!await ownsAllRefs(organizationId, input)) return null;

  const sql = getSql();
  const result = await sql.row<any>(
    `
    INSERT INTO units (unit_type_id, property_id, category_id, building_id, name, code, floor, zone, beds, notes, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`,
    [input.unit_type_id, input.property_id, input.category_id, input.building_id ?? null,
    input.name, input.code, input.floor ?? null, input.zone ?? null,
    input.beds ?? 0, input.notes ?? null, input.sort_order ?? 0],
  );
  return result;
}

export interface BulkCreateUnitsInput {
  property_id: string;
  category_id: string;
  building_id?: string;
  unit_type_id: string;
  prefix: string;
  from: number;
  to: number;
  beds?: number;
  zone?: string;
}

export async function bulkCreateUnits(organizationId: string, input: BulkCreateUnitsInput) {
  // Unchecked, this wrote up to two hundred rooms into another tenant's
  // property in a single call.
  //
  // null, not []: the caller has to tell "these ids are not yours" from "every
  // one of those room numbers already exists". Both used to come back as an
  // empty array, so a hotel re-entering a range it had already entered was
  // told "Property, category, unit type or building not found" — an answer
  // about ownership to a question about duplicates. It cost an hour to read
  // that message as what it actually was.
  if (!await ownsAllRefs(organizationId, input)) return null;

  const sql = getSql();
  const created: { name: string; code: string }[] = [];

  await sql.tx(async (t) => {
    for (let i = input.from; i <= input.to; i++) {
      const name = `${input.prefix}${i}`;
      const code = `${input.prefix}${i}`;
      try {
        await t.run(`
          INSERT INTO units (unit_type_id, property_id, category_id, building_id, name, code, beds, zone, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [input.unit_type_id, input.property_id, input.category_id, input.building_id ?? null, name, code, input.beds ?? 0, input.zone ?? null, i]);
        created.push({ name, code });
      } catch (e: unknown) {
        // A name that already exists is skipped, not fatal: SQLite rolls back
        // the failed statement, not the transaction, so the rest still lands.
        if (e instanceof Error && !e.message.includes('UNIQUE')) throw e;
      }
    }
  });

  return created;
}

export async function updateUnit(organizationId: string, id: string, fields: Record<string, unknown>) {
  if (!await ownsViaProperty(organizationId, 'units', id)) return null;
  // Reassignment must not move the unit into another tenant.
  for (const [field, table] of [
    ['category_id', 'categories'], ['unit_type_id', 'unit_types'], ['building_id', 'buildings'],
  ] as const) {
    if (fields[field] && !await ownsViaProperty(organizationId, table, String(fields[field]))) return null;
  }

  const sql = getSql();

  const nullableFields = ['building_id', 'floor', 'zone', 'notes', 'lock_code', 'entry_photo_url'];
  for (const f of nullableFields) {
    if (fields[f] === '') fields[f] = null;
  }

  const allowed = ['name', 'code', 'unit_type_id', 'category_id', 'building_id', 'floor', 'zone', 'beds', 'room_status', 'cleaning_status', 'notes', 'sort_order', 'is_active', 'lock_code', 'entry_photo_url'];
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

  await sql.run(`UPDATE units SET ${updates.join(', ')} WHERE id = ? AND ${propertyScopeSql('units')}`, [...values]);
  return await sql.row<any>('SELECT * FROM units WHERE id = ?', [id]);
}

export async function deleteUnit(organizationId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (!await ownsViaProperty(organizationId, 'units', id)) return { ok: false, error: 'Not found' };

  const sql = getSql();
  const resCount = await sql.row<any>("SELECT COUNT(*) as cnt FROM reservations WHERE unit_id = ? AND status NOT IN ('cancelled', 'checked_out')", [id]) as { cnt: number };

  if (resCount.cnt > 0) {
    return { ok: false, error: `Cannot delete: ${resCount.cnt} active reservations exist for this unit.` };
  }

  await sql.run(`DELETE FROM units WHERE id = ? AND ${propertyScopeSql('units')}`, [id, organizationId]);
  return { ok: true };
}
