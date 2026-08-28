import { getSql } from '@core/db/async';
import { ownsProperty, ownsViaProperty, propertyScopeSql } from './tenant-scope';

/**
 * Unit types hang off a property. listUnitTypes filtered only by is_active and
 * an optional category, so it returned every tenant's room types; create,
 * update and delete acted on whatever ids the request carried.
 *
 * That is what the paragraph above has said since the fix was written. The fix
 * landed on create, update and delete — and not on the list. `organizationId`
 * arrived as an argument, `propertyScopeSql` was imported at the top of the
 * file, and neither was ever used in the query, so `GET /api/unit-types`
 * answered with every hotel's room types on the server.
 *
 * On Postgres the row-level policy caught what the query did not, which is
 * exactly why it survived: prod behaved correctly and nothing looked wrong. On
 * SQLite — every developer machine, and any environment that has not yet run
 * `deploy/to-postgres.sh` — there is no second line of defence, and it leaked.
 * It surfaced when a second hotel was seeded with the same room-type code as
 * the first and priced its nights from the first hotel's matrix.
 */

export function listUnitTypes(organizationId: string, filters: { category?: string } = {}) {
  const sql = getSql();
  let query = `
    SELECT
      ut.id, ut.name, ut.code, ut.max_adults, ut.max_children, ut.max_occupancy, ut.base_occupancy,
      ut.beds_single, ut.beds_double, ut.photos, ut.sort_order,
      c.id as category_id, c.name as category_name, c.type as category_type
      COUNT(u.id) as unit_count
    FROM unit_types ut
    JOIN categories c ON ut.category_id = c.id
    LEFT JOIN units u ON u.unit_type_id = ut.id AND u.is_active = TRUE
    WHERE ut.is_active = TRUE AND ${propertyScopeSql('ut')}
  `;

  const params: string[] = [organizationId];

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
  /** Reception can sell it, the website cannot. Default: it can. */
  bookable_online?: boolean;
  /** Whether this type's prices include breakfast; absent defers to the channel rule. */
  breakfast_included?: boolean | null;
}

export async function createUnitType(organizationId: string, input: CreateUnitTypeInput) {
  // Ids arrive in the request body, so each is verified against the caller.
  if (!await ownsProperty(organizationId, input.property_id)) return null;
  if (!await ownsViaProperty(organizationId, 'categories', input.category_id)) return null;

  const sql = getSql();
  const result = await sql.row<any>(
    `
    INSERT INTO unit_types (property_id, category_id, name, code, description,
      max_adults, max_children, max_occupancy, base_occupancy,
      beds_single, beds_double, beds_sofa, extra_bed_available, photos, sort_order,
      bookable_online, breakfast_included)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`,
    [input.property_id, input.category_id, input.name, input.code, input.description ?? null,
    input.max_adults ?? 2, input.max_children ?? 2, input.max_occupancy ?? 4, input.base_occupancy ?? 2,
    input.beds_single ?? 0, input.beds_double ?? 1, input.beds_sofa ?? 0, input.extra_bed_available ? 1 : 0,
    input.photos ?? null, input.sort_order ?? 0,
    // Postgres binds 1/0 into BOOLEAN and SQLite stores them as-is; `?? 1`
    // keeps the default "sellable online" when the caller says nothing.
    input.bookable_online === undefined ? 1 : (input.bookable_online ? 1 : 0),
    input.breakfast_included == null ? null : (input.breakfast_included ? 1 : 0)],
  );
  return result;
}

export async function updateUnitType(organizationId: string, id: string, fields: Record<string, unknown>) {
  if (!await ownsViaProperty(organizationId, 'unit_types', id)) return null;
  // Reassignment must not move the type into another tenant.
  if (fields.category_id !== undefined
    && !await ownsViaProperty(organizationId, 'categories', String(fields.category_id))) return null;

  const sql = getSql();

  const nullableFields = ['description'];
  for (const f of nullableFields) {
    if (fields[f] === '') fields[f] = null;
  }

  const allowed = ['name', 'code', 'description', 'category_id', 'max_adults', 'max_children', 'max_occupancy', 'base_occupancy', 'beds_single', 'beds_double', 'beds_sofa', 'extra_bed_available', 'photos', 'sort_order', 'is_active', 'bookable_online', 'breakfast_included'];
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
